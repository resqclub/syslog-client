let tls = require('tls')
let os = require('os')
let fs = require('fs')

let ON_DEATH = require('death')({ uncaughtException: true })

class SyslogClient {
	/*
	Create a new client. Connect immediately. You can use client.log()
	immediately - messages will be queued and sent when the socket has
	connected.

	Example options follow. The most important is `appname` - most others
	have pretty good defaults.

	options: {
		// appname for syslog
		appname: 'app',

		// hostname for syslog, usually ignored by cloud services
		hostname: 'hostname',

		// procid for syslog, usually ignored by cloud services
		procid: 12345,

		// Also log to console?
		// By default, messages are only logged to console when they
		// could not be delivered, temporarily or permanently, to the
		// syslog server.
		alsoLogToConsole: false,

		// Log information about internal state changes
		debug: false,

		// Do not print normal diagnostic messages (such as information
		// about when the connection to server has been established)
		quiet: false,

		// Use this function to log to console
		consoleLog: (...args) => { console.log(...args) },

		// Options passed directly to tls.connect()
		// https://nodejs.org/api/tls.html#tls_tls_connect_options_callback
		tlsOptions: {},

		// Set socket timeout (0 means don't set one)
		socketTimeout: 15000,

		// Parameters for the simple exponential backoff algorithm that is
		// used when connecting to the syslog server fails or the connection
		// is closed:

		// First reconnect after this many ms
		firstReconnectTime: 2000,

		// multiply reconnect time by this after each unsuccessful attempt
		subsequentReconnectMultiplier: 1.4,

		// ...until it's as big as this as this
		maximumReconnectTime: 10000

		// When the total amount of bytes in enqueued log lines reaches
		// this, queueOverflowHandler is called. It should dump the queue
		// somewhere safe. The queue is then discarded.
		queueOverflowLimit: 1000000,

		// A handler that (hopefully) saves the queued messages somewhere.
		// The default behavior is to append the messages to a file named
		// YYYY-MM-DDTHH.log
		queueOverflowHandler: (queue) => {
			// dump queue somewhere
		},

		// Used by the default queueOverflowHandler; defaults to `${appname}-`
		logPrefix: 'app'

		// By default, queueOverflowHandler is also called when the process
		// exits; here's an option if you want to override this
		installExitHandler: true
	}
	*/
	constructor(host, port, options = {}) {
		let defaultQueueOverflowHandler = queue => {
			// Empty queue? Nothing to handle.
			if (queue.length === 0) {
				return
			}

			// Looks like '2019-09-23T11.log' - a new one will be created
			// every hour
			let filename = `${this.logPrefix}${new Date()
				.toISOString()
				.substring(0, 13)}.log`
			let content = queue.join('\n') + '\n'

			let bytes = Buffer.byteLength(content, 'utf8')

			if (!this.quiet) {
				this.consoleLog(
					`[syslog] writing ${queue.length} enqueued lines (${bytes} bytes) to ${filename}`
				)
			}

			// A megabyte should be small enough to dump synchronously
			fs.appendFileSync(filename, content, 'utf8')
		}

		let allOptions = Object.assign({
			appname: 'app',
			hostname: os.hostname(),
			procid: process.pid,
			alsoLogToConsole: false,
			debug: false,
			quiet: false,
			consoleLog: (...args) => console.log(...args),
			debugLog: (...args) => {
				if (this.debug) {
					this.consoleLog(`[syslog (${this.state})]`, ...args)
				}
			},
			tlsOptions: {},
			socketTimeout: 15000,

			firstReconnectTime: 2000,
			subsequentReconnectMultiplier: 1.4,
			maximumReconnectTime: 15000,

			queueOverflowLimit: 1000000,
			queueOverflowHandler: defaultQueueOverflowHandler,

			installExitHandler: true,
		}, options)

		this.host = host
		this.port = port

		this.appname = allOptions.appname
		this.hostname = allOptions.hostname
		this.procid = allOptions.procid
		this.alsoLogToConsole = allOptions.alsoLogToConsole
		this.debug = allOptions.debug
		this.quiet = allOptions.quiet
		this.consoleLog = allOptions.consoleLog
		this.debugLog = allOptions.debugLog
		this.tlsOptions = allOptions.tlsOptions
		this.socketTimeout = allOptions.socketTimeout
		this.firstReconnectTime = allOptions.firstReconnectTime
		this.subsequentReconnectMultiplier = allOptions.subsequentReconnectMultiplier
		this.maximumReconnectTime = allOptions.maximumReconnectTime
		this.queueOverflowLimit = allOptions.queueOverflowLimit
		this.queueOverflowHandler = allOptions.queueOverflowHandler
		this.installExitHandler = allOptions.installExitHandler

		this.logPrefix = options.hasOwnProperty('logPrefix')
			? options.logPrefix
			: this.appname + '-'

		if (this.installExitHandler) {
			ON_DEATH(() => {
				this.queueOverflowHandler(this.queue)

				// Give other handlers a chance to run before exiting
				setTimeout(function() {
					process.exit()
				}, 1)
			})
		}

		// This is the connect time that is used for the next connection
		// attempt.
		this.nextReconnectTime = this.firstReconnectTime

		// Queue of messages that could not be delivered because socket was
		// not in connected state.
		this.queue = []
		this.queueSize = 0

		this._state = 'closed'
		// Provides more information when an error or timeout happens
		this.errorState = ''

		if (!this.quiet) {
			this.consoleLog(
				`[syslog] logging to syslog server at ${this.host}:${this.port}`
			)
		}
		this.connect()
	}

