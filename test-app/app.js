let fs = require('fs')
let { SyslogClient } = require('../index')

let options = {
	// To make TLS work with the local server, we need some certificate
	// trickery.
	tlsOptions: {
		ca: [fs.readFileSync(__dirname + '/../test-server/server-cert.pem')]
	},

	// Artificially low limit so that you can easily trigger the overflow limit
	queueOverflowLimit: 200
}

let syslog = new SyslogClient('localhost', 5555, options)

let i = 0
setInterval(() => {
	syslog.log('Hello ' + i++)
}, 1000)
