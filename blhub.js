'use strict';

const fs = require('fs');
const crypto = require('crypto');

const broadlinkProbe = require('broadlink-core');
const findBroadcastAddresses = require('broadlink-core/util.js').findBroadcastAddresses;
const ipaddr = require('ipaddr.js');

const Optist = require('optist');
const ou = require('optist/util');

const ApiSrv = require('tr-apisrv');
const WebSocket = require('ws');

const sleeper = require('./sleeper.js');

const mimetype = require('./mimetype.js');

var d = {
	ips: new Map(),
	devs: new Map(),
	failed: new Map(),
	seen: new Map(),
	wss: new WebSocket.Server({ noServer: true }),
	packageData: JSON.parse(fs.readFileSync('./package.json', 'utf8'))
};

// Rewriting the command line parameters for the happy case that this
// is actually run in Hassio addon instead of independently. In that
// case, most of the command line parameters comes from addon
// configuration.  Usual command line parameters from Hassio addon are
// exactly following: --listen-address=0.0.0.0 --listen-port=8525
// --hassio-addon-config=/data/options.json
{
	let av = [];
	let hassio = false;
	av.push(process.argv.shift());
	av.push(process.argv.shift());
	while (process.argv.length > 0) {
		try {
			let m, a = process.argv.shift();
			if (m = a.match(/^--hassio-addon-config=(.*)$/)) {
				if (hassio) {
					throw new Error("Only one --hassio-addon-config is allowed");
				}
				hassio = true;
				let options = JSON.parse(fs.readFileSync(m[1], 'utf8'));
				if (options.debug) {
					av.push('--debug');
				}
				if (options.name) {
					av.push('--name=' + options.name);
				}
				if (options.user) {
					av.push('--user=' + options.user);
				}
				if (options.password) {
					av.push('--password=' + options.password);
				}
				if (options.password_hash) {
					av.push('--password-hash=' + options.password_hash);
				}
				if (options.device_timeout) {
					av.push('--device-timeout=' + options.device_timeout);
				}
				if (options.update_interval) {
					av.push('--update-interval=' + options.update_interval);
				}
				if (options.device_ips) {
					options.device_ips.forEach(function(x) { av.push('--ip=' + x); });
				}
				if (options.device_ip_ranges) {
					options.device_ip_ranges.forEach(function(x) { av.push('--ip-range=' + x); });
				}
			} else {
				av.push(a);
			}
		} catch (e) {
			console.log(e);
			process.exit(1);
		}
	}
	process.argv = av;
}

var opt = ((new Optist())
		   .opts([ { longName: 'listen-address',
					 description: 'IP address the server listens to',
					 hasArg: true,
					 defaultValue: '127.0.0.1',
					 optArgCb: ou.ipv4 },
				   { longName: 'listen-port',
					 description: 'TCP port the server listens to',
					 hasArg: true,
					 optArgCb: ou.integerWithLimitsCbFactory(1, 65535),
					 required: true },
				   { longName: 'user',
					 description: 'Username for basic authentication',
					 hasArg: true,
					 requiresAlso: [ 'password' ] },
				   { longName: 'password',
					 description: 'Password for basic authentication',
					 hasArg: true,
					 requiresAlso: [ 'user' ] },
				   { longName: 'password-hash',
					 description: 'Hash function for password',
					 hasArg: true,
					 optArgCb: ou.allowListCbFactory(crypto.getHashes()),
					 requiresAlso: [ 'password' ] },
				   { longName: 'device-timeout',
					 description: 'Timeout in milliseconds to wait for device to answer',
					 hasArg: true,
					 optArgCb: ou.integerWithLimitsCbFactory(1, 60000),
					 defaultValue: '1000' },
				   { longName: 'update-interval',
					 description: 'Timeout in milliseconds between device polls',
					 hasArg: true,
					 optArgCb: ou.integerWithLimitsCbFactory(1, 60000),
					 defaultValue: '10000' },
				   { longName: 'ip',
					 description: 'IP address the server probes for device',
					 multi: true,
					 hasArg: true,
					 optArgCb: ou.ipv4 },
				   { longName: 'ip-range',
					 description: 'Range of IP addresses (max 100) the server probes for device',
					 multi: true,
					 hasArg: true,
					 optArgCb: function(v) { return ipRangeExpandCb(v, 100); } },
				   { longName: 'name',
					 description: 'Name of the controller (e.g. "Home")',
					 hasArg: true,
					 defaultValue: '' },
				   { longName: 'debug',
					 shortName: 'd',
					 description: 'Enable debug.' },
				   { longName: 'broadcast',
					 description: 'Local IP address or network interface name sending broadcasts',
					 hasArg: true,
					 optArgCb: broadcastSourceCb }
				 ])
		   .help(d.packageData.name)
		   .parse(undefined, 0, 0));

