In a Nutshell
=============

Broadlink Hub
-------------

This is a local Web-server implementing a simple control server for
WiFi-connected Broadlink SP2, SP3, SP3S, SC1 and quite a few OEM
variations of the same theme. This is mainly targeted to be used in
Hassio addon for controlling Broadlink switches, but there is also a
simple built-in Web front in the system.

Reference
=========

The main functionality of the hub, is to provide with a WebSocket that
reports the status of available devices. Devices can be controlled
with simple REST calls. Currently the controlling consists of setting
the device power on or off. It is also possible to query device states
with a rest call, but WebSocket interface being much more powerful,
should be used instead.

The daemon is either given a fixed set of IP addresses to probe for
devices or an IP address or a name of a local network device
(e.g. eth0 or wlan0 or en0) that is used for sending device discovery
broadcasts. All IP addresses that responds to the query, are
automatically added to the list of monitored IP addresses.


Command Line Options
====================

```
broadlink-wifi-switch-hub [<opt> ...]
      --listen-address=<arg>   IP address the server listens to
      --listen-port=<arg>      TCP port the server listens to
      --user=<arg>             Username for basic authentication
      --password=<arg>         Password for basic authentication
      --password-hash=<arg>    Hash function for password
      --device-timeout=<arg>   Timeout in milliseconds to wait for device to answer
      --update-interval=<arg>  Timeout in milliseconds between device polls
      --ip=<arg>               IP address the server probes for device
      --ip-range=<arg>         Range of IP addresses (max 100) the server probes for device
      --name=<arg>             Name of the controller (e.g. "Home")
  -d  --debug                  Enable debug.
      --broadcast=<arg>        Local IP address or network interface name sending broadcasts
  -h  --help                   Show help and exit
```

Web Front
=========

Simple control center front is available in server root.


REST API
========

GET /status
-----------

GET /status?uid={device-uid}
----------------------------

Reports an array of devices including the status in JSON format. The
response can be limited to one device by including a device-uid
parameter. This call should never be needed, but is left there
nevertheless. Monitor the WebSocket instead.


GET /power?uid={device-uid}&power={on-or-off}
---------------------------------------------

Sets the device power status. Successful HTTP status code 200, implies
that the operation was successful. Returns device status in JSON format.


WebSocket Protocol
==================

WebSocket URL is /status (e.g. ws://192.168.0.10:15129/status)

```
// When WebSocket is opened, the server sends always a hello message
// including the name of the system. Status message, as well as all
// other messages, includes timestamp (now) which is Javascript
// timestamp (i.e. milliseconds after Unix epoch).
{
	"status": "hello",
	"now": 1584470535597,
	"name":"Timo's Home"
}

// When a switch has been discovered and becomes usable, a reachable
// message is sent. This message always contains full data of the
// device including all udata properties available for particular
// device class. Device uid is static and never changes for a
// particular device and it is used in referring to the device in all
// subsequent messages and also REST calls.
// All devices that are reachable when a WebSocket is opened, are
// reported with reachable message immediately after hello message.
{
	"status": "reachable",
	"now": 1584470535599,
	"device":  {
		"uid": "switch.broadlink.3400cafebabe",
		"name": "Aquarium Light",
		"address": "192.168.1.66",
		"port": 80,
		"mac": "34:ea:ca:fe:ba:be",
		"devClass": "sp2",
		"devType": "Broadlink SC1",
		"devTypeId": "0x7547",
		"udata": {
			"lastSeen": 1159144503432,
			"power": false
		}
	}
}

// Another device class can include different udata. Here device class
// is sp3s which means, it also reports energy consumption in watts.
{
	"status": "reachable",
	"now": 1584470535599,
	"device":  {
		"uid": "switch.broadlink.3400deadbeef",
		"name": "Porch IR Heater",
		"address": "192.168.1.42",
		"port": 80,
		"mac": "34:ea:de:ad:be:ef",
		"devClass": "sp3s",
		"devType": "Broadlink SP3S",
		"devTypeId": "0x7547",
		"udata": {
			"lastSeen": 1265283021634,
			"power": false
			"energy": 1234.52
		}
	}
}

// If the device becomes unreachable, which do happen very often to
// Broadlink devices, unreachable message is sent. The device recovers
// usually very fast unless it's really broken or disconnected from
// the network. After it becomes available again, a reachable message
// is sent.
{
	"status": "unreachable",
	"now": 1584470535599,
	"device":  {
		"uid": "switch.broadlink.3400cafebabe"
	}
}

// If a change in device is detected, an update message is sent
// Typically only changed information and lastSeen info is
// included. It is however possible that also some unchanged
// information gets reported in update. Particularly this is the case
// for udate.power, which is reported when power state is set with
// REST call, but doesn't actually change (e.g. switch that is already
// on, is set on). Update message can only be sent to a device that is
// reachable. So, if the device becomes unreachable, there will not be
// any update messages on that before there is a reachable message
// first.
{
	"status":  "update",
	"now": 1584470535599,
	"device":  {
		"uid": "switch.broadlink.3400cafebabe",
		"udata": {
			"lastSeen": 1159144503432,
			"energy": 1234.52
		}
	}
}

// Another example. It is also possible that udata has both, power and
// energy in same update.
{
	"status":  "update",
	"now": 1584475739745,
	"device":  {
		"uid": "switch.broadlink.3400cafebabe",
		"udata": {
			"lastSeen": 1159144503432,
			"power": false
		}
	}
}

// Pong is a response to { "command": "ping" }
{
	"status": "pong",
	"now": 1584475739745
}

// Reachable message is repeated for all reachable devices as a
// response to { "command": "status" }
```


Author
======

Timo J. Rinne <tri@iki.fi>


License
=======

MIT


Acknowledgements
================

- Kudos to all wonderful people behind hass.io and Home Assistant in
  general.
- Thanks to Viljo Malmberg for his CSS witchery, that always seems to
  remain beyond my capabilities.
