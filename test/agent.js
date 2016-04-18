"use strict";
let common = require("./common");
let sinon = require('sinon');
let expect = require('chai').expect;
let async = require('async');
let Lib = require('../index');
const consulAgent = require('consul');

let copyTestConfiguration = Object.assign({}, common.testConfiguration.consul);
let verificationAgent = consulAgent(copyTestConfiguration);
let testAgent = null;

before(function(done) {
	done();
});

it('#can be created and started', function(done) {
  let agent = Lib.Microagent.buildAgent(common.testConfiguration);
  agent.start(function(err) {
    expect(err).to.equal(null);
    testAgent = agent;
    done();
  });
});

it("#is registered", function(done) {
  verificationAgent.health.service({
    service: common.testConfiguration.service.name,
    passing: true
  }, function(err, results) {
    expect(err).to.equal(undefined);
    expect(results).to.not.equal(null);
    let found = false;
    results.forEach(function(result) {
      if ((result.Service.Address === testAgent.service.address) && (result.Service.ID === testAgent.service.identifier)) {
        found = true;
      }
    }); 
    expect(found).to.equal(true);
    done();
  });
});

it('#can be stopped', function(done) {
  testAgent.stop(function(err) {
    expect(err).to.equal(null);
    done();
  });
});

it("#is de-registered", function(done) {
  verificationAgent.health.service({
    service: common.testConfiguration.service.name,
    passing: true
  }, function(err, results) {
    expect(err).to.equal(undefined);
    expect(results).to.not.equal(null);
    let found = false;
    results.forEach(function(result) {
      if ((result.Service.Address === testAgent.service.address) && (result.Service.ID === testAgent.service.identifier)) {
        found = true;
      }
    }); 
    expect(found).to.equal(false);
    done();
  });
});

after(function(done) {
	done();
});