var debug = opt.value('debug');

function broadcastSourceCb(value) {
	let x;
	try {
		x = findBroadcastAddresses(value);
	} catch(e) {
		x = undefined;
	}
	return x ? value : undefined;
}

(async function() {
	d.wss.on('connection', wsCb);
	var srv = new ApiSrv({ port: opt.value('listen-port'),
						   address: opt.value('listen-address'),
						   callback: cb,
						   authCallback: authCb,
						   upgradeCallback: upgradeCb,
						   prettyPrintJsonResponses: true,
						   bodyReadTimeoutMs: 5000,
						   debug: debug
						 });
	opt.value('ip').forEach(function(a) { d.ips.set(a, null); });
	opt.value('ip-range').forEach(function(ar) { ar.forEach(function(a) { d.ips.set(a, null); }); });
	await periodic();
})();

function notify(status, device) {
	var s = JSON.stringify({ status: status, now: Date.now(), device: device });
	d.wss.clients.forEach(function(ws) {
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(s);
		}
	});
}

function exportDev(dev) {
	var r = {
		uid: dev.uid,
		name: dev.name,
		address: dev.address,
		port: dev.port,
		mac: Array.from(dev.mac).reduce(function(a, b) { return (((a === '') ? '' : (a + ':')) + (('0' + b.toString(16)).slice(-2))); }, ''),
		devClass: dev.devClass,
		devType: dev.devType,
		devTypeId: '0x' + (('000' + dev.devTypeId.toString(16)).slice(-4)),
		udata: Object.assign({}, dev.udata)
	}
	return r;
}

var periodicRunReq = 0;
var periodicTimeout = null;
var broadcastTimeout = null;
var broadcastCtr = 0;

async function broadcast() {
	if (broadcastTimeout) {
		broadcastTimeout = null;
	}
	broadcastCtr++;
	var bc = opt.value('broadcast');
	if (! bc) {
		return;
	}
	var dd = await broadlinkProbe(null, opt.value('device-timeout'), bc);
	dd.forEach(function(dev) {
		if (! d.ips.has(dev.address)) {
			if (debug) {
				console.log('Discovered class ' + dev.devClass + ' device at ' + dev.address);
			}
			d.ips.set(dev.address, null);
		}
	});
	var st = 60000;
	if (broadcastCtr < 10) {
		st = 1000;
	} else if (broadcastCtr < 100) {
		st = 10000;
	}
	broadcastTimeout = setTimeout(broadcast, st);
}

broadcast();

async function periodicRun() {
	if (periodicTimeout) {
		if (debug) {
			console.log('running periodic now');
		}
		clearTimeout(periodicTimeout);
		periodicTimeout = null;
		return periodic();
	}
	if (debug) {
		console.log('requesting running periodic once it completes');
	}
	return ++periodicRunReq;
}

