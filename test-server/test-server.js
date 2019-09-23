let log = console.log

let tls = require('tls')
let fs = require('fs')

let options = {
	key: fs.readFileSync(__dirname + '/server-key.pem'),
	cert: fs.readFileSync(__dirname + '/server-cert.pem'),
}

let server = tls.createServer(options, socket => {
	log('Client connected')

	socket.setEncoding('utf-8')
	socket.on('end', () => {
		log('[server] socket end')
	})
	socket.on('error', err => {
		log('[server] socket error', err)
	})
	socket.on('data', data => {
		data = data.replace(/\n$/, '')
		log(data)
	})
})

server.listen(5555, () => {
	log('Listening...')
})


