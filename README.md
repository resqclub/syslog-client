# @resqclub/syslog-client

Here's a syslog client that is not particularly configurable when it
comes to transports (only TLS supported) or syslog features (such as
setting facility and severity, which are set to 1 - user-level messages,
and 6 - informational, respectively).

Instead, it focuses on robustness. When the network connection to the
server is closed or cannot be established, the messages are kept in a
queue that is flushed to the server once the connection is back up
again. When a disconnect is detected, the client tries to reconnect to
the server using a exponential backoff strategy. By default, the delay
between reconnection attempts is between 2 and 15 seconds.

In addition, if the total size of enqueued messages reaches a limit (by
default, 1000000 bytes), a queue overflow handler is called and the
queue is discarded. The default overflow handler appends the message
queue to a log file (for example 'app-2019-09-23T13.log'). The overflow
handler is also called when the process is about to be terminated due to
a signal.

A usage example:

```
let { SyslogClient } = require('@resqclub/syslog-client')

let options = {
	// The only option that really matters
	appname: 'my-app'
}

let syslog = new SyslogClient('some.syslog-server.net', 12345, options)

syslog.log('Hello world!')
```

By default, `syslog-client` does not log the messages to console in
addition to sending them to the remote server. (This behavior can be
changed by setting the `alsoLogToConsole` option.) However, if the
connection is not established and the message is enqueued, it is also
fed to `console.log` with the `[q]` prefix.

In addition, the client prints out diagnostic messages to the console,
such as:

```
[syslog] logging to syslog server at localhost:5555
```

```
[syslog] could not connect to server (connection refused), retrying in 5.5 s
```

```
[syslog] writing 91 enqueued lines (1001 bytes) to app-2019-09-23T14.log
```

If you don't care for these messages, you can set the `quiet` option.
(For totally silent operation, set the `consoleLog` option to a function
that does nothing.)

To test the different failure modes, you're welcome to experiment with
`test-app/app.js` and its accompanying test server.

```
% node test-app/app.js
[syslog] logging to syslog server at localhost:5555
[syslog] could not connect to server (connection refused), retrying in 2.0 s
[q] Hello 0
[q] Hello 1
[syslog] could not connect to server (connection refused), retrying in 2.8 s
[q] Hello 2
[q] Hello 3
[syslog] connected to server, 4 queued messages sent
```

At the same time, run `test-server/test-server.js` that prints out the
messages verbatim:

```
% node test-server/test-server.js
Listening...
Client connected
<14> 2019-09-23T14:23:56.111Z zen app[89273]: Hello 0
<14> 2019-09-23T14:23:56.111Z zen app[89273]: Hello 1
<14> 2019-09-23T14:23:56.111Z zen app[89273]: Hello 2
<14> 2019-09-23T14:23:56.111Z zen app[89273]: Hello 3
<14> 2019-09-23T14:23:56.302Z zen app[89273]: Hello 4
<14> 2019-09-23T14:23:57.306Z zen app[89273]: Hello 5
<14> 2019-09-23T14:23:58.308Z zen app[89273]: Hello 6
```

Note that the timestamps for the queued messages are not generated at
the time the message is enqueued, but at the time it is sent. This
decision is partly due to laziness and partly to the fact that most log
service providers don't care about the timestamp anyway but generate
their own instead.

For complete list of options, feel free to [read the source
code](https://github.com/resqclub/syslog-client/blob/master/index.js#L16).

