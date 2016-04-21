"use strict";
const os = require('os');
const assert = require('assert-plus');
const consulAgent = require('consul');
const async = require('async');
const addressCache = require('./address_cache');
/*
	object
		- consul address to register against (hostname)
		- contains ttl
		- setups up service registration
		- pings consul on ttl
		- parameter determining whether it should register or not
		- provides discovery and monitoring of other services with configurable cache
*/

exports.nonLoopbackAddresses = function(){
	let interfaces = os.networkInterfaces();
	let nonLoopbacks = [];
	let loopback = null;
	let nicNames = Object.keys(interfaces);
	for ( var i = 0; i < nicNames.length; i++ ){
		let nic = interfaces[nicNames[i]];
		for ( var j = 0; j < nic.length; j++ ){
			var address = nic[j];
			if (( address.address != '127.0.0.1' ) && ( !address.internal )){
				nonLoopbacks.push(address.address);
		    }
		}	
	}
	if ( nonLoopbacks.length > 0 ){
	  return nonLoopbacks;
	}else{
	  return ['127.0.0.1'];
	}
}

exports.firstNonLoopbackAddress = function() {
	let addresses = exports.nonLoopbackAddresses();
	if ((addresses.length === 1) && (addresses[0] === '127.0.0.1')) {
		return null;
	} else {
		return addresses[0];
	}
}

function buildConsulClient() {
	let _this = this;
	assert.object(_this.consul, 'consul');
	assert.string(_this.consul.host, 'consul.host');
	let connectionArgs = _this.consul;
	let consulAgentObj = consulAgent(connectionArgs);
	return consulAgentObj;
}

function getConsulClient() {
	let _this = this;
	if (_this.consulClient === undefined) {
		_this.consulClient = _this.buildConsulClient();
	}
	return _this.consulClient;
}

function registerService(callback) {
	let _this = this;
	return async.series([
		function(doneCallback) {
			let service = {
				id: _this.service.identifier,
				name: _this.service.name,
				address: _this.service.address,
				port:parseInt(_this.service.port),
			};
			return _this.getConsulClient().agent.service.register(service, doneCallback);
		},
		function(doneCallback) {
			let check = {
				name: "Heartbeat Check via MicroAgent",
				id: _this.service.identifier + '-ttlCheck',
				notes: "Check Managed within Application via Heartbeat",
				status: 'passing',
				serviceid: _this.service.identifier,
				ttl: _this.registrationTtl.toString() + 's'
			}
			return _this.getConsulClient().agent.check.register(check, doneCallback);
		}
	], function(err) {
		return callback(err);
	});
}

function sendPass(callback) {
	let _this = this;
	return _this.getConsulClient().agent.check.pass(_this.service.identifier, function(err) {
		if ((err === null) || (err === undefined)) {
			return _this.scheduleNextSend();
		}
		if (err.message === 'CheckID does not have associated TTL') {
			return _this.registerService(function(err) {
				_this.scheduleNextSend();
				return callback(err);
			});
		} else {
			_this.scheduleNextSend();
			return callback(err);
		}
	});
}

function scheduleNextSend() {
	let _this = this;
	if ((_this.nextTimerHandle === null) || (_this.nextTimerHandle === undefined)){
		_this.nextTimerHandle = setTimeout(function() {
			_this.nextTimerHandle = null;
			_this.sendPass(function(err) {
				if (_this.log !== null) {
					if (err) {
						_this.log.error(err);
					} else {
						_this.log.info("TTL Sent to Consul");
					}
				}
			});
		}, _this.timerTtl * 1000);
	}
}

function deregister(callback) {
	let _this = this;
	return async.series([
		function(doneCallback) {
			_this.getConsulClient().agent.check.deregister(_this.service.identifier + '-ttlCheck', doneCallback);
		},
		function(doneCallback) {
			_this.getConsulClient().agent.service.deregister({id:_this.service.identifier}, doneCallback);
		}
	], function(err) {
		return callback(err);
	});
}

function start(callback) {
	assert.object(this.service, 'service');
	assert.string(this.service.identifier, 'service.identifier');
	assert.string(this.service.name, 'service.name');
	assert.number(this.service.port, 'service.port');
	assert.string(this.service.address, 'service.address');
	assert.object(this.consul, 'consul');
	assert.string(this.consul.host, 'consul.name');
	assert.number(this.registrationTtl, 'registrationTtl');
	assert.number(this.timerTtl, 'timerTtl');
	let _this = this;
	return this.sendPass(function(err) {
		if (err) return callback(err);
		_this.scheduleNextSend();
		if (_this.log !== null) {
			_this.log.info("Registered with Consul");
		}
		return callback(null);
	});
}

function stop(callback) {
	let _this = this;
	if (this.nextTimerHandle !== null) {
		clearTimeout(_this.nextTimerHandle);
		_this.nextTimerHandle = null;
	}
	return this.deregister(function(err) {
		if (_this.log !== null) {
			if (err) {
				_this.log.error(err);
			} else {
				_this.log.info("Deregistered from Consul");
			}
		}
		return callback(err);
	});
}

function getCache() {
	if (this.cacheObj === undefined) {
		this.cacheObj = addressCache.buildCache({
			consulAgent: this.getConsulClient(),
			log: this.log,
			ttl: this.timerTtl
		});
	}
	return this.cacheObj;
}

exports.buildAgent = function(options) {
	let service = {
		identifier: os.hostname(),
		name: null,
		port: null,
		address: exports.firstNonLoopbackAddress(),
	};
	if ('service' in options) {
		Object.assign(service, options.service);
	}
	let consul = {
		host: null,
		port: null,
	};
	if ('consul' in options) {
		Object.assign(consul, options.consul);
	}
	let agent = {
		service: service,
		consul: consul,
		nextTimerHandle: null,
		registrationTtl: 10,
		timerTtl: 5,
		shouldRegister: false,
		get cache() {
			return agent.getCache();
		},
		log: null,
		start: start,
		stop: stop,
		deregister: deregister,
		scheduleNextSend: scheduleNextSend,
		sendPass: sendPass,
		registerService: registerService,
		getConsulClient: getConsulClient,
		buildConsulClient: buildConsulClient,
		getCache:getCache
	}
	return agent;
}