import * as cmd from './cmd'
import * as con from './console'
import * as com from './com'
import * as cvar from './cvar'
import * as host from './host'
import * as cl from './cl'
import * as mod from './mod'
import * as q from './q'
import * as vec from './vec'

import {Channel, Nodes, Sound } from './types/Sound'
import { V3 } from './types'

type SoundState = {
  channels: Channel[],
  context: AudioContext | null,
	static_channels: Channel[],
	ambient_channels: Channel[],
	listener_origin: V3,
	listener_forward: V3,
	listener_right: V3,
	listener_up: V3,
	known_sfx: Sound[],
	spatialize_dir: V3,   // per-frame scratch for spatialize (no hot-path allocs)
	// master chain: every sound -> masterGain -> waterFilter -> destination
	masterGain: GainNode | null,
	waterFilter: BiquadFilterNode | null,
	underwater: boolean,
	mastervol: number,
	resumePending: boolean   // a context.resume() is in flight (settles on user gesture)
}

export let state: SoundState
export const cvr: cvar.CVars = {}

// Cutoff for the underwater muffle (snd_waterfx, as in QSS-M/Ironwail).
const WATER_CUTOFF_HZ = 1000.0

const dryCutoffHz = () => Math.min(state.context!.sampleRate * 0.5, 24000.0)

const onNoteEnd = (node: Nodes) => () => {
	node.state = 'end'
}

const clearResumePending = () => { state.resumePending = false; }

export const init = async function () {
	state = {
    channels: [],
    context: null,
    static_channels: [],
    ambient_channels: [],
    listener_origin: vec.emptyV3(),
    listener_forward: vec.emptyV3(),
    listener_right: vec.emptyV3(),
    listener_up: vec.emptyV3(),
    known_sfx: [],
    spatialize_dir: vec.emptyV3(),
    masterGain: null,
    waterFilter: null,
    underwater: false,
    mastervol: -1.0,
    resumePending: false,
  }

	con.print('\nSound Initialization\n');
	cmd.addCommand('play', play);
	cmd.addCommand('playvol', playVol);
	cmd.addCommand('stopsound', stopAllSounds);
	cmd.addCommand('soundlist', soundList);
	cvr.nosound = cvar.registerVariable('nosound', (com.checkParm('-nosound') != null) ? '1' : '0');
	cvr.volume = cvar.registerVariable('volume', '0.7', true);
	cvr.precache = cvar.registerVariable('precache', '1');
	cvr.bgmvolume = cvar.registerVariable('bgmvolume', '1', true);
	cvr.ambient_level = cvar.registerVariable('ambient_level', '0.3');
	cvr.ambient_fade = cvar.registerVariable('ambient_fade', '100');
	cvr.waterfx = cvar.registerVariable('snd_waterfx', '1', true);

	if ((window as any).AudioContext != null)
		state.context = new (window as any).AudioContext();
	else if ((window as any).webkitAudioContext != null)
		state.context = new (window as any).webkitAudioContext();

	if (state.context != null) {
		state.masterGain = state.context.createGain();
		state.mastervol = cvr.volume.value;
		state.masterGain.gain.value = state.mastervol;
		state.waterFilter = state.context.createBiquadFilter();
		state.waterFilter.type = 'lowpass';
		state.waterFilter.frequency.value = dryCutoffHz();
		state.masterGain.connect(state.waterFilter);
		state.waterFilter.connect(state.context.destination);
	}

	var i, ambient_sfx = ['water1', 'wind2'], ch: Channel, nodes: Nodes;
	for (i = 0; i < ambient_sfx.length; ++i) {
		ch = {
      sfx: await precacheSound('ambience/' + ambient_sfx[i] + '.wav'),
      end: 0.0,
      master_vol: 0.0,
			nodes: null,
			origin: vec.emptyV3(),
			dist_mult: 0.0,
			entnum: 0,
			entchannel: 0,
			leftvol: 0.0,
			rightvol: 0.0,
			pos: 0.0
    };
		state.ambient_channels[i] = ch;
		if (await loadSound(ch.sfx) !== true)
			continue;
		if (ch.sfx.cache.loopstart == null) {
			con.print('Sound ambience/' + ch.sfx.name + '.wav not looped\n');
			continue;
		}
    nodes = {
      state: 'idle',
      source: state.context.createBufferSource(),
      gain: state.context.createGain(),
      gainL: null,
      gainR: null,
      merger: null,
      connected: true
    };
    ch.nodes = nodes;
    nodes.source.buffer = ch.sfx.cache.data;
    nodes.source.loop = true;
    nodes.source.loopStart = ch.sfx.cache.loopstart;
    nodes.source.loopEnd = nodes.source.buffer.duration;
    nodes.source.connect(nodes.gain);
    nodes.gain.connect(state.masterGain);
    // Ambient loops run for the whole session, gated by gain (vanilla mixes them
    // continuously) — a started source can never be restarted, so never stop it.
    nodes.gain.gain.value = 0.0;
    noteOn(nodes);
	}

	con.state.sfx_talk = await precacheSound('misc/talk.wav');
};

