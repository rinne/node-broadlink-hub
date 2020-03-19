'use strict';

const crypto = require('crypto');

function main() {
	let ha, pw, av0, hex, base64;
	av0 = process.argv[1];

	while (1) {
 		if (process.argv[2] === '--hex') {
			process.argv.shift();
			hex = true;
		} else if (process.argv[2] === '--base64') {
			process.argv.shift();
			base64 = true;
		} else {
			break;
		}
	}
	if ((hex === undefined) && (base64 === undefined)) {
		hex = false;
		base64 = true;
	} else if (hex === undefined) {
		hex = false;
	} else if (base64 === undefined) {
		base64 = false;
	}
	switch (process.argv.length) {
	case 3:
		ha = 'sha256';
		pw = process.argv[2];
		break;
	case 4:
		ha = process.argv[2];
		pw = process.argv[3];
		break;
	default:
		throw new Error('Usage: ' + process.argv[1] + ' [ algorithm ] password');
	};
	let hp = require('crypto').createHash(ha).update(pw).digest();
	if (hex) {
		console.log(ha + ':hex(' + pw + ') = ' + hp.toString('hex'));
	}
	if (base64) {
		console.log(ha + ':base64(' + pw + ') = ' + hp.toString('base64'));
	}
}

try {
	main()
} catch(e) {
	console.log(e);
	process.exit(1);
}

process.exit(0);

