"use strict";

const async = require('async');

function addressForService(service, options, callback) {
	let force = false;
	let _this = this;
	if ('force' in options) force = options.force;
	return this.addressCache.addressesForService(service, force, function(err, addresses) {
		if (err) return callback(err, null);
		let validAddresses = addresses;
		if ('blacklist' in options) {	
			validAddresses = validAddresses.filter(function(element, index, array) {
				return options.blacklist.indexOf(element.fullAddress) === -1;
			});
		}
		//if none are valid, bail out
		if (validAddresses.length === 0) {
			return callback(null, null);
		}
		//we have a valid list of addresses - we need to select one based on strategy
		//either round-robin - select the first 0 client. if none, reset all to 0 and select the first
		//or random - random number between 0 and number of addresses
		let selectedAddress = null;
		validAddresses.forEach(function(address) {
			if (_this.services[service].addressUsage[address.id] === undefined) {
				_this.services[service].addressUsage[address.id] = 0;
			}
			if (_this.services[service].addressUsage[address.id] === 0) {
				if (selectedAddress === null) {
					selectedAddress = address;
				}
			}
		});
		if (_this.strategy === 'round-robin') {
			if (selectedAddress === null) {
				//reset them all to 0 and take the first
				selectedAddress = validAddresses[0];
				validAddresses.forEach(function(address) {
					_this.services[service].addressUsage[address.id] = 0;
				});
			}
		} else if (_this.strategy === 'random') {
			let randomIndex = Math.floor(Math.random() * validAddresses.length);
			selectedAddress = validAddresses[randomIndex];
		}
		_this.services[service].addressUsage[selectedAddress.id] = 1;
		return callback(null, selectedAddress);
	});
}

function buildClient(address, restifyOptions) {
	let _this = this;
	let urlObj = {
		scheme: 'http',
		host: address.address,
		port: address.port,
		path: ''
	}
	if ('scheme' in restifyOptions) {
		urlObj.scheme = restifyOptions.scheme;
	}
	if ('path' in restifyOptions) {
		urlObj.path = restifyOptions.path;
	}
	let url = `${urlObj.scheme}://${urlObj.host}:${urlObj.port}${urlObj.path}`;
	let factory = _this.restify.createJsonClient;
	if ('factory' in restifyOptions) {
		factory = restifyOptions.factory;
	}
	let newClient = factory({
		url: url
	});
	return newClient;
}

function clientForService(service, options, callback) {
	let _this = this;
	let opts = options;
	let cb = callback;
	if (typeof opts === 'function') {
		cb = opts;
		opts = {};
	}
	if (this.services[service] === undefined) {
		this.registerService(service, opts);
	}
	if (_this.useDns) {
		if (_this.services[service].clients['dns'] === undefined) {
			let restifyOptions = {};
			if ((_this.services[service].defaultOptions !== null) && 
				(_this.services[service].defaultOptions !== undefined)) {
				Object.assign(restifyOptions, _this.services[service].defaultOptions);
			}
			if ('restify' in opts) {
				Object.assign(restifyOptions, opts.restify);
			}
			let path = service + _this.dnsSuffix;
			_this.services[service].clients['dns'] = _this.buildClient(path, restifyOptions);
		}
		return cb(null, _this.services[service].clients[address.id]);
	} else {
		return this.addressForService(service, opts, function(err, address) {
			if (err) return cb(err, null);
			if (_this.services[service].clients[address.id] === undefined) {
				//build it
				let restifyOptions = {};
				if ((_this.services[service].defaultOptions !== null) && 
					(_this.services[service].defaultOptions !== undefined)) {
					Object.assign(restifyOptions, _this.services[service].defaultOptions);
				}
				if ('restify' in opts) {
					Object.assign(restifyOptions, opts.restify);
				}
				_this.services[service].clients[address.id] = _this.buildClient(address, restifyOptions);
			}
			return cb(null, _this.services[service].clients[address.id]);
		});
	}
}

function clientForServices(services, options, callback) {
	let opts = options;
	let cb = callback;
	if (typeof opts === 'function') {
		cb = opts;
		opts = {};
	}
	let _this = this;
	async.map(services, function(service, doneCallback){
		_this.clientForService(service, opts, doneCallback);
	}, function(err, results) {
		return cb(err, results);
	});
}

function registerService(service, options) {
	this.services[service] = {
		addressUsage: {},
		clients: {},
		defaultOptions: options.restify
	};
}

function deregisterService(service) {
	this.services[service] = undefined;
}

exports.buildCache = function(options) {
	let cache = {
		useDns: true,
		dnsSuffix: '.service.consul',
		addressCache: null,
		log: null,
		services: {},
		strategy: 'round-robin',
		registerService: registerService,
		deregisterService: deregisterService,
		clientForService: clientForService,
		buildClient: buildClient,
		addressForService: addressForService,
		clientForServices: clientForServices
	}
	Object.assign(cache, options);
	if (cache.restify === undefined) {
		try {
			cache.restify = require('restify');
		} catch (e) {
			throw new Error("Unable to load Restify - wasn't supplied and require'able");
		}
	}
	return cache;
}