export const noteOff = function (node: Nodes) {
	if (node.state === 'playing') {
		try {
			node.source.stop(0)
		} catch(ex) {

		}
		// 'end', not 'idle': a started AudioBufferSourceNode is consumed
		node.state = 'end'
	}
}

export const noteOn = function (node: Nodes) {
	if (node.state !== 'playing') {
		try {
			node.source.start(0)
		} catch(ex) {

		}
		node.state = 'playing'
	}
}

export const precacheSound = async function (name: string) {
	if (cvr.nosound.value !== 0)
		return;
	var i, sfx;
	for (i = 0; i < state.known_sfx.length; ++i) {
		if (state.known_sfx[i].name === name) {
			sfx = state.known_sfx[i];
			break;
		}
	}
	if (i === state.known_sfx.length) {
		state.known_sfx[i] = {
      name: name,
      cache: null,
      data: null,
      type: null
    };
		sfx = state.known_sfx[i];
	}
	if (cvr.precache.value !== 0)
		await loadSound(sfx);
	return sfx;
};

// Vanilla frees the sound cache between maps; drop the decoded buffers so a long
// session doesn't hold every map's sounds. Sound identities stay valid — loads
// re-run lazily (synchronously for pak-resident files) on the next play.
export const flushCache = function () {
	if (state == null)
		return;
	// No live channel may outlive its cache (updateDynamicSounds derefs it); Ironwail's
	// CL_ParseServerInfo likewise stops sounds before the cache turns over.
	stopAllSounds();
	for (var i = 0; i < state.known_sfx.length; ++i) {
		state.known_sfx[i].cache = null;
		state.known_sfx[i].loading = undefined;
		state.known_sfx[i].failed = undefined;
	}
};

export const pickChannel = function (entnum: number, entchannel: number) {
	var i, channel;

	if (entchannel !== 0) {
		for (i = 0; i < state.channels.length; ++i) {
			channel = state.channels[i];
			if (channel == null)
				continue;
			if ((channel.entnum === entnum) && ((channel.entchannel === entchannel) || (entchannel === -1))) {
				channel.sfx = null;
				if (channel.nodes != null) {
          noteOff(channel.nodes);
          channel.nodes = null;
				}

				break;
			}
		}
	}

	if ((entchannel === 0) || (i === state.channels.length)) {
		for (i = 0; i < state.channels.length; ++i) {
			channel = state.channels[i];
			if (channel == null)
				break;
			if (channel.sfx == null)
				break;
		}
	}

	if (i === state.channels.length) {
		state.channels[i] = {
      sfx: null,
      end: 0.0,
      master_vol: 0.0,
			nodes: null,
			origin: vec.emptyV3(),
			dist_mult: 0.0,
			entnum: 0,
			entchannel: 0,
			leftvol: 0.0,
			rightvol: 0.0,
			pos: 0.0
    };
		return state.channels[i];
	}
	return channel;
};

