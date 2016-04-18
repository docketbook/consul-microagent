"use strict";
let common = require("./common");
let sinon = require('sinon');
let expect = require('chai').expect;
let async = require('async');
let Lib = require('../index');
let extend = require('util')._extend;

let secondConfig = extend({}, common.testConfiguration);
secondConfig.service = {
  identifier: common.testConfiguration.service.identifier + '-second',
  name: secondConfig.service.name,
  address: "12.12.12.12",
  port: 8900
}

let agent = Lib.Microagent.buildAgent(Object.assign({}, common.testConfiguration));
let secondAgent = Lib.Microagent.buildAgent(secondConfig);
let testCache = null;

let logger = {
  infoLog: [],
  errorLog: [],
  traceLog: [],
  info: function(input) {
    this.infoLog.push(input);
  },
  err: function(input) {
    this.errorLog.push(input);
  },
  trace: function(input) {
    this.traceLog.push(input);
  },
  clear: function() {
    this.infoLog.splice(0, logger.infoLog.length);
    this.errorLog.splice(0, logger.errorLog.length);
    this.traceLog.splice(0, logger.traceLog.length);
  }
};

before(function(done) {
  agent.start(function(err) {
    expect(err).to.equal(null);
    done();
  });
});

it('#can be created', function(done) {
  let cache = Lib.AddressCache.buildCache({
    consulAgent: agent.getConsulClient(),
    log: logger,
    ttl: 1
  });
  testCache = cache;
  done();
});

it('#can be queried for test service', function(done) {
  testCache.addressesForService(common.testConfiguration.service.name, function(err, res){
    expect(err).to.equal(null);
    expect(res).to.not.equal(null);
    expect(res.length).to.equal(1);
    expect(res[0].id).to.equal(common.testConfiguration.service.identifier);
    done();
  });
});

it('#re-polls', function(done) {
  let serviceName = common.testConfiguration.service.name;
  this.timeout(testCache.ttl * 2000);
  logger.clear();
  expect(logger.infoLog.length).to.equal(0);
  expect(logger.errorLog.length).to.equal(0);
  expect(logger.traceLog.length).to.equal(0);
  setTimeout(function() {
    expect(logger.traceLog.length).to.not.equal(0);
    expect(logger.errorLog.length).to.equal(0);
    expect(logger.traceLog.indexOf("Cache timer has fired for " + serviceName)).to.not.equal(-1);
    expect(logger.traceLog.indexOf("Firing service lookup for " + serviceName)).to.not.equal(-1);
    done();
  }, testCache.ttl * 1500);
});

it('#default strategy doesnt dispatch on subsequent lookups', function(done) {
  let serviceName = common.testConfiguration.service.name;
  logger.clear();
  expect(logger.infoLog.length).to.equal(0);
  expect(logger.errorLog.length).to.equal(0);
  expect(logger.traceLog.length).to.equal(0);
  testCache.addressesForService(serviceName, function(err, res){
    expect(err).to.equal(null);
    expect(res).to.not.equal(null);
    expect(logger.traceLog.indexOf("Dispatch for " + serviceName)).to.equal(-1);
    done();
  });
});

it('#ejection', function(done) {
  let originalStrategy = testCache.strategy;
  let serviceName = common.testConfiguration.service.name;
  this.timeout(testCache.ttl * 2000);
  testCache.strategy = 'timed-eject';
  logger.clear();
  expect(logger.infoLog.length).to.equal(0);
  expect(logger.errorLog.length).to.equal(0);
  expect(logger.traceLog.length).to.equal(0);
  setTimeout(function() {
    expect(logger.traceLog.length).to.not.equal(0);
    expect(logger.errorLog.length).to.equal(0);
    expect(logger.traceLog.indexOf("Cache timer has fired for " + serviceName)).to.not.equal(-1);
    expect(logger.traceLog.indexOf("Ejecting " + serviceName)).to.not.equal(-1);
    expect(testCache.cacheMap[serviceName]).to.equal(undefined);
    testCache.strategy = originalStrategy;
    done();
  }, testCache.ttl * 1500);
});

it('#always poll', function(done) {
  let originalStrategy = testCache.strategy;
  let serviceName = common.testConfiguration.service.name;
  testCache.strategy = 'always-poll';
  logger.clear();
  expect(logger.infoLog.length).to.equal(0);
  expect(logger.errorLog.length).to.equal(0);
  expect(logger.traceLog.length).to.equal(0);
  testCache.addressesForService(common.testConfiguration.service.name, function(err, res){
    expect(err).to.equal(null);
    expect(res).to.not.equal(null);
    expect(logger.traceLog.indexOf("Dispatch for " + serviceName)).to.not.equal(-1);
    testCache.addressesForService(common.testConfiguration.service.name, function(err, res){
      expect(err).to.equal(null);
      expect(res).to.not.equal(null);
      expect(logger.traceLog.indexOf("Dispatch for " + serviceName)).to.not.equal(-1);
      testCache.strategy = originalStrategy;
      done();
    });
  });
});

it('#can be subscribed to', function(done) {
  this.timeout(testCache.ttl * 2000);
  let serviceName = common.testConfiguration.service.name;
  let handler = function(service, addresses) {
    expect(service).to.equal(serviceName);
    expect(addresses).to.not.equal(null);
    expect(addresses.length).to.equal(1);
    testCache.events.removeListener('serviceRefreshed', handler);
    done();
  }
  testCache.events.addListener('serviceRefreshed', handler);
});

it('#handles new addresses and notifies changes', function(done) {
  this.timeout(testCache.ttl * 2000);
  let serviceName = common.testConfiguration.service.name;
  let eventPassed = false;
  let handler = function(service, addresses, changes) {
    expect(service).to.equal(serviceName);
    expect(addresses).to.not.equal(null);
    expect(addresses.length).to.equal(2);
    expect(changes).to.not.equal(null);
    expect(changes.additions).to.not.equal(null);
    expect(changes.removals).to.not.equal(null);
    expect(changes.additions.length).to.equal(1);
    expect(changes.removals.length).to.equal(0);
    testCache.events.removeListener('serviceChanged', handler);
    eventPassed = true;
  }
  testCache.events.addListener('serviceChanged', handler);
  secondAgent.start(function(err) {
    expect(err).to.equal(null);
    setTimeout(function() {
      testCache.addressesForService(common.testConfiguration.service.name, function(err, res){
        //should see both agents
        expect(err).to.equal(null);
        expect(res).to.not.equal(null);
        expect(res.length).to.equal(2);
        let found = [false, false];
        res.forEach(function(result) {
          if (result.id === common.testConfiguration.service.identifier) {
            found[0] = true;
          }
          if (result.id === secondConfig.service.identifier) {
            found[1] = true;
          }
        });
        expect(found[0]).to.equal(true);
        expect(found[1]).to.equal(true);
        expect(eventPassed).to.equal(true);
        done();
      });
    }, testCache.ttl * 1500);
  });
});

after(function(done) {
  agent.stop(function(err) {
    secondAgent.stop(function(err) {
      done();
    });
  });
});

