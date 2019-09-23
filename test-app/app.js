let fs = require('fs')
let { SyslogClient } = require('../index')

let options = {
	tlsOptions: {
		ca: [fs.readFileSync('../test-server/server-cert.pem')]
	}
}

let syslog = new SyslogClient('localhost', 5555, options)

let i = 0
setInterval(() => {
	syslog.log('Hello ' + i++)
}, 1000)