export const spatialize = function (ch: Channel) {
	if (ch.entnum === cl.clState.viewentity) {
		ch.leftvol = ch.master_vol;
		ch.rightvol = ch.master_vol;
		return;
	}

	var source = state.spatialize_dir;
	source[0] = ch.origin[0] - state.listener_origin[0];
	source[1] = ch.origin[1] - state.listener_origin[1];
	source[2] = ch.origin[2] - state.listener_origin[2];
	var dist = Math.sqrt(source[0] * source[0] + source[1] * source[1] + source[2] * source[2]);
	if (dist !== 0.0) {
		source[0] /= dist;
		source[1] /= dist;
		source[2] /= dist;
	}
	dist *= ch.dist_mult;
	var dot = state.listener_right[0] * source[0]
		+ state.listener_right[1] * source[1]
		+ state.listener_right[2] * source[2];

	ch.rightvol = ch.master_vol * (1.0 - dist) * (1.0 + dot);
	if (ch.rightvol < 0.0)
		ch.rightvol = 0.0;
	ch.leftvol = ch.master_vol * (1.0 - dist) * (1.0 - dot);
	if (ch.leftvol < 0.0)
		ch.leftvol = 0.0;
};

// source -> gainL/gainR -> merger(L,R) -> masterGain. The per-ear gains carry
// vanilla's exact SND_Spatialize volumes; global volume lives on masterGain.
const buildPositionalNodes = function (sfx: Sound): Nodes {
  var nodes: Nodes = {
    state: 'idle',
    source: state.context.createBufferSource(),
    gain: null,
    gainL: state.context.createGain(),
    gainR: state.context.createGain(),
    merger: state.context.createChannelMerger(2),
    connected: true
  };
  nodes.source.onended = onNoteEnd(nodes)
  nodes.source.buffer = sfx.cache.data;
  if (sfx.cache.loopstart != null) {
    nodes.source.loop = true;
    nodes.source.loopStart = sfx.cache.loopstart;
    nodes.source.loopEnd = nodes.source.buffer.duration;
  }
  nodes.source.connect(nodes.gainL);
  nodes.source.connect(nodes.gainR);
  nodes.gainL.connect(nodes.merger, 0, 0);
  nodes.gainR.connect(nodes.merger, 0, 1);
  nodes.merger.connect(state.masterGain);
  return nodes;
};

export const startSound = function (entnum: number, entchannel: number, sfx: Sound, origin: V3, vol: number, attenuation: number) {
	if ((cvr.nosound.value !== 0) || (sfx == null) || (state.context == null))
		return;

	const target_chan = pickChannel(entnum, entchannel);
	target_chan.origin[0] = origin[0];
	target_chan.origin[1] = origin[1];
	target_chan.origin[2] = origin[2];
	target_chan.dist_mult = attenuation * 0.001;
	target_chan.master_vol = vol;
	target_chan.entnum = entnum;
	target_chan.entchannel = entchannel;
	spatialize(target_chan);
	if ((target_chan.leftvol === 0.0) && (target_chan.rightvol === 0.0))
		return;

	if (!ensureLoadedSync(sfx)) {
		target_chan.sfx = null;
		return;
	}

	target_chan.sfx = sfx;
	target_chan.pos = 0.0;
	target_chan.end = host.state.realtime + sfx.cache.length;

  var nodes = buildPositionalNodes(sfx);
  target_chan.nodes = nodes;
  nodes.gainL.gain.value = Math.min(target_chan.leftvol, 1.0);
  nodes.gainR.gain.value = Math.min(target_chan.rightvol, 1.0);
  var i, check, skip;
  for (i = 0; i < state.channels.length; ++i) {
    check = state.channels[i];
    if (check === target_chan)
      continue;
    if ((check.sfx !== sfx) || (check.pos !== 0.0))
      continue;
    skip = Math.random() * 0.1;
    if (skip >= sfx.cache.length) {
      noteOn(nodes);
      break;
    }
    target_chan.pos += skip;
    target_chan.end -= skip;
    nodes.source.start(0.0, skip)
    nodes.state = 'playing'
    break;
  }
  noteOn(nodes);

};

export const stopSound = function (entnum: number, entchannel: number) {
	if (cvr.nosound.value !== 0)
		return;
	var i, ch;
	for (i = 0; i < state.channels.length; ++i) {
		ch = state.channels[i];
		if (ch == null)
			continue;
		if ((ch.entnum === entnum) && (ch.entchannel === entchannel)) {
			ch.end = 0.0;
			ch.sfx = null;

			// nodes is null on an already-expired channel that kept its ent/channel ids
			if (ch.nodes != null) {
				noteOff(ch.nodes);
				ch.nodes = null;
			}

			return;
		}
	}
};

