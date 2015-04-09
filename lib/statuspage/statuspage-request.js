if (global.GENTLY_HIJACK) require = GENTLY_HIJACK.hijack(require);

var https = require("https"),
    _ = require("underscore"),
    qs = require('qs'),
    StatusPageBase = require("./statuspage-base"),
    logger = require("../logger");

// Array of valid API elements that can be used for POST requests
var ELEMENTS_POST = [
    'incidents',
    'subscribers'
];
// Array of valid API elements that can be used for GET requests
var ELEMENTS_GET = [
    'pages',
    'components',
    'incidents', 'incidents/unresolved', 'incidents/scheduled',
    'subscribers'
];

// var ELEMENTS_DELETE = [
//     'incidents',
//     'subscribers'
// ]

var isValidOperation = function(method, element) {
    // Validate Request method and element.
    var validity = false;
    switch(method) {
        case "GET":
            validity = element && _(ELEMENTS_GET).include(element.toLowerCase());
            break;
        case "POST":
            validity = element && _(ELEMENTS_POST).include(element.toLowerCase());
            break;
        // case "PATCH":
        //     validity = method && _(ELEMENTS_PATCH).include(method.toLowerCase());
        // case "PUT":
        //     validity = method && _(ELEMENTS_PUT).include(method.toLowerCase());
        // case "DELETE":
        //     validity = method && _(ELEMENTS_DELETE).include(method.toLowerCase());
    }
    logger.log('debug',('Validity(' + method + ', ' + element + '): ' + validity));
    return validity;
}

var isWriteOperation = function(httpVerb) {
    return httpVerb == "POST" || httpVerb == "PATCH" || httpVerb == "PUT";
}

var requestHeaders= function(httpVerb, data) {
    var headers = {
      "User-Agent": statuspage.useragent,
      "Authorization": statuspage.apikey
    };

    if (isWriteOperation(httpVerb)) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      headers['Content-Length'] = Buffer.byteLength(data);
    }
    return headers;
}

var makeUrl = function(pageId, element) {
    // Combine page ID and element to form request URI
    // TODO: This function will need to be updated to support 
    // additional elements and operations 
    var url = "/v1/pages/" + pageId;
    if (element == "pages") {
        url += ".json";

    } else {
        url += "/" + element + ".json";
    }
    return url;
}

var StatusPageRequest = function(statuspage) {
    StatusPageBase.call(this);
    this.statuspage = statuspage;
    logger.debugLevel = statuspage.debuglevel;
    that = this;
    // Register handlers with base
    // This has been replaced with callbacks, but could fairly easily 
    // be re-implemented if needed
    // that.registerHandlers(handlers);
};

StatusPageRequest.prototype = Object.create(StatusPageBase.prototype);

StatusPageRequest.prototype.chunkedResponse = function(res, callback) {
    var self = that;
    var data = '';
    var result = {}
    res.on('data', function(chunk) {
        data += chunk.toString('utf8');
    });
    res.on('end', function() {
        // Package response data
        var json = {}
        json.data = {}
        json.response = {};
        json.response.statusCode = res.statusCode;
        json.response.statusMessage = res.statusMessage;
        json.response.headers = res.headers;

        try {
            logger.log('debug', ['Raw Response data: ', data]);
            json.data = JSON.parse(data);
            // Error parsing JSON response
            if (json.error) {
                result.status = "error";
                result.error = json;
                self.emit('error', json);
            }
            // Status OK, so return success
            if (res.statusCode == "200" ||  res.statusCode == "201"){
                result.status = "success";
                result.error = null;
                result.data = json.data; 
            // Something went wrong
            } else {
                var message = "Unexpected response: " + 
                    json.response.statusCode +' ' + 
                    json.response.statusMessage;
                result.status = "failure";
                result.error = message;
            }
            self.emit('success', json);
        }
        // Catch and return errors
        catch(e) {
            result.status = "error";
            result.error = e;
            self.emit('error', e);
        }
        if (callback != undefined) {
            callback(result);
        } else {
            return result;
        }
    });
}

StatusPageRequest.prototype.sendRequest = function(method, element, args, callback) {
    statuspage = this.statuspage;
    args = args || {};
    if (isValidOperation(method, element)) {
        // Prepare data to be sent to API
        var host = statuspage.host,
        port = statuspage.port,
        url = makeUrl(statuspage.pageid, element);
        httpVerb = method,
        data = qs.stringify(args, { arrayFormat: 'brackets' });
        var options = {
            host: host,
            port: port,
            path: url,
            method: httpVerb,
            headers: requestHeaders(httpVerb, data)
        };
        logger.log('debug',["Query String: ", data]);
        logger.log('debug',["Request options: ", options]);
        // Send API request
        var req = https.request(options, function(res){
            that.chunkedResponse(res, callback)
        });
        req.on("error", function(error) {
            that.emit("error", error);
        });
        if (isWriteOperation(httpVerb)) {
            req.write(data, encoding='utf8');
        }
        req.end();
    } else {
        // Emit warning
        warningMessage = 'Request is not supported. ' + method + ': ' + element;
        this.on('warning', function(e) {
            logger.log('warn', warningMessage);
        });
        that.emit("warning", warningMessage);
    }
}

// Export
module.exports = StatusPageRequest;