async function periodic() {
	periodicTimeout = null;	
	var pl = [];
	function update(uid, ip) {
		let dev, power, energy;
		if (uid) {
			dev = d.devs.get(uid);
			pl.push(sleeper(1, 200)
					.then(function() {
						switch (dev.devClass) {
						case 'sp2':
						case 'sp3':
						case 'sp3s':
							return checkPower(dev, opt.value('device-timeout'));
						}
						return undefined;
					})
					.then(function(ret) {
						power = ret;
						switch (dev.devClass) {
						case 'sp3s':
							return (power ? checkEnergy(dev, opt.value('device-timeout')) : 0.0);
						}
						return undefined;
					})
					.then(function(ret) {
						energy = ret;
						let now = Date.now();
						dev.udata.lastSeen = now;
						d.seen.set(dev.uid, Date.now());
						let update = false;
						let udata = { lastSeen: dev.udata.lastSeen };
						if ((power !== undefined) && (power != dev.udata.power)) {
							dev.udata.power = udata.power = power;
							update = true;
						}
						if ((energy !== undefined) && (energy != dev.udata.energy)) {
							dev.udata.energy = udata.energy = energy;
							update = true;
						}
						if (update) {
							notify('update', { uid: dev.uid, udata: udata });
						}
						return true;
					})
					.catch(function(e) {
						if (debug) {
							console.log(e);
						}
						d.devs.delete(dev.uid);
						d.ips.set(dev.address, null);
						notify('unreachable', { uid: dev.uid });
						dev.close();
						d.failed.set(dev.uid, dev);
						return false;
					}));
		} else {
			{
				pl.push(sleeper(1, 200)
						.then(function() {
							return broadlinkProbe(ip, opt.value('device-timeout'))
						})
						.then(function(ret) {
							dev = ret;
							let old = d.devs.get(dev.uid);
							if (old) {
								d.devs.delete(dev.uid);
								d.ips.set(old.address, null);
								old.close();
								notify('unreachable', { uid: old.uid });
							}
							dev.udata = { lastSeen: null };
							switch (dev.devClass) {
							case 'sp2':
							case 'sp3':
							case 'sp3s':
								return checkPower(dev, opt.value('device-timeout'));
							}
							return undefined;
						})
						.then(function(ret) {
							power = ret;
							switch (dev.devClass) {
							case 'sp3s':
								return (power ? checkEnergy(dev, opt.value('device-timeout')) : 0.0);
							}
							return undefined;
						})
						.then(function(ret) {
							energy = ret;
							let now = Date.now();
							dev.udata.lastSeen = now;
							d.seen.set(dev.uid, Date.now());
							if (power !== undefined) {
								dev.udata.power = power;
							}
							if (energy !== undefined) {
								dev.udata.energy = energy;
							}
							d.ips.set(dev.address, dev.uid);
							d.devs.set(dev.uid, dev);
							d.seen.set(dev.uid, now);
							notify('reachable', exportDev(dev));
							return true;
						})
						.catch(function(e) {
							if (dev) {
								dev.close();
								dev = undefined;
							}
							if (debug) {
								console.log(e);
							}
							return false;
						}));
			}
		}
	}
	d.ips.forEach(function(uid, ip) { update(uid, ip); });
	await Promise.all(pl);
	pl = [];
	if (d.failed.size > 0) {
		d.failed.forEach(function(dev, uid, map) { map.delete(uid); update(null, dev.address); });
		await Promise.all(pl);
		pl = [];
	}
	if (periodicRunReq) {
		await sleeper(100, 200);
		periodicRunReq = 0;
		periodic();
		return;
	}
	periodicTimeout = setTimeout(periodic, opt.value('update-interval'));
}

async function setPower(dev, power, timeoutMs) {
	if (typeof(dev) === 'string') {
		dev = d.devs.get(dev);
		if (! dev) {
			throw new Error('Device not online');
		}
	}
	var p, r;
	switch (dev.devClass) {
	case 'sp1':
		p = Buffer.alloc(16);
		p[0] = power ? 1 : 0;
		p[1] = 4;
		p[2] = 4;
		p[3] = 4;
		r = await dev.call(0x66, p, timeoutMs);
		break;
	case 'sp2':
	case 'sp3':
	case 'sp3s':
		p = Buffer.alloc(16);
        p[0] = 2;
		p[4] = power ? 1 : 0;
		r = await dev.call(0x6a, p, timeoutMs);
		break;
	default:
		throw new Error('Power set not supported by device class');
	}
	return (power ? true : false);
}