export const stopAllSounds = function () {
	if (!cvr.nosound || cvr.nosound.value !== 0)
		return;

	var i, ch;

	// Ambient loops are never stopped (a consumed source can't restart) — just silenced.
	for (i = 0; i < state.ambient_channels.length; ++i) {
		ch = state.ambient_channels[i];
		ch.master_vol = 0.0;
		if (ch.nodes != null)
			ch.nodes.gain.gain.value = 0.0;
	}

	for (i = 0; i < state.channels.length; ++i) {
		ch = state.channels[i];
		if (ch == null)
			continue;
		if (ch.nodes != null)
      noteOff(ch.nodes);
	}
	state.channels = [];

  for (i = 0; i < state.static_channels.length; ++i)
    noteOff(state.static_channels[i].nodes);

	state.static_channels = [];
};

// Release the audio device (QSS Host_Shutdown -> S_Shutdown). A running AudioContext keeps
// the tab's audio indicator lit, and each GameInit would leak one (Chrome caps ~6 per tab).
export const shutdown = function () {
	stopAllSounds();
	if (state.context != null) {
		void state.context.close().catch(() => {});
		state.context = null;
	}
};

export const staticSound = function (sfx: Sound, origin: V3, vol: number, attenuation: number) {
	if ((cvr.nosound.value !== 0) || (sfx == null) || (state.context == null))
		return;
	if (!ensureLoadedSync(sfx))
		return;
	if (sfx.cache.loopstart == null) {
		con.print('Sound ' + sfx.name + ' not looped\n');
		return;
	}
	var ssChan: Channel = {
		sfx: sfx,
		origin: [origin[0], origin[1], origin[2]],
		master_vol: vol,
		dist_mult: attenuation * 0.000015625,
		end: host.state.realtime + sfx.cache.length,
    entnum: 0,
    entchannel: 0,
    leftvol: 0.0,
    rightvol: 0.0,
    pos: 0.0,
    nodes: null
	}

	ssChan.nodes = buildPositionalNodes(sfx);
	state.static_channels[state.static_channels.length] = ssChan;

	// Statics run for the whole map (a consumed source can't restart); updateStaticSounds
	// gates them by gain and detaches inaudible ones. stopAllSounds tears them down at map end.
	ssChan.nodes.gainL.gain.value = 0.0;
	ssChan.nodes.gainR.gain.value = 0.0;
	ssChan.nodes.merger.disconnect();
	ssChan.nodes.connected = false;
	noteOn(ssChan.nodes);
};

export const soundList = function () {
	var total = 0, i, sfx, sc, size;
	for (i = 0; i < state.known_sfx.length; ++i) {
		sfx = state.known_sfx[i];
		sc = sfx.cache;
		if (sc == null)
			continue;
		size = sc.size.toString();
		total += sc.size;
		for (; size.length <= 5;)
			size = ' ' + size;
		if (sc.loopstart != null)
			size = 'L' + size;
		else
			size = ' ' + size;
		con.print(size + ' : ' + sfx.name + '\n');
	}
	con.print('Total resident: ' + total + '\n');
};

export const localSound = function (sound: Sound) {
	startSound(cl.clState.viewentity, -1, sound, vec.origin, 1.0, 1.0);
};

export const updateAmbientSounds = function (leaf: number) {
	if (cl.clState.worldmodel == null)
		return;

	var i, ch, vol;

	var wm = cl.clState.worldmodel;
	if ((leaf < 0) || (cvr.ambient_level.value === 0)) {
		for (i = 0; i < state.ambient_channels.length; ++i) {
			ch = state.ambient_channels[i];
			ch.master_vol = 0.0;
			if (ch.nodes != null)
				ch.nodes.gain.gain.value = 0.0;
		}
		return;
	}

	for (i = 0; i < state.ambient_channels.length; ++i) {
		ch = state.ambient_channels[i];
		if (ch.nodes == null)
			continue;
		vol = cvr.ambient_level.value * wm.leafAmbientLevel[leaf * 4 + i];
		if (vol < 8.0)
			vol = 0.0;
		vol /= 255.0;
		if (ch.master_vol < vol) {
			ch.master_vol += (host.state.frametime * cvr.ambient_fade.value) / 255.0;
			if (ch.master_vol > vol)
				ch.master_vol = vol;
		}
		else if (ch.master_vol > vol) {
			ch.master_vol -= (host.state.frametime * cvr.ambient_fade.value) / 255.0;
			if (ch.master_vol < vol)
				ch.master_vol = vol;
		}
		if (ch.master_vol > 1.0)
			ch.master_vol = 1.0;

    ch.nodes.gain.gain.value = ch.master_vol;
	}
};

