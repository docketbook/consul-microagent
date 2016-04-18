"use strict";

let common = require("./common");
let expect = require('chai').expect;

describe("micro agent", function () {
    before(function(done) {
        done();
    });
    after(function(done) {
        done();
    });
    common.importTest("agent", './agent');
    common.importTest("address cache", './address_cache');
    common.importTest("restify client", './restify_client');
});