async function checkEnergy(dev, timeoutMs) {
	if (typeof(dev) === 'string') {
		dev = d.devs.get(dev);
		if (! dev) {
			throw new Error('Device not online');
		}
	}
	switch (dev.devClass) {
	case 'sp3s':
		break;
	default:
		throw new Error('Energy check not supported by device class');
	}
	var p = Buffer.from([8, 0, 254, 1, 5, 1, 0, 0, 0, 45, 0, 0, 0, 0, 0, 0]);
	var r = await dev.call(0x6a, p, timeoutMs);
	if (r.status !== 'ok') {
		throw new Error('Error response from device');
	}
	if (r.command != 0x3ee) {
		throw new Error('Unexpected response to energy check');
	}
	if (r.payload.length < 16) {
		throw new Error('Truncated response to energy check');
	}
	if (r.payload[0] != 8) {
		throw new Error('Unexpected response parameter to energy check');
	}
	let s = (('0' + r.payload[7].toString(16)).slice(-2) +
			 ('0' + r.payload[6].toString(16)).slice(-2) +
			 ('0' + r.payload[5].toString(16)).slice(-2));
	if (! s.match(/^\d\d\d\d\d\d$/)) {
		throw new Error('Unexpected format in energy check response');
	}
	let n = Number.parseInt(s, 10) / 100;
	return n;
}

async function checkPower(dev, timeoutMs) {
	if (typeof(dev) === 'string') {
		dev = d.devs.get(dev);
		if (! dev) {
			throw new Error('Device not online');
		}
	}
	switch (dev.devClass) {
	case 'sp2':
	case 'sp3':
	case 'sp3s':
		break;
	default:
		throw new Error('Power check not supported by device class');
	}
    var p = Buffer.alloc(16);
    p[0] = 1;
    var r = await dev.call(0x6a, p, timeoutMs);
	if (r.status !== 'ok') {
		throw new Error('Error response from device');
	}
	if (r.command != 0x3ee) {
		throw new Error('Unexpected response to power status check');
	}
	if (r.payload.length < 16) {
		throw new Error('Truncated response to power status check');
	}
	if (r.payload[0] != 1) {
		throw new Error('Unexpected response parameter to power status check');
	}
	return (r.payload[4] ? true : false);
}

async function authCb(r) {
	var user = {
		user: opt.value('user'),
		password: opt.value('password')
	};
	if (user.user) {
		r.auth = r.headers.authorization ? parseBasicAuth(r.headers.authorization) : undefined;
		if (! (r.auth && (r.auth.user === user.user) && checkPassword(r.auth.password))) {
			delete r.auth;
			r.res.setHeader('WWW-Authenticate', 'Basic realm="oauth2/client"');
			r.jsonResponse({ status: 'error', code: 401, message: 'Authentication is required' }, 401);
			return false;
		}
	}
	return true;
}

async function upgradeCb(r) {
	if (r.url !== '/status') {
		r.s.destroy();
		return;
	}
	d.wss.handleUpgrade(r.req, r.s, r.head, function(ws) {
		d.wss.emit('connection', ws);
	});
	return true;
}