export const updateDynamicSounds = function () {
	var i, ch, sc;
	for (i = 0; i < state.channels.length; ++i) {
		ch = state.channels[i];
		if (ch == null)
			continue;
		if (ch.sfx == null)
			continue;
		if (host.state.realtime >= ch.end) {
			sc = ch.sfx.cache;
			if (sc.loopstart != null) {
				ch.end = host.state.realtime + sc.length - sc.loopstart;
			}
			else {
				ch.sfx = null;
				ch.nodes = null;
				continue;
			}
		}

		spatialize(ch);

    if (ch.leftvol > 1.0)
      ch.leftvol = 1.0;
    if (ch.rightvol > 1.0)
      ch.rightvol = 1.0;

    ch.nodes.gainL.gain.value = ch.leftvol;
    ch.nodes.gainR.gain.value = ch.rightvol;
	}
};

export const updateStaticSounds = function () {
	var i, j, ch, ch2, sfx, audible;

	for (i = 0; i < state.static_channels.length; ++i)
		spatialize(state.static_channels[i]);

	for (i = 0; i < state.static_channels.length; ++i) {
		ch = state.static_channels[i];
		if ((ch.leftvol === 0.0) && (ch.rightvol === 0.0))
			continue;
		sfx = ch.sfx;
		for (j = i + 1; j < state.static_channels.length; ++j) {
			ch2 = state.static_channels[j];
			if (sfx === ch2.sfx) {
				ch.leftvol += ch2.leftvol;
				ch.rightvol += ch2.rightvol;
				ch2.leftvol = 0.0;
				ch2.rightvol = 0.0;
			}
		}
	}

  for (i = 0; i < state.static_channels.length; ++i) {
    ch = state.static_channels[i];
    if (ch.leftvol > 1.0)
      ch.leftvol = 1.0;
    if (ch.rightvol > 1.0)
      ch.rightvol = 1.0;
    // An inaudible static keeps running (a consumed source can't restart) but is
    // detached: gain 0 doesn't short-circuit — a connected source still costs the
    // audio thread every quantum, and AD maps spawn statics in the hundreds.
    audible = (ch.leftvol !== 0.0) || (ch.rightvol !== 0.0);
    if (audible !== ch.nodes.connected) {
      if (audible)
        ch.nodes.merger.connect(state.masterGain);
      else
        ch.nodes.merger.disconnect();
      ch.nodes.connected = audible;
    }
    ch.nodes.gainL.gain.value = ch.leftvol;
    ch.nodes.gainR.gain.value = ch.rightvol;
  }
};

// snd_waterfx (QSS-M/Ironwail): low-pass the mix while the view is in water/slime/lava.
const updateWaterFilter = function (leaf: number) {
	if (state.waterFilter == null)
		return;
	var wm = cl.clState.worldmodel, contents = mod.CONTENTS.empty;
	if ((wm != null) && (leaf >= 0))
		contents = wm.leafContents[leaf];
	var underwater = (cvr.waterfx.value !== 0) &&
		(contents <= mod.CONTENTS.water) && (contents >= mod.CONTENTS.lava);
	if (underwater === state.underwater)
		return;
	state.underwater = underwater;
	state.waterFilter.frequency.setTargetAtTime(
		underwater ? WATER_CUTOFF_HZ : dryCutoffHz(), state.context.currentTime, 0.08);
};

