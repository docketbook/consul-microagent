"use strict";

const os = require('os');

let serviceName = Math.floor(Math.random() * 100000).toString();

exports.testConfiguration = {
  "consul":{
    "host":"192.168.99.100",
    "port":8500
  },
  "service":{
  	"identifier": serviceName + '-' + os.hostname(),
  	"name": serviceName,
  	"port":8080 
  }
}

exports.importTest = function(name, path) {
  describe(name, function () {
    require(path);
  });
}