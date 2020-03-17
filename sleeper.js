'use strict';

async function sleeper(millisecondsMin, millisecondsMax) {
	let timeoutMs;
	if ((millisecondsMax === undefined) || (millisecondsMax === null)) {
		millisecondsMax = millisecondsMin;
	}
	if (! (Number.isSafeInteger(millisecondsMin) &&
		   (millisecondsMin >= 0) &&
		   (millisecondsMin < 100000000000000))) {
		throw new Error('Illegal timeout minimum');
	}
	if (! (Number.isSafeInteger(millisecondsMax) &&
		   (millisecondsMax >= 0) &&
		   (millisecondsMax < 100000000000000))) {
		throw new Error('Illegal timeout maximum');
	}
	if (millisecondsMax < millisecondsMin) {
		throw new Error('Illegal timeout range');
	}
	if (millisecondsMin == millisecondsMax) {
		timeoutMs = millisecondsMin;
	} else {
		timeoutMs = millisecondsMin + Math.floor(Math.random() * (millisecondsMax - millisecondsMin + 1));
	}
	return new Promise(function(resolve, reject) {
		setTimeout(function() { resolve(); }, timeoutMs);
	});
}

module.exports = sleeper;
