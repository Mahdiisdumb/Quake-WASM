export const netquake = 15;
export const fitzquake = 666;
export const VERSION = {
	netquake: 15,
	fitzquake: 666,
	bjp3: 10002
}
export const U = {
	morebits: 1,
	origin1: 1 << 1,
	origin2: 1 << 2,
	origin3: 1 << 3,
	angle2: 1 << 4,
	nolerp: 1 << 5,
	frame: 1 << 6,
	signal: 1 << 7,

	angle1: 1 << 8,
	angle3: 1 << 9,
	model: 1 << 10,
	colormap: 1 << 11,
	skin: 1 << 12,
	effects: 1 << 13,
	longentity: 1 << 14,
	// fitzquake
	extend1: 1 << 15,
	alpha: 1 << 16,
	frame2: 1 << 17,
	model2: 1 << 18,
	lerpfinish: 1 << 19,
	unused20: 1 << 20,
	unused21: 1 << 21,
	unused22: 1 << 22,
	extend2: 1 << 23
};

export const SU = {
	viewheight: 1,
	idealpitch: 1 << 1,
	punch1: 1 << 2,
	punch2: 1 << 3,
	punch3: 1 << 4,
	velocity1: 1 << 5,
	velocity2: 1 << 6,
	velocity3: 1 << 7,
	items: 1 << 9,
	onground: 1 << 10,
	inwater: 1 << 11,
	weaponframe: 1 << 12,
	armor: 1 << 13,
	weapon: 1 << 14,
	// fitzquake
	extend1: 1 << 15,
	weapon2: 1 << 16,
	armor2: 1 << 17,
	ammo2: 1 << 18,
	shells2: 1 << 19,
	nails2: 1 << 20,
	rockets2: 1 << 21,
	cells2: 1 << 22,
	extend2: 1 << 23,
	weaponframe2: 1 << 24,
	weaponalpha: 1 << 25,
};

export const default_viewheight = 22;

export const SVC = {
	nop: 1,
	disconnect: 2,
	updatestat: 3,
	version: 4,
	setview: 5,
	sound: 6,
	time: 7,
	print: 8,
	stufftext: 9,
	setangle: 10,
	serverinfo: 11,
	lightstyle: 12,
	updatename: 13,
	updatefrags: 14,
	clientdata: 15,
	stopsound: 16,
	updatecolors: 17,
	particle: 18,
	damage: 19,
	spawnstatic: 20,
	spawnbaseline: 22,
	temp_entity: 23,
	setpause: 24,
	signonnum: 25,
	centerprint: 26,
	killedmonster: 27,
	foundsecret: 28,
	spawnstaticsound: 29,
	intermission: 30,
	finale: 31,
	cdtrack: 32,
	sellscreen: 33,
	cutscene: 34,
	showlmp: 35,	// Nehahra: [string] slotname [string] lmpfilename [coord] x [coord] y
	hidelmp: 36,	// Nehahra: [string] slotname

	//johnfitz -- PROTOCOL_FITZQUAKE -- new server messages
	skybox:	37,	// [string] name
	bf:	40,
	fog: 41,	// [byte] density [byte] red [byte] green [byte] blue [float] time
	spawnbaseline2:	42,  // support for large modelindex, large framenum, alpha, using flags
	spawnstatic2:	43,	// support for large modelindex, large framenum, alpha, using flags
	spawnstaticsound2:44	// [coord3] [short] samp [byte] vol [byte] aten
	//johnfitz
};

export const CLC = {
	nop: 1,
	disconnect: 2,
	move: 3,
	stringcmd: 4
};

export const TE = {
	spike: 0,
	superspike: 1,
	gunshot: 2,
	explosion: 3,
	tarexplosion: 4,
	lightning1: 5,
	lightning2: 6,
	wizspike: 7,
	knightspike: 8,
	lightning3: 9,
	lavasplash: 10,
	teleport: 11,
	explosion2: 12,
	beam: 13
};

// fitzquake
export const ENT_ALPHA = {
	default: 0,		//entity's alpha is "default" (i.e. water obeys r_wateralpha) -- must be zero so zeroed out memory works
	zero: 1,		 	//entity is invisible (lowest possible alpha)
	one: 255 			//entity is fully opaque (highest possible alpha)
}

//johnfitz -- PROTOCOL_FITZQUAKE -- new bits
export const SND = {
	largeentity: 1 << 3,
	largesound: 1 << 4
}

//johnfitz -- PROTOCOL_FITZQUAKE -- flags for entity baseline messages
export const BASE = {
	largemodel: 1,			// modelindex is short instead of byte
	largeframe: 1 << 1,	// frame is short instead of byte
	alpha: 1 << 2				// 1 byte, uses ENTALPHA_ENCODE, not sent if ENTALPHA_DEFAULT
}