export const update = function (origin: V3, forward: V3, right: V3, up: V3) {
	if (cvr.nosound.value !== 0)
		return;

	// Chrome's autoplay policy can create (or later flip) the context suspended when no
	// user gesture is in the chain (remount, back-navigation). Nothing else retries, so
	// nudge it here — latched, since the promise stays pending until a gesture arrives
	// and a suspended tab must not allocate a fresh one per frame.
	if (state.context != null && !state.resumePending && state.context.state === 'suspended') {
		state.resumePending = true;
		state.context.resume().then(clearResumePending, clearResumePending);
	}

	state.listener_origin[0] = origin[0];
	state.listener_origin[1] = origin[1];
	state.listener_origin[2] = origin[2];
	state.listener_forward[0] = forward[0];
	state.listener_forward[1] = forward[1];
	state.listener_forward[2] = forward[2];
	state.listener_right[0] = right[0];
	state.listener_right[1] = right[1];
	state.listener_right[2] = right[2];
	state.listener_up[0] = up[0];
	state.listener_up[1] = up[1];
	state.listener_up[2] = up[2];

	if (cvr.volume.value < 0.0)
		cvar.setValue('volume', 0.0);
	else if (cvr.volume.value > 1.0)
		cvar.setValue('volume', 1.0);
	// Global volume is one write on the master gain, not a per-channel multiply.
	if (state.masterGain != null && cvr.volume.value !== state.mastervol) {
		state.mastervol = cvr.volume.value;
		state.masterGain.gain.value = state.mastervol;
	}

	var leaf = (cl.clState.worldmodel != null) ?
		mod.pointInLeaf(state.listener_origin, cl.clState.worldmodel) : -1;
	updateWaterFilter(leaf);
	updateAmbientSounds(leaf);
	updateDynamicSounds();
	updateStaticSounds();
};

export const play = async function () {
	if (cvr.nosound.value !== 0)
		return;
	var i, sfx;
	for (i = 1; i < cmd.state.argv.length; ++i) {
		sfx = await precacheSound(com.defaultExtension(cmd.state.argv[i], '.wav'));
		if (sfx != null)
			startSound(cl.clState.viewentity, 0, sfx, state.listener_origin, 1.0, 1.0);
	}
};

export const playVol = async function () {
	if (cvr.nosound.value !== 0)
		return;
	var i, sfx;
	for (i = 1; i < cmd.state.argv.length; i += 2) {
		sfx = await precacheSound(com.defaultExtension(cmd.state.argv[i], '.wav'));
		if (sfx != null)
			startSound(cl.clState.viewentity, 0, sfx, state.listener_origin, q.atof(cmd.state.argv[i + 1]), 1.0);
	}
};

// Parse a PCM WAV and decode it straight into an AudioBuffer at the file's own
// sample rate — no decodeAudioData: synchronous, no resampling (the graph resamples
// at playback), and loop points stay sample-exact.
const parseWav = function (s: Sound, data: ArrayBuffer): boolean | undefined {
	var sc = {} as any

	var view = new DataView(data);
	if ((view.getUint32(0, true) !== 0x46464952) || (view.getUint32(8, true) !== 0x45564157)) {
		con.print('Missing RIFF/WAVE chunks\n');
		return;
	}
	var p, fmt, dataofs, datalen, cue, loopstart, samples;
	for (p = 12; p < data.byteLength - 8;) {
		switch (view.getUint32(p, true)) {
			case 0x20746d66: // fmt
				if (view.getInt16(p + 8, true) !== 1) {
					con.print('Microsoft PCM format only\n');
					return;
				}
				fmt = {
					channels: view.getUint16(p + 10, true),
					samplesPerSec: view.getUint32(p + 12, true),
					bitsPerSample: view.getUint16(p + 22, true)
				};
				break;
			case 0x61746164: // data
				dataofs = p + 8;
				datalen = view.getUint32(p + 4, true);
				break;
			case 0x20657563: // cue
				if (p + 36 > data.byteLength)
					break;
				cue = true;
				loopstart = view.getUint32(p + 32, true);
				break;
			case 0x5453494c: // LIST
				if (cue !== true)
					break;
				cue = false;
				if (p + 32 < data.byteLength && view.getUint32(p + 28, true) === 0x6b72616d)
					samples = loopstart + view.getUint32(p + 24, true);

				break;
		}
		p += view.getUint32(p + 4, true) + 8;
		if ((p & 1) !== 0)
			++p;
	}

	if (fmt == null) {
		con.print('Missing fmt chunk\n');
		return;
	}
	if (dataofs == null) {
		con.print('Missing data chunk\n');
		return;
	}
	if ((fmt.bitsPerSample !== 8) && (fmt.bitsPerSample !== 16)) {
		con.print(fmt.bitsPerSample + '-bit PCM not supported\n');
		return;
	}
	if ((fmt.channels !== 1) && (fmt.channels !== 2)) {
		con.print(fmt.channels + '-channel WAV not supported\n');
		return;
	}
	if (fmt.samplesPerSec <= 0) {
		con.print('Bad WAV sample rate\n');
		return;
	}
	// Some paks carry data chunks that overrun the file — clamp to what's really there.
	if (dataofs + datalen > data.byteLength)
		datalen = data.byteLength - dataofs;

	// Frame size from channels × sample width, as vanilla — blockAlign in the file can lie.
	var channels = fmt.channels;
	var frames = Math.floor(datalen / (channels * (fmt.bitsPerSample >> 3)));
	if (frames <= 0) {
		con.print('Empty data chunk\n');
		return;
	}

	// The cue offset is a sample count (vanilla GetWavinfo), not bytes; a cue at or past
	// the data end would make a degenerate loop (the buzz) — treat that as not looped.
	if ((loopstart != null) && (loopstart < frames))
		sc.loopstart = loopstart / fmt.samplesPerSec;
	sc.length = ((samples != null) ? Math.min(samples, frames) : frames) / fmt.samplesPerSec;

	sc.size = datalen + 44;
	if ((sc.size & 1) !== 0)
		++sc.size;
	var buffer = state.context.createBuffer(channels, frames, fmt.samplesPerSec);
	var c, f, out;
	if (fmt.bitsPerSample === 8) {
		var u8 = new Uint8Array(data, dataofs, frames * channels);
		for (c = 0; c < channels; ++c) {
			out = buffer.getChannelData(c);
			for (f = 0; f < frames; ++f)
				out[f] = (u8[f * channels + c] - 128) / 128.0;
		}
	}
	else {
		for (c = 0; c < channels; ++c) {
			out = buffer.getChannelData(c);
			for (f = 0; f < frames; ++f)
				out[f] = view.getInt16(dataofs + (f * channels + c) * 2, true) / 32768.0;
		}
	}
	sc.data = buffer;

	s.cache = sc;
	return true;
};