	get state() {
		return this._state
	}

	set state(newState) {
		let oldState = this._state

		// Block all state changes from 'wait-reconnect' to anything else than
		// 'connecting' or 'connected', because as long as we are not
		// connecting or connected, we are waiting to start a new connection.
		if (
			oldState === 'wait-reconnect' &&
			(newState !== 'connecting' && newState !== 'connecting')
		) {
			if (oldState === 'wait-reconnect' && newState === 'closed') {
				// This happens when the connection is refused; the socket
				// produces and error event (that sets state to wait-reconnect),
				// followed by close event. It's safe to just ignore it.
				return
			}
			this.debugLog(`Ignore state change attempt (to ${newState})`)
			return
		}

		this.debugLog(`state = ${newState}`)

		this._state = newState

		// State changed to 'connected'?
		let weJustBecameConnected =
			oldState !== 'connected' && newState === 'connected'

		// State changed to 'not connected'? This indicates that we need to
		// reconnect after waiting a bit.
		let weJustBecameDisconnected =
			(oldState === 'connected' || oldState === 'connecting') &&
			(newState !== 'connected' && newState !== 'connecting')

		if (weJustBecameConnected) {
			// Send the queued messages...
			for (let message of this.queue) {
				this.log(message)
			}

			if (!this.quiet) {
				if (this.queue.length) {
					this.consoleLog(
						`[syslog] connected to server, ${this.queue.length} queued messages sent`
					)
				} else {
					this.consoleLog(`[syslog] connected to server`)
				}
			}

			// ...empty the queue...
			this.queue = []
			this.queueSize = 0

			// ...clear error state...
			this.errorState = ''

			// ...and reset the exponential backoff reconnect algorithm wait
			// time. Situation back to normal.
			this.nextReconnectTime = this.firstReconnectTime
		}

		if (weJustBecameDisconnected) {
			if (!this.quiet) {
				if (this.debug) {
					this.consoleLog(
						`[syslog] could not connect to server (${
							this.errorState
						}), retrying in ${(0.001 * this.nextReconnectTime).toFixed(
							1
						)} s; state = wait-reconnect`
					)
				} else {
					this.consoleLog(
						`[syslog] could not connect to server (${
							this.errorState
						}), retrying in ${(0.001 * this.nextReconnectTime).toFixed(1)} s`
					)
				}
			}

			this._state = 'wait-reconnect'

			setTimeout(() => {
				this.connect()
			}, this.nextReconnectTime)

			this.nextReconnectTime =
				Math.min(
					this.nextReconnectTime * this.subsequentReconnectMultiplier,
					this.maximumReconnectTime
				) | 0
		}
	}