async function cb(r) {
	var res = r.res, m, rd;
	delete r.res;
    var error = function(code, msg) {
		r.jsonResponse({ status: 'error', code: code, message: msg }, code);
	}
	switch (r.url) {
	case '/status':
		switch (r.method) {
		case 'GET':
			break;
		default:
			error(405, 'Method not allowed.');
			return;
		}
		rd = { timestamp: Date.now(), devices: {} };
		if (r.params['uid']) {
			let dev = d.devs.get(r.params['uid']);
			if (dev) {
				rd.devices[r.params['uid']] = { status: 'reachable', device: exportDev(dev) };
			} else if (d.seen.has(r.params['uid'])) {
				rd.devices[r.params['uid']] = { status: 'unreachable', lastSeen: d.seen.get(r.params['uid']) };
			} else {
				rd.devices[r.params['uid']] = { status: 'unknown' };
			}
		} else {
			d.devs.forEach(function(dev) {
				rd.devices[dev.uid] = { status: 'reachable', device: exportDev(dev) };
			});
			d.seen.forEach(function(lastSeen, uid) {
				if (! d.devs.has(uid)) {
					rd.devices[uid] = { status: 'unreachable', lastSeen: lastSeen };
				}
			});
		}
		r.jsonResponse({ status: 'ok', code: 200, data: rd }, 200);
		return;
	case '/power':
		switch (r.method) {
		case 'GET':
			break;
		default:
			error(405, 'Method not allowed.');
			return;
		}
		if (! r.params['uid']) {
			error(400, 'Missing uid');
			return;
		}
		if (! r.params['power']) {
			error(400, 'Missing power');
			return;
		}
		if (! d.seen.has(r.params['uid'])) {
			error(400, 'Unknown uid');
			return;
		}
		if (! (['on', 'off'].indexOf(r.params['power']) >= 0)) {
			error(400, 'Bad power');
			return;
		}
		{
			let i, power = (r.params['power'] === 'on');
			for (i = 0; i < 10; i++) {
				let rs = (await setPower(r.params['uid'], power, opt.value('device-timeout'))
						  .catch(function(e) {
							  if (debug) {
								  console.log(e);
							  }
							  return undefined;
						  }));
				if (rs === undefined) {
					periodicRun();
					await sleeper(0, 500);
				} else {
					r.jsonResponse({ status: 'ok', code: 200, data: { uid: r.params['uid'], power: power } }, 200);
					let dev = d.devs.get(r.params['uid']);
					if (dev) {
						dev.udata.lastSeen = Date.now();
						dev.udata.power = power;
						notify('update', { uid: dev.uid, udata: { lastSeen: dev.udata.lastSeen,
																  power: dev.udata.power } });
					}
					periodicRun();
					return;
				}
			}
		}
		error(504, d.devs.has(r.params['uid']) ? 'Device timeout' : 'Device unreachable');
		return;
	case '/home-assistant-config':
		switch (r.method) {
		case 'GET':
			break;
		default:
			error(405, 'Method not allowed.');
			return;
		}
		{
			let devs = [];
			if (r.params['uid']) {
				let dev = d.devs.get(r.params['uid']);
				if (dev) {
					devs.push(dev);
				}
			} else {
				d.devs.forEach(function(dev) {
					devs.push(dev);
				});
			}
			if (devs.length < 1) {
				error(404, 'Not found');
				return;
			}
			devs.sort(function(a, b) {
				return ((Buffer.from(ipaddr.IPv4.parse(a.address).toByteArray()).readUInt32BE()) -
						(Buffer.from(ipaddr.IPv4.parse(b.address).toByteArray()).readUInt32BE())); });
			res.setHeader('Content-Type', 'text/plain; charset=utf-8');
			res.write('switch:' + "\n");
			devs.forEach(function(dev) {
				res.write(haConf(dev));
			});
		}
		res.end();
		return;
	default:
		switch (r.method) {
		case 'GET':
			break;
		default:
			error(405, 'Method not allowed.');
			return;
		}
		{
			let fn, mt, d;
			if (r.url === '/') {
				fn = './htdocs/index.html';
				mt = mimetype(fn);
			} else if (r.url.match(/^\/[a-zA-Z0-9]([a-zA-Z0-9_.-]{0,62}[a-zA-Z0-9])?$/)) {
				switch (r.url) {
				case '/LICENSE':
					fn = './LICENSE';
					mt = mimetype(fn + '.txt');
					break;
				default:
					fn = './htdocs' + r.url;
					mt = mimetype(fn);
				}
			} else {
				error(404, 'Not found');
				return;
			}
			d = fs.createReadStream(fn);
			d.on('error', function(e) {
				if (debug) {
					console.log(e);
				}
				error(404, 'Not found');
			});
			d.on('open', function() {
				res.setHeader('Content-Type', mt);
				d.pipe(res);
			});
			return;
		}
	}
	error(404, 'Not found');
}

