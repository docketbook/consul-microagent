"use strict";

const assert = require('assert-plus');
const consulAgent = require('consul');
const async = require('async');
const EventEmitter = require('events');
const util = require('util');

function dispatchLookup(service, callback) {
	let _this = this;
	if (_this.log) _this.log.trace("Dispatch for " + service);
	_this.consulAgent.health.service({
		service: service,
		passing: true,
	}, function(err, results) {
		if (err) return callback(err, null);
		let endpoints = [];
		let endpointObj = {};
		results.forEach(function(entry) {
			let obj = {
				address: entry.Service.Address,
				port: entry.Service.Port,
				tags: entry.Service.Tags,
				id: entry.Service.ID,
				fullAddress: entry.Service.Address + ':' + entry.Service.Port,
			}
			if (endpointObj[obj.fullAddress] === undefined) {
				endpointObj[obj.fullAddress] = true;
				endpoints.push(obj);
			}
		});
		return callback(null, endpoints);
	});
}

function evaluateChanges(oldCache, newCache) {
	//for each in the old cache, check if it exists in the new cache
	let oldCacheIds = {};
	oldCache.forEach(function(oldCacheItem) {
		oldCacheIds[oldCacheItem.id] = oldCacheItem;
	});
	let newCacheIds = {};
	newCache.forEach(function(newCacheItem) {
		newCacheIds[newCacheItem.id] = newCacheItem;
	});
	let removals = oldCache.filter(function(element, index, array) {
		return newCacheIds[element.id] === undefined;
	});
	let additions = newCache.filter(function(element, index, array) {
		return oldCacheIds[element.id] === undefined;
	});
	return {
		removals: removals,
		additions: additions,
	}
}

function lookupService(service, callback) {
	let _this = this;
	assert.object(_this.consulAgent, 'consulAgent');
	if (_this.updateStatus[service] === undefined) {
		_this.updateStatus[service] = {
			status: 'waiting',
			callbacks: [],
			timerHandle: null,
		}
	}
	if (_this.cacheMap[service] === undefined) {
		_this.cacheMap[service] = [];
	}
	let statusObj = _this.updateStatus[service];
	statusObj.callbacks.push(callback);
	if (statusObj.status !== 'waiting') {
		return;
	}
	statusObj.status = 'working';
	return _this.dispatchLookup(service, function(err, addresses) {
		statusObj.status = 'waiting';
		if (err === null) {
			let changes = evaluateChanges(_this.cacheMap[service], addresses);
			_this.cacheMap[service] = addresses;
			if ((changes.removals.length > 0) || (changes.additions.length > 0)) {
				_this.events.emit('serviceChanged', service, _this.cacheMap[service], changes);
			}
		}
		let callbackList = [];
		statusObj.callbacks.forEach(function(callback) {
			callbackList.push(callback);
		});
		_this.events.emit('serviceRefreshed', service, _this.cacheMap[service]);
		statusObj.callbacks.splice(0, statusObj.callbacks.length);
		callbackList.forEach(function(callback) {
			return callback(err, _this.cacheMap[service]);
		});
		_this.setTimerForService(service);
	});
}

function addressesForService(service, force, callback) {
	let shouldForce = force
	let cb = callback;
	if (typeof force === 'function') {
		shouldForce = false;
		cb = force;
	}
	//need to fire a lookup if
	// - cacheMap has nothing in it for the service
	// - strategy is set to 'always-poll'
	// - force is set to tyue
	let issueLookup = false;
	let _this = this;
	if (_this.cacheMap[service] === undefined) {
		issueLookup = true;
	} else if (_this.cacheMap[service].length === 0) {
		issueLookup = true;
	} else if (_this.strategy === 'always-poll') {
		issueLookup = true;
	} else if (shouldForce === true) {
		issueLookup = true;
	}
	if (issueLookup) {
		return _this.lookupService(service, cb);
	} else {
		process.nextTick(function() {
			let response = _this.cacheMap[service];
			if ((response === null) || (response === undefined)) {
				response = [];
			}
			return cb(null, response);
		});
	}
}

function timerTickForService(service) {
	let _this = this;
	let statusObj = _this.updateStatus[service];
	if (_this.log) _this.log.trace("Cache timer has fired for " + service);
	statusObj.timerHandle = null;
	if (_this.strategy === 'maintain-via-poll') {
		if (_this.log) _this.log.trace("Firing service lookup for " + service);
		_this.lookupService(service, function(err, addresses) {
			if (err) {
				if (_this.log !== null) {
					_this.log.error(err);
				}
			}
		});
	} else if (_this.strategy === 'timed-eject') {
		if (_this.log) _this.log.trace("Ejecting " + service);
		_this.cacheMap[service] = undefined;
	}
}

function setTimerForService(service) {
	let _this = this;
	let statusObj = _this.updateStatus[service];
	if (_this.strategy === 'always-poll') {
		return;
	}
	if (statusObj.timerHandle !== null) {
		return;
	}
	statusObj.timerHandle = setTimeout(function(){
		_this.timerTickForService(service);
	}, _this.ttl * 1000);
}

exports.buildCache = function(options) {
	let cache = {
		strategy: 'maintain-via-poll',
		cacheMap: {},
		updateStatus: {},
		ttl: 5,
		consulAgent: null,
		log: null,
		setTimerForService: setTimerForService,
		timerTickForService: timerTickForService,
		addressesForService: addressesForService, 
		lookupService: lookupService,
		dispatchLookup: dispatchLookup,
		events: new EventEmitter(),
	}
	Object.assign(cache, options);
	return cache;
}