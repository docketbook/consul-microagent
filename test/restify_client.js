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
let serviceName = common.testConfiguration.service.name;
let testCache = null;

before(function(done) {
  agent.start(function(err) {
    expect(err).to.equal(null);
    done();
  });
});

it('#can be created', function(done) {
  let cache = Lib.Client.Restify.buildCache({
    addressCache: agent.getCache(),
  });
  expect(cache).to.not.equal(null);
  testCache = cache;
  done();
});

it('#can fetch a client', function(done) {
  testCache.clientForService(serviceName, function(err, client) {
    expect(err).to.equal(null);
    expect(client).to.not.equal(null);
    let keys = Object.keys(testCache.services[serviceName].addressUsage);
    expect(keys.length).to.equal(1);
    expect(testCache.services[serviceName].addressUsage[keys[0]]).to.equal(1);
    done();
  });
});

it('#add a second agent and fetch a different client', function(done) {
  this.timeout(testCache.addressCache.ttl * 2000);
  secondAgent.start(function(err) {
     expect(err).to.equal(null);
     setTimeout(function() {
      testCache.clientForService(serviceName, function(err, client) {
        expect(err).to.equal(null);
        expect(client).to.not.equal(null);
        let keys = Object.keys(testCache.services[serviceName].addressUsage);
        expect(keys.length).to.equal(2);
        done();
      });
     }, testCache.addressCache.ttl * 1500);
  }); 
});

after(function(done) {
  agent.stop(function(err) {
    secondAgent.stop(function(err) {
      done();
    });
  });
});

