'use strict';

function mimetype(fn) {
	var m = fn.match(/^(.*\/)?([^/]+)\.([^/.]+)$/);
	if (! m) {
		return 'application/octet-stream';
	}
	var ext = m[3].toLowerCase();
	switch (ext) {
	case 'txt':
	case 'text':
		return 'text/plain; charset=utf-8';
	case 'html':
		return 'text/html; charset=utf-8';
	case 'css':
		return 'text/css; charset=utf-8';
	case 'js':
		return 'application/javascript';
	case 'json':
		return 'application/json; charset=utf-8';
	case 'jpg':
	case 'jpeg':
		return 'image/jpeg';
	case 'png':
		return 'image/png';
	case 'gif':
		return 'image/gif';
	case 'ico':
		return 'image/x-icon';
	}
	return 'application/octet-stream';
}

module.exports = mimetype;
