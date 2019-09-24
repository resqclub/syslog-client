let fs = require('fs')
let { SyslogClient } = require('../index')

let options = {
	// To make TLS work with the local server, we need some certificate
	// trickery.
	tlsOptions: {
		ca: [fs.readFileSync(__dirname + '/../test-server/server-cert.pem')]
	},

	// debug: true,
	// socketTimeout: 2000,

	// Artificially low limit so that you can easily trigger the overflow limit
	queueOverflowLimit: 200
}


// This will likely timeout - use to test timeout when connecting
// let HOST = '1.1.1.1'
// let PORT = 1234

// This will likely fail to connect because no route to host
// let HOST = '0.1.1.1'
// let PORT = 1234

// This should trigger a TSL error of some kind
// let HOST = 'google.com'
// let PORT = 80

// This will at least connect (if you don't give the tlsOptions
// parameter), but won't probably do much good :)
// let HOST = 'google.com'
// let PORT = 443

// And this should work (if you run the test server)
let HOST = 'localhost'
let PORT = 5555

let syslog = new SyslogClient(HOST, PORT, options)

// An example on how to use the default overflow handler in addition to your
// own one
let defaultQueueOverflowHandler = syslog.queueOverflowHandler
syslog.queueOverflowHandler = (queue) => {
	defaultQueueOverflowHandler(queue)
	console.log('Remember to check out the log file!')
}

let i = 0
setInterval(() => {
	syslog.log('Hello world ' + i++)
}, 1000)