// parseWav prints its own diagnostics; a throw here means a header malformed in a
// way the guards didn't anticipate — contain it to a console line.
const tryParseWav = function (s: Sound, data: ArrayBuffer): boolean | undefined {
	try {
		return parseWav(s, data);
	} catch (e) {
		con.print('Malformed WAV: sound/' + s.name + '\n');
	}
};

// Synchronous load for files already resident in memory (paks; the common case).
// A parse failure is memoized on the Sound so a retriggered broken asset doesn't
// re-read, re-parse, and re-print every play.
const loadSoundSync = function (s: Sound): boolean | undefined {
	if (s.cache != null)
		return true;
	if ((s.failed === true) || (state.context == null))
		return;
	var data = com.loadFileSync('sound/' + s.name);
	if (data == null)
		return;
	var ok = tryParseWav(s, data);
	if (ok === true)
		s.loading = undefined;
	else
		s.failed = true;
	return ok;
};

const _doLoadSound = async function (s: Sound): Promise<boolean | undefined> {
	var data = await com.loadFile('sound/' + s.name);
	if (data == null) {
		con.print('Couldn\'t load sound/' + s.name + '\n');
		s.failed = true;
		s.loading = undefined;
		return;
	}
	var ok;
	if (state.context != null) {
		ok = tryParseWav(s, data);
		if (ok !== true)
			s.failed = true;
	}
	s.loading = undefined;
	return ok;
};

export const loadSound = function (s: Sound): Promise<boolean | undefined> {
	if (cvr.nosound.value !== 0)
		return Promise.resolve(undefined);
	if (loadSoundSync(s) === true)
		return Promise.resolve(true);
	if (s.failed === true)
		return Promise.resolve(undefined);
	if (s.loading != null)
		return s.loading;
	s.loading = _doLoadSound(s);
	return s.loading;
};

// Cache-miss play path: pak-resident files decode synchronously so the first play
// isn't dropped; a file still in transit falls back to the async load and this
// play is lost (there is no synchronous IO on the web).
const ensureLoadedSync = function (s: Sound): boolean {
	if (loadSoundSync(s) === true)
		return true;
	if (s.failed !== true)
		loadSound(s);
	return false;
};