function ipRangeExpandCb(range, maxAddresses) {
	var m, s, e, i, c, r = [];
	if (! (typeof(range) === 'string')) {
		return undefined;
	}
	if (m = range.match(/^([^-]+)-([^-]+)$/)) {
		s = m[1];
		e = m[2];
	} else {
		s = e = range;
	}
	if (! (ipaddr.IPv4.isValid(s) && ipaddr.IPv4.isValid(e))) {
		return undefined;
	}
	s = Buffer.from(ipaddr.IPv4.parse(s).toByteArray()).readUInt32BE();
	e = Buffer.from(ipaddr.IPv4.parse(e).toByteArray()).readUInt32BE();
	if ((maxAddresses !== undefined) && (maxAddresses !== null) && (Math.abs(e - s) > maxAddresses)) {
		return undefined;
	}
	c = (e > s) ? 1 : -1;
	i = s - c;
	do {
		i += c;
		r.push(((i >> 24) & 0xff).toString() + '.' +
			   ((i >> 16) & 0xff).toString() + '.' +
			   ((i >> 8) & 0xff).toString() + '.' +
			   (i & 0xff).toString());
	} while(i != e);
	return r;
}

function wsCb(ws) {
	ws.on('message', function (data) {
		var r;
		try {
			r = JSON.parse(data);
		} catch (e) {
			r = undefined;
		}
		if (! (r &&
			   (typeof(r) === 'object') &&
			   ((((typeof(r.command) === 'string') ? 1 : 0) + ((typeof(r.status) === 'string') ? 1 : 0)) == 1))) {
			ws.close();
		}
		if (typeof(r.status) === 'string') {
			return;
		}
		switch (r.command) {
		case 'ping':
			ws.send(JSON.stringify({ status: 'pong', now: Date.now() }));
			break;
		case 'status':
			d.devs.forEach(function(dev) {
				var s = JSON.stringify({ status: 'reachable', now: Date.now(), device: exportDev(dev) });
				if (ws.readyState === WebSocket.OPEN) {
					ws.send(s);
				}
			});
			break;
		case 'disconnect':
			ws.send(JSON.stringify({ status: 'disconnect', now: Date.now() }));
			ws.close();
			break;
		default:
			ws.send(JSON.stringify({ status: 'error', now: Date.now(), message: 'Unknown command' }));
			break;
		}
	});
	{
		let s = JSON.stringify({ status: 'hello',
								 now: Date.now(),
								 name: opt.value('name'),
								 serverName: d.packageData.name,
								 serverVersion: d.packageData.version });
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(s);
		}
	}
	d.devs.forEach(function(dev) {
		var s = JSON.stringify({ status: 'reachable', now: Date.now(), device: exportDev(dev) });
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(s);
		}
	});
}

function haConf(dev) {
	dev = exportDev(dev);
	var r = '';
	r += '  - platform: broadlink';
	r += "\n";
	r += '    friendly_name: ' + "'" + dev.name.replace(/'/g, "''").replace(/\s+/g, ' ') + "'";
	r += "\n";
    r += '    type: ' + ((dev.devClass === 'sp3s') ? 'sp3' : 'sp2')
	r += "\n";
    r += '    host: ' + dev.address;
	r += "\n";
    r += '    mac: ' + "'" + dev.mac + "'";
	r += "\n";
    r += '    retry: 10'
	r += "\n";
	return r;
}

function parseBasicAuth(s) {
	var m, b;
	if ((typeof(s) !== 'string') ||
		(! (m = s.match(/^\s*Basic\s+([0-9A-Za-z\+\\]+={0,2})\s*/)))) {
		return undefined;
	}
	if (! Buffer.isBuffer(b = Buffer.from(m[1], 'base64'))) {
		return undefined;
	}
	if (! (m = b.toString('utf8').match(/^([^:]*):(.*)$/))) {
		return undefined;
	}
	return { user: m[1], password: m[2] };
}

function checkPassword(password) {
	if (opt.value('password') === undefined) {
		return false;
	}
	if (opt.value('password-hash')) {
		let ret = false;
		try {
			let raw = require('crypto').createHash(opt.value('password-hash')).update(password).digest();
			ret = ((raw.toString('hex').toLowerCase() === opt.value('password').toLowerCase()) ||
				   (raw.toString('base64') === opt.value('password')));
		} catch(e) {
			ret = false;
		}
		return ret;
	}
	return password === opt.value('password');
}

function noCache(res) {
	res.setHeader('Pragma', 'no-cache');
	res.setHeader('Cache-Control',
				  'no-store, no-cache, must-revalidate, pre-check=0, post-check=0, max-age=0');
	res.setHeader('Expires', 'Thu, 01 Jan 1970 00:00:00 GMT');
}