	connect() {
		this.state = 'connecting'
		let socket = tls.connect(this.port, this.host, this.tlsOptions)
		this.socket = socket

		if (this.socketTimeout) {
			this.socket.setTimeout(this.socketTimeout)
		}

		this.socket.setKeepAlive(true)
		this.socket.setNoDelay()

		this.socket.on('secureConnect', () => {
			if (socket === this.socket) {
				this.state = 'connected'
			}
		})

		this.socket.on('error', err => {
			// Some more common errors in human-readable form
			let errors = {
				ECONNREFUSED: 'connection refused',
				ENOTFOUND: 'could not resolve hostname',
				EHOSTUNREACH: 'no route to host',
				EADDRNOTAVAIL: 'address not available'
			}

			if (err.code) {
				if (errors[err.code]) {
					this.errorState = errors[err.code]
				} else {
					this.errorState = `error ${err.code}`
				}
			} else {
				this.errorState = `error ${err.message}`
			}

			if (socket === this.socket) {
				this.debugLog(`socket error ${err.code}`)
				this.state = 'error'
			} else {
				this.debugLog(`socket error ${err.code} (old socket; destroying it)`)
				socket.destroy()
			}
		})

		this.socket.on('close', () => {
			if (socket === this.socket) {
				this.errorState = 'connection closed'
				this.state = 'closed'
			}
		})

		this.socket.on('timeout', () => {
			if (socket === this.socket) {
				// Ignore timeout events that occur in the connected state; it
				// just means that there the socket has seen no activity
				if (this.state === 'connected') {
					return
				}

				let time = (0.001 * this.socketTimeout).toFixed(1)
				this.errorState = `no response in ${time} s`
				this.state = 'timeout'
				// This should ensure that the old socket will not
				// produce the ETIMEDOUT message - though the 'error'
				// handler still handles it just to be sure.
				this.socket.destroy()
			}
		})
	}

	formatMessage(line) {
		let facility = 1 // user
		let severity = 6 // informational

		let pri = `<${facility * 8 + severity}>`
		let timestamp = new Date().toISOString()
		let appname = this.appname
		let hostname = this.hostname
		let procid = this.procid

		let header = `${timestamp} ${hostname} ${appname}[${procid}]`

		return `${pri} ${header}: ${line}\n`
	}

	// Send `message` to target. If it contains newlines, the message will
	// be sent in parts. Empty lines will be discarded.
	//
	// If there is no connection to the syslog server, the message will be
	// queued and sent immediately when the connection is established again.
	log(message) {
		message = String(message)

		let lines = message.split('\n').filter(Boolean)
		for (let line of lines) {
			// Would work with state 'connecting' as well but it's nice to test
			// this feature with it so let's not write() while connecting.

			if (this.alsoLogToConsole) {
				this.consoleLog(line)
			}

			if (this.state === 'connected') {
				this.socket.write(this.formatMessage(line))
				// this.consoleLog('[log]', line)
			} else {
				if (this.debug) {
					// In debug mode, also report the current state
					this.consoleLog(`[q (${this.state})]`, line)
				} else {
					this.consoleLog(`[q]`, line)
				}
				this.queue.push(line)
				this.queueSize += Buffer.byteLength(line, 'utf8') + 1

				if (this.queueSize >= this.queueOverflowLimit) {
					this.queueOverflowHandler(this.queue)
					this.queue = []
					this.queueSize = 0
				}
			}
		}
	}
}

module.exports.SyslogClient = SyslogClient
