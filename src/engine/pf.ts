import * as sv from './sv'
import * as pr from './pr'
import * as con from './console'
import * as ed from './ed'
import * as vec from './vec'
import * as host from './host'
import * as mod from './mod'
import * as cmd from './cmd'
import * as msg from './msg'
import * as def from './def'
import * as cvar from './cvar'
import * as protocol from './protocol'
import * as com from './com'
import {sprintf_format, sprintf_parse} from './pf_sprintf'
import { FileMode } from './interfaces/store/IAssetStore'
import { Edict, V3 } from './types'

const PARM0 = 4
const PARM1 = 7
const PARM2 = 10
const RETURN = 1
const RETURN_V1 = 1
const RETURN_V2 = 2
const RETURN_V3 = 3

let checkpvs: Uint8Array = null

export const varString = function(first: number)
{
	var i, out = '';
	for (i = first; i < pr.state.argc; ++i)
		out += pr.getString(pr.state.globals_int[PARM0 + i * 3]);
	return out;
};

export const error = async function()
{
	con.print('======SERVER ERROR in ' + pr.getString(pr.state.xfunction.name) + '\n' + varString(0) + '\n');
	ed.print(sv.state.server.edicts[pr.state.globals_int[pr.globalvars.self]]);
	await host.error('Program error');
};

export const objerror = async function()
{
	con.print('======OBJECT ERROR in ' + pr.getString(pr.state.xfunction.name) + '\n' + varString(0) + '\n');
	const ent = sv.state.server.edicts[pr.state.globals_int[pr.globalvars.self]]
	ed.print(ent);
	ed.free(ent)

	//johnfitz -- by design, this should not be fatal
	//await host.error('Program error');
};

export const makevectors = function()
{
	var forward = vec.emptyV3(), right = vec.emptyV3(), up = vec.emptyV3();
	vec.angleVectors([pr.state.globals_float[4], pr.state.globals_float[5], pr.state.globals_float[6]], forward, right, up);
	var i;
	for (i = 0; i <= 2; ++i)
	{
		pr.state.globals_float[pr.globalvars.v_forward + i] = forward[i];
		pr.state.globals_float[pr.globalvars.v_right + i] = right[i];
		pr.state.globals_float[pr.globalvars.v_up + i] = up[i];
	}
};

export const setorigin = async function()
{
	var e = sv.state.server.edicts[pr.state.globals_int[4]];
	e.v_float[pr.entvars.origin] = pr.state.globals_float[7];
	e.v_float[pr.entvars.origin1] = pr.state.globals_float[8];
	e.v_float[pr.entvars.origin2] = pr.state.globals_float[9];
	await sv.linkEdict(e);
};

export const setMinMaxSize = async function(e: Edict, min:V3, max: V3)
{
	if ((min[0] > max[0]) || (min[1] > max[1]) || (min[2] > max[2]))
		await pr.runError('backwards mins/maxs');
	ed.setVector(e, pr.entvars.mins, min);
	ed.setVector(e, pr.entvars.maxs, max);
	e.v_float[pr.entvars.size] = max[0] - min[0];
	e.v_float[pr.entvars.size1] = max[1] - min[1];
	e.v_float[pr.entvars.size2] = max[2] - min[2];
	await sv.linkEdict(e);
};

export const setsize = function()
{
	setMinMaxSize(sv.state.server.edicts[pr.state.globals_int[4]],
		[pr.state.globals_float[7], pr.state.globals_float[8], pr.state.globals_float[9]],
		[pr.state.globals_float[10], pr.state.globals_float[11], pr.state.globals_float[12]]);
};

export const setmodel = async function()
{
	var e = sv.state.server.edicts[pr.state.globals_int[4]];
	var m = pr.getString(pr.state.globals_int[7]);
	var i;
	for (i = 0; i < sv.state.server.model_precache.length; ++i)
	{
		if (sv.state.server.model_precache[i] === m)
			break;
	}
	if (i === sv.state.server.model_precache.length)
		await pr.runError('no precache: ' + m + '\n');

	e.v_int[pr.entvars.model] = pr.state.globals_int[7];
	e.v_float[pr.entvars.modelindex] = i;
	var mod = sv.state.server.models[i];
	if (mod != null)
		await setMinMaxSize(e, mod.mins, mod.maxs);
	else
		await setMinMaxSize(e, vec.origin, vec.origin);
};

export const bprint = function()
{
	host.broadcastPrint(varString(0));
};

export const sprint = function()
{
	var entnum = pr.state.globals_int[4];
	if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
	{
		con.print('tried to sprint to a non-client\n');
		return;
	}
	var client = sv.state.svs.clients[entnum - 1];
	msg.writeByte(client.message, protocol.SVC.print);
	msg.writeString(client.message, varString(1));
};

export const centerprint = function()
{
	var entnum = pr.state.globals_int[4];
	if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
	{
		con.print('tried to sprint to a non-client\n');
		return;
	}
	var client = sv.state.svs.clients[entnum - 1];
	msg.writeByte(client.message, protocol.SVC.centerprint);
	msg.writeString(client.message, varString(1));
};

export const normalize = function()
{
	var newvalue:V3 = [pr.state.globals_float[4], pr.state.globals_float[5], pr.state.globals_float[6]];
	vec.normalize(newvalue);
	pr.state.globals_float[1] = newvalue[0];
	pr.state.globals_float[2] = newvalue[1];
	pr.state.globals_float[3] = newvalue[2];
};

export const vlen = function()
{
	pr.state.globals_float[1] = Math.sqrt(pr.state.globals_float[4] * pr.state.globals_float[4] + pr.state.globals_float[5] * pr.state.globals_float[5] + pr.state.globals_float[6] * pr.state.globals_float[6]);
};

export const vectoyaw = function()
{
	var value1 = pr.state.globals_float[4], value2 = pr.state.globals_float[5];
	if ((value1 === 0.0) && (value2 === 0.0))
	{
		pr.state.globals_float[1] = 0.0;
		return;
	}
	var yaw = (Math.atan2(value2, value1) * 180.0 / Math.PI) >> 0;
	if (yaw < 0)
		yaw += 360;
	pr.state.globals_float[1] = yaw;
};

export const vectoangles = function()
{
	pr.state.globals_float[3] = 0.0;
	var value1 = [pr.state.globals_float[4], pr.state.globals_float[5], pr.state.globals_float[6]];
	if ((value1[0] === 0.0) && (value1[1] === 0.0))
	{
		if (value1[2] > 0.0)
			pr.state.globals_float[1] = 90.0;
		else
			pr.state.globals_float[1] = 270.0;
		pr.state.globals_float[2] = 0.0;
		return;
	}

	var yaw = (Math.atan2(value1[1], value1[0]) * 180.0 / Math.PI) >> 0;
	if (yaw < 0)
		yaw += 360;
	var pitch = (Math.atan2(value1[2], Math.sqrt(value1[0] * value1[0] + value1[1] * value1[1])) * 180.0 / Math.PI) >> 0;
	if (pitch < 0)
		pitch += 360;
	pr.state.globals_float[1] = pitch;
	pr.state.globals_float[2] = yaw;
};

export const random = function()
{
	pr.state.globals_float[1] = Math.random();
};

export const particle = function()
{
	sv.startParticle([pr.state.globals_float[4], pr.state.globals_float[5], pr.state.globals_float[6]],
		[pr.state.globals_float[7], pr.state.globals_float[8], pr.state.globals_float[9]],
		pr.state.globals_float[10] >> 0, pr.state.globals_float[13] >> 0);
};

export const ambientsound = function()
{
	var samp = pr.getString(pr.state.globals_int[7]), i;
	let large = false
	for (i = 0; i < sv.state.server.sound_precache.length; ++i)
	{
		if (sv.state.server.sound_precache[i] === samp)
			break;
	}
	if (i === sv.state.server.sound_precache.length)
	{
		con.print('no precache: ' + samp + '\n');
		return;
	}

	if (i > 255) {
		if (sv.state.server.protocol === protocol.VERSION.netquake) {
			return
		} else {
			large = true
		}
	}
	var signon = sv.state.server.signon;
	//johnfitz -- PROTOCOL_FITZQUAKE
	if (large)
		msg.writeByte(signon, protocol.SVC.spawnstaticsound2);
	else
		msg.writeByte(signon, protocol.SVC.spawnstaticsound);
	//johnfitz
	msg.writeCoord(signon, pr.state.globals_float[4]);
	msg.writeCoord(signon, pr.state.globals_float[5]);
	msg.writeCoord(signon, pr.state.globals_float[6]);
	//johnfitz -- PROTOCOL_FITZQUAKE
	if (large)
		msg.writeShort(signon, i)
	else
		msg.writeByte(signon, i)
	//johnfitz
	
	msg.writeByte(signon, pr.state.globals_float[10] * 255.0);
	msg.writeByte(signon, pr.state.globals_float[13] * 64.0);
};

export const sound = async function()
{
	sv.startSound(sv.state.server.edicts[pr.state.globals_int[4]],
		pr.state.globals_float[7] >> 0,
		pr.getString(pr.state.globals_int[10]),
		(pr.state.globals_float[13] * 255.0) >> 0,
		pr.state.globals_float[16]);
};

export const breakstatement = function()
{
	con.print('break statement\n');
};

export const traceline = function()
{
	var trace = sv.move([pr.state.globals_float[4], pr.state.globals_float[5], pr.state.globals_float[6]],
		vec.origin, vec.origin, [pr.state.globals_float[7], pr.state.globals_float[8], pr.state.globals_float[9]],
		pr.state.globals_float[10] >> 0, sv.state.server.edicts[pr.state.globals_int[13]]);
	pr.state.globals_float[pr.globalvars.trace_allsolid] = (trace.allsolid === true) ? 1.0 : 0.0;
	pr.state.globals_float[pr.globalvars.trace_startsolid] = (trace.startsolid === true) ? 1.0 : 0.0;
	pr.state.globals_float[pr.globalvars.trace_fraction] = trace.fraction;
	pr.state.globals_float[pr.globalvars.trace_inwater] = (trace.inwater === true) ? 1.0 : 0.0;
	pr.state.globals_float[pr.globalvars.trace_inopen] = (trace.inopen === true) ? 1.0 : 0.0;
	pr.state.globals_float[pr.globalvars.trace_endpos] = trace.endpos[0];
	pr.state.globals_float[pr.globalvars.trace_endpos1] = trace.endpos[1];
	pr.state.globals_float[pr.globalvars.trace_endpos2] = trace.endpos[2];
	var plane = trace.plane;
	pr.state.globals_float[pr.globalvars.trace_plane_normal] = plane.normal[0];
	pr.state.globals_float[pr.globalvars.trace_plane_normal1] = plane.normal[1];
	pr.state.globals_float[pr.globalvars.trace_plane_normal2] = plane.normal[2];
	pr.state.globals_float[pr.globalvars.trace_plane_dist] = plane.dist;
	pr.state.globals_int[pr.globalvars.trace_ent] = (trace.ent != null) ? trace.ent.num : 0;
};

export const newcheckclient = function(check: number)
{
	if (check <= 0)
		check = 1;
	else if (check > sv.state.svs.maxclients)
		check = sv.state.svs.maxclients;
	var i = 1;
	if (check !== sv.state.svs.maxclients)
		i += check;
	var ent;
	for (; ; ++i)
	{
		if (i === sv.state.svs.maxclients + 1)
			i = 1;
		ent = sv.state.server.edicts[i];
		if (i === check)
			break;
		if (ent.free === true)
			continue;
		if ((ent.v_float[pr.entvars.health] <= 0.0) || ((ent.v_float[pr.entvars.flags] & sv.FL.notarget) !== 0))
			continue;
		break;
	}
	checkpvs = mod.leafPVS(mod.pointInLeaf([
			ent.v_float[pr.entvars.origin] + ent.v_float[pr.entvars.view_ofs],
			ent.v_float[pr.entvars.origin1] + ent.v_float[pr.entvars.view_ofs1],
			ent.v_float[pr.entvars.origin2] + ent.v_float[pr.entvars.view_ofs2]
		], sv.state.server.worldmodel), sv.state.server.worldmodel);
	return i;
};

export const checkclient = function()
{
	if ((sv.state.server.time - sv.state.server.lastchecktime) >= 0.1)
	{
		sv.state.server.lastcheck = newcheckclient(sv.state.server.lastcheck);
		sv.state.server.lastchecktime = sv.state.server.time;
	}
	var ent = sv.state.server.edicts[sv.state.server.lastcheck];
	if ((ent.free === true) || (ent.v_float[pr.entvars.health] <= 0.0))
	{
		pr.state.globals_int[1] = 0;
		return;
	}
	var self = sv.state.server.edicts[pr.state.globals_int[pr.globalvars.self]];
	var l = mod.pointInLeaf([
			self.v_float[pr.entvars.origin] + self.v_float[pr.entvars.view_ofs],
			self.v_float[pr.entvars.origin1] + self.v_float[pr.entvars.view_ofs1],
			self.v_float[pr.entvars.origin2] + self.v_float[pr.entvars.view_ofs2]
		], sv.state.server.worldmodel).num - 1;
	if ((l < 0) || ((checkpvs[l >> 3] & (1 << (l & 7))) === 0))
	{
		pr.state.globals_int[1] = 0;
		return;
	}
	pr.state.globals_int[1] = ent.num;
};

export const stuffcmd = async function()
{
	var entnum = pr.state.globals_int[4];
	if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
		await pr.runError('Parm 0 not a client');
	var client = sv.state.svs.clients[entnum - 1];
	msg.writeByte(client.message, protocol.SVC.stufftext);
	msg.writeString(client.message, pr.getString(pr.state.globals_int[7]));
};

export const localcmd = function()
{
	cmd.state.text += pr.getString(pr.state.globals_int[4]);
};

export const cvar_get = function()
{
	var v = cvar.findVar(pr.getString(pr.state.globals_int[4]));
	pr.state.globals_float[1] = v != null ? v.value : 0.0;
};

export const cvar_set = function()
{
	cvar.set(pr.getString(pr.state.globals_int[4]), pr.getString(pr.state.globals_int[7]));
};

export const findradius = function()
{
	var chain = 0;
	var org = [pr.state.globals_float[4], pr.state.globals_float[5], pr.state.globals_float[6]], eorg = [];
	var rad = pr.state.globals_float[7];
	var i, ent;
	for (i = 1; i < sv.state.server.num_edicts; ++i)
	{
		ent = sv.state.server.edicts[i];
		if (ent.free === true)
			continue;
		if (ent.v_float[pr.entvars.solid] === sv.SOLID.not)
			continue;
		eorg[0] = org[0] - (ent.v_float[pr.entvars.origin] + (ent.v_float[pr.entvars.mins] + ent.v_float[pr.entvars.maxs]) * 0.5);
		eorg[1] = org[1] - (ent.v_float[pr.entvars.origin1] + (ent.v_float[pr.entvars.mins1] + ent.v_float[pr.entvars.maxs1]) * 0.5);
		eorg[2] = org[2] - (ent.v_float[pr.entvars.origin2] + (ent.v_float[pr.entvars.mins2] + ent.v_float[pr.entvars.maxs2]) * 0.5);
		if (Math.sqrt(eorg[0] * eorg[0] + eorg[1] * eorg[1] + eorg[2] * eorg[2]) > rad)
			continue;
		ent.v_int[pr.entvars.chain] = chain;
		chain = i;
	}
	pr.state.globals_int[1] = chain;
};

export const dprint = function()
{
	con.dPrint(varString(0));
};

export const ftos = function()
{
	var v = pr.state.globals_float[4];
	if (v === Math.floor(v))
		pr.tempString(v.toString());
	else
		pr.tempString(v.toFixed(1));
	pr.state.globals_int[1] = pr.state.string_temp;
};

export const fabs = function()
{
	pr.state.globals_float[1] = Math.abs(pr.state.globals_float[4]);
};

export const vtos = function()
{
	pr.tempString(pr.state.globals_float[4].toFixed(1)
		+ ' ' + pr.state.globals_float[5].toFixed(1)
		+ ' ' + pr.state.globals_float[6].toFixed(1));
	pr.state.globals_int[1] = pr.state.string_temp;
};

export const spawn = function()
{
	pr.state.globals_int[1] = ed.alloc().num;
};

export const remove = function()
{
	ed.free(sv.state.server.edicts[pr.state.globals_int[4]]);
};

export const find = function()
{
	var e = pr.state.globals_int[4];
	var f = pr.state.globals_int[7];
	var s = pr.getString(pr.state.globals_int[10]);
	var ed;
	for (++e; e < sv.state.server.num_edicts; ++e)
	{
		ed = sv.state.server.edicts[e];
		if (ed.free === true)
			continue;
		if (pr.getString(ed.v_int[f]) === s)
		{
			pr.state.globals_int[1] = ed.num;
			return;
		}
	}
	pr.state.globals_int[1] = 0;
};

export const moveToGoal = async function()
{
	var ent = sv.state.server.edicts[pr.state.globals_int[pr.globalvars.self]];
	if ((ent.v_float[pr.entvars.flags] & (sv.FL.onground + sv.FL.fly + sv.FL.swim)) === 0)
	{
		pr.state.globals_float[1] = 0.0;
		return;
	}
	var goal = sv.state.server.edicts[ent.v_int[pr.entvars.goalentity]];
	var dist = pr.state.globals_float[4];
	if ((ent.v_int[pr.entvars.enemy] !== 0) && (sv.closeEnough(ent, goal, dist) === true))
		return;
	if ((Math.random() >= 0.75) || (await sv.stepDirection(ent, ent.v_float[pr.entvars.ideal_yaw], dist) !== true))
		await sv.newChaseDir(ent, goal, dist);
};

export const precache_file = function()
{
	pr.state.globals_int[1] = pr.state.globals_int[4];
};

export const precache_sound = async function()
{
	var s = pr.getString(pr.state.globals_int[4]);
	pr.state.globals_int[1] = pr.state.globals_int[4];
	await pr.checkEmptyString(s);
	var i;
	for (i = 0; i < sv.state.server.sound_precache.length; ++i)
	{
		if (sv.state.server.sound_precache[i] === s)
			return;
	}
	sv.state.server.sound_precache[i] = s;
};

export const precache_model = async function()
{
	if (sv.state.server.loading !== true)
		await pr.runError('PF.Precache_*: Precache can only be done in spawn functions');
	var s = pr.getString(pr.state.globals_int[4]);
	pr.state.globals_int[1] = pr.state.globals_int[4];
	await pr.checkEmptyString(s);
	var i;
	for (i = 0; i < sv.state.server.model_precache.length; ++i)
	{
		if (sv.state.server.model_precache[i] === s)
			return;
	}
	sv.state.server.model_precache[i] = s;
	sv.state.server.models[i] = await mod.forName(s, true);
};

export const coredump = function()
{
	ed.printEdicts();
};

export const traceon = function()
{
	pr.state.trace = true;
};

export const traceoff = function()
{
	pr.state.trace = false;
};

export const eprint = function()
{
	ed.print(sv.state.server.edicts[pr.state.globals_float[4]]);
};

export const walkmove = async function()
{
	var ent = sv.state.server.edicts[pr.state.globals_int[pr.globalvars.self]];
	if ((ent.v_float[pr.entvars.flags] & (sv.FL.onground + sv.FL.fly + sv.FL.swim)) === 0)
	{
		pr.state.globals_float[1] = 0.0;
		return;
	}
	var yaw = pr.state.globals_float[4] * Math.PI / 180.0;
	var dist = pr.state.globals_float[7];
	var oldf = pr.state.xfunction;
	pr.state.globals_float[1] = await sv.movestep(ent, [Math.cos(yaw) * dist, Math.sin(yaw) * dist], true);
	pr.state.xfunction = oldf;
	pr.state.globals_int[pr.globalvars.self] = ent.num;
};

export const droptofloor = async function()
{
	var ent = sv.state.server.edicts[pr.state.globals_int[pr.globalvars.self]];
	var trace = sv.move(ed.vector(ent, pr.entvars.origin),
		ed.vector(ent, pr.entvars.mins), ed.vector(ent, pr.entvars.maxs),
		[ent.v_float[pr.entvars.origin], ent.v_float[pr.entvars.origin1], ent.v_float[pr.entvars.origin2] - 256.0], 0, ent);
	if ((trace.fraction === 1.0) || (trace.allsolid === true))
	{
		pr.state.globals_float[1] = 0.0;
		return;
	}
	ed.setVector(ent, pr.entvars.origin, trace.endpos);
	await sv.linkEdict(ent);
	ent.v_float[pr.entvars.flags] |= sv.FL.onground;
	ent.v_int[pr.entvars.groundentity] = trace.ent.num;
	pr.state.globals_float[1] = 1.0;
};

export const lightstyle = function()
{
	var style = pr.state.globals_float[4] >> 0;
	var val = pr.getString(pr.state.globals_int[7]);
	sv.state.server.lightstyles[style] = val;
	if (sv.state.server.loading === true)
		return;
	var i, client;
	for (i = 0; i < sv.state.svs.maxclients; ++i)
	{
		client = sv.state.svs.clients[i];
		if ((client.active !== true) && (client.spawned !== true))
			continue;
		msg.writeByte(client.message, protocol.SVC.lightstyle);
		msg.writeByte(client.message, style);
		msg.writeString(client.message, val);
	}
};

export const rint = function()
{
	var f = pr.state.globals_float[4];
	pr.state.globals_float[1] = (f >= 0.0 ? f + 0.5 : f - 0.5) >> 0;
};

export const floor = function()
{
	pr.state.globals_float[1] = Math.floor(pr.state.globals_float[4]);
};

export const ceil = function()
{
	pr.state.globals_float[1] = Math.ceil(pr.state.globals_float[4]);
};

export const checkbottom = function()
{
	pr.state.globals_float[1] = sv.checkBottom(sv.state.server.edicts[pr.state.globals_int[4]]) ? 1 : 0;
};

export const pointcontents = function()
{
	pr.state.globals_float[1] = sv.pointContents([pr.state.globals_float[4], pr.state.globals_float[5], pr.state.globals_float[6]]);
};

export const nextent = function()
{
	var i;
	for (i = pr.state.globals_int[4] + 1; i < sv.state.server.num_edicts; ++i)
	{
		if (sv.state.server.edicts[i].free !== true)
		{
			pr.state.globals_int[1] = i;
			return;
		}
	}
	pr.state.globals_int[1] = 0;
};

export const aim = function()
{
	var ent = sv.state.server.edicts[pr.state.globals_int[4]];
	var start: V3 = [ent.v_float[pr.entvars.origin], ent.v_float[pr.entvars.origin1], ent.v_float[pr.entvars.origin2] + 20.0];
	var dir: V3 = [pr.state.globals_float[pr.globalvars.v_forward], pr.state.globals_float[pr.globalvars.v_forward1], pr.state.globals_float[pr.globalvars.v_forward2]];
	var end: V3 = [start[0] + 2048.0 * dir[0], start[1] + 2048.0 * dir[1], start[2] + 2048.0 * dir[2]];
	var tr = sv.move(start, vec.origin, vec.origin, end, 0, ent);
	if (tr.ent != null)
	{
		if ((tr.ent.v_float[pr.entvars.takedamage] === sv.DAMAGE.aim) &&
			((host.cvr.teamplay.value === 0) || (ent.v_float[pr.entvars.team] <= 0) ||
			(ent.v_float[pr.entvars.team] !== tr.ent.v_float[pr.entvars.team])))
		{
			pr.state.globals_float[1] = dir[0];
			pr.state.globals_float[2] = dir[1];
			pr.state.globals_float[3] = dir[2];
			return;
		}
	}
	var bestdir = [dir[0], dir[1], dir[2]];
	var bestdist = sv.cvr.aim.value;
	var bestent, i, check, dist, end = vec.emptyV3();
	for (i = 1; i < sv.state.server.num_edicts; ++i)
	{
		check = sv.state.server.edicts[i];
		if (check.v_float[pr.entvars.takedamage] !== sv.DAMAGE.aim)
			continue;
		if (check === ent)
			continue;
		if ((host.cvr.teamplay.value !== 0) && (ent.v_float[pr.entvars.team] > 0) && (ent.v_float[pr.entvars.team] === check.v_float[pr.entvars.team]))
			continue;
		end[0] = check.v_float[pr.entvars.origin] + 0.5 * (check.v_float[pr.entvars.mins] + check.v_float[pr.entvars.maxs]);
		end[1] = check.v_float[pr.entvars.origin1] + 0.5 * (check.v_float[pr.entvars.mins1] + check.v_float[pr.entvars.maxs1]);
		end[2] = check.v_float[pr.entvars.origin2] + 0.5 * (check.v_float[pr.entvars.mins2] + check.v_float[pr.entvars.maxs2]);
		dir[0] = end[0] - start[0];
		dir[1] = end[1] - start[1];
		dir[2] = end[2] - start[2];
		vec.normalize(dir);
		dist = dir[0] * bestdir[0] + dir[1] * bestdir[1] + dir[2] * bestdir[2];
		if (dist < bestdist)
			continue;
		tr = sv.move(start, vec.origin, vec.origin, end, 0, ent);
		if (tr.ent === check)
		{
			bestdist = dist;
			bestent = check;
		}
	}
	if (bestent != null)
	{
		dir[0] = bestent.v_float[pr.entvars.origin] - ent.v_float[pr.entvars.origin];
		dir[1] = bestent.v_float[pr.entvars.origin1] - ent.v_float[pr.entvars.origin1];
		dir[2] = bestent.v_float[pr.entvars.origin2] - ent.v_float[pr.entvars.origin2];
		dist = dir[0] * bestdir[0] + dir[1] * bestdir[1] + dir[2] * bestdir[2];
		end[0] = bestdir[0] * dist;
		end[1] = bestdir[1] * dist;
		end[2] = dir[2];
		vec.normalize(end);
		pr.state.globals_float[1] = end[0];
		pr.state.globals_float[2] = end[1];
		pr.state.globals_float[3] = end[2];
		return;
	}
	pr.state.globals_float[1] = bestdir[0];
	pr.state.globals_float[2] = bestdir[1];
	pr.state.globals_float[3] = bestdir[2];
};

export const changeyaw = function()
{
	var ent = sv.state.server.edicts[pr.state.globals_int[pr.globalvars.self]];
	var current = vec.anglemod(ent.v_float[pr.entvars.angles1]);
	var ideal = ent.v_float[pr.entvars.ideal_yaw];
	if (current === ideal)
		return;
	var move = ideal - current;
	if (ideal > current)
	{
		if (move >= 180.0)
			move -= 360.0;
	}
	else if (move <= -180.0)
		move += 360.0;
	var speed = ent.v_float[pr.entvars.yaw_speed];
	if (move > 0.0)
	{
		if (move > speed)
			move = speed;
	}
	else if (move < -speed)
		move = -speed;
	ent.v_float[pr.entvars.angles1] = vec.anglemod(current + move);
};

/*
==============
PF_changepitch
==============
*/
const changepitch = function()
{
	const ent = sv.state.server.edicts[pr.state.globals_int[4]];
	const current = vec.anglemod(ent.v_float[pr.entvars.angles0]);

	const ideal = ed.getEdictFieldValue(ent, "idealpitch")
  const speed = ed.getEdictFieldValue(ent, "pitch_speed")

	if (current === ideal)
		return;
	var move = ideal - current;
	if (ideal > current)
	{
		if (move >= 180.0)
			move -= 360.0;
	}
	else if (move <= -180.0)
		move += 360.0;
	if (move > 0.0)
	{
		if (move > speed)
			move = speed;
	}
	else if (move < -speed)
		move = -speed;
	ent.v_float[pr.entvars.angles0] = vec.anglemod(current + move);
}

export const writeDest = async function()
{
	switch (pr.state.globals_float[4] >> 0)
	{
	case 0: // broadcast
		return sv.state.server.datagram;
	case 1: // one
		var entnum = pr.state.globals_int[pr.globalvars.msg_entity];
		if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
			await pr.runError('WriteDest: not a client');
		return sv.state.svs.clients[entnum - 1].message;
	case 2: // all
		return sv.state.server.reliable_datagram;
	case 3: // init
		return sv.state.server.signon;
	}
	await pr.runError('WriteDest: bad destination');
};

export const writeByte = async function() {msg.writeByte(await writeDest(), pr.state.globals_float[7]);};
export const writeChar = async function() {msg.writeChar(await writeDest(), pr.state.globals_float[7]);};
export const writeShort = async function() {msg.writeShort(await writeDest(), pr.state.globals_float[7]);};
export const writeLong = async function() {msg.writeLong(await writeDest(), pr.state.globals_float[7]);};
export const writeAngle = async function() {msg.writeAngle(await writeDest(), pr.state.globals_float[7]);};
export const writeCoord = async function() {msg.writeCoord(await writeDest(), pr.state.globals_float[7]);};
export const writeString = async function() {msg.writeString(await writeDest(), pr.getString(pr.state.globals_int[7]));};
export const writeEntity = async function() {msg.writeShort(await writeDest(), pr.state.globals_int[7]);};

export const makestatic = function()
{
	let bits = 0
	var ent = sv.state.server.edicts[pr.state.globals_int[4]];
	// fitzquake -- don't send invisible static entities
	if (ent.alpha === protocol.ENT_ALPHA.zero) {
		ed.free(ent)
		return
	}	
	var modelIndex = sv.modelIndex(pr.getString(ent.v_int[pr.entvars.model]))
	//johnfitz -- PROTOCOL_FITZQUAKE
	if (sv.state.server.protocol == protocol.VERSION.netquake) {
		if (modelIndex & 0xFF00 || ent.v_float[pr.entvars.frame] & 0xFF00) {
			ed.free(ent)
			return //can't display the correct model & frame, so don't show it at all
		}
	} else {
		if (modelIndex & 0xFF00)
			bits |= protocol.BASE.largemodel
		if (ent.v_float[pr.entvars.frame] & 0xFF00)
			bits |= protocol.BASE.largeframe;
		if (ent.alpha != protocol.ENT_ALPHA.default)
			bits |= protocol.BASE.alpha;
	}
	var message = sv.state.server.signon;
	if (bits) {
		msg.writeByte(message, protocol.SVC.spawnstatic2)
		msg.writeByte(message, bits)
	} else {
		msg.writeByte(message, protocol.SVC.spawnstatic);
	}

	if (bits & protocol.BASE.largemodel)
		msg.writeShort(message, modelIndex)
	else 
		msg.writeByte(message, modelIndex);

	if (bits & protocol.BASE.largeframe)
		msg.writeShort(message, ent.v_float[pr.entvars.frame])
	else 
		msg.writeByte(message, ent.v_float[pr.entvars.frame]);
	//johnfitz

	msg.writeByte(message, ent.v_float[pr.entvars.colormap]);
	msg.writeByte(message, ent.v_float[pr.entvars.skin]);
	msg.writeCoord(message, ent.v_float[pr.entvars.origin]);
	msg.writeAngle(message, ent.v_float[pr.entvars.angles]);
	msg.writeCoord(message, ent.v_float[pr.entvars.origin1]);
	msg.writeAngle(message, ent.v_float[pr.entvars.angles1]);
	msg.writeCoord(message, ent.v_float[pr.entvars.origin2]);
	msg.writeAngle(message, ent.v_float[pr.entvars.angles2]);

	//johnfitz -- PROTOCOL_FITZQUAKE
	if (bits & protocol.BASE.alpha)
		msg.writeByte(message, ent.alpha)
	//johnfitz
	
	ed.free(ent);
};

export const setcolors = function() {
	var i = pr.state.globals_int[4]

	if ((i <= 0) || (i > sv.state.svs.maxclients)) {
		con.print('setcolor: Entity is not a client')
		return
	}
	var ed = sv.state.server.edicts[i];
	var newcol = pr.state.globals_float[7];
	
	const client = sv.state.svs.clients[ed.num - 1]
	
  client.colors = newcol;
  client.edict.v_float[pr.entvars.team] =  (newcol & 15) + 1;
  var _msg = sv.state.server.reliable_datagram;

  msg.writeByte(_msg, protocol.SVC.updatecolors);
  msg.writeByte(_msg, client.num);
  msg.writeByte(_msg, newcol);
}

export const setspawnparms = async function()
{
	var i = pr.state.globals_int[4];
	if ((i <= 0) || (i > sv.state.svs.maxclients))
		await pr.runError('pf:setspawnparams: Entity is not a client');
	var spawn_parms = sv.state.svs.clients[i - 1].spawn_parms;
	for (i = 0; i <= 15; ++i)
		pr.state.globals_float[pr.globalvars.parms + i] = spawn_parms[i];
};

export const changelevel = function()
{
	if (sv.state.svs.changelevel_issued === true)
		return;
	sv.state.svs.changelevel_issued = true;
	cmd.state.text += 'changelevel ' + pr.getString(pr.state.globals_int[4]) + '\n';
};

export const fixme = async function()
{
	
	con.dPrint('Unimplemented builtin')
	//await pr.runError('unimplemented builtin');
};


const sin = function ()
{
	pr.state.globals_float[1] = Math.sin(pr.state.globals_float[4]);
}

const cos = function ()
{
	pr.state.globals_float[1] = Math.cos(pr.state.globals_float[4]);
}

const sqrt = function ()
{
	pr.state.globals_float[1] = Math.sqrt(pr.state.globals_float[4]);
}

const copyentity = function ()
{
	const ine = sv.state.server.edicts[pr.state.globals_int[4]]
	const oute = sv.state.server.edicts[pr.state.globals_int[7]]

  new Uint8Array(oute.v).set(new Uint8Array(ine.v));
}


// chained search for strings in entity fields
// entity(.string field, string match) findchain = #402;
const findchain = function ()
{
	let chain = 0
	const f = pr.state.globals_int[4]
  const s = pr.getString(pr.state.globals_int[7])
	
  // f = G_INT(OFS_PARM0);
	// s = G_STRING(OFS_PARM1);

	if (!s || !s[0])
	{
    pr.state.globals_int[1] = 0
		return;
	}

	var i, ent;
	for (i = 1; i < sv.state.server.num_edicts; ++i)
	{
		ent = sv.state.server.edicts[i];
  
		if (ent.free === true)
			continue;
    if (s !== pr.getString(ent.v_int[f])) 
      continue

    ent.v_int[pr.entvars.chain] = chain;
    chain = i;
	}

	pr.state.globals_int[1] = chain;
}

// LordHavoc: chained search for float, int, and entity reference fields
// entity(.string field, float match) findchainfloat = #403;
const findchainfloat = function ()
{
	let chain = 0
	const f = pr.state.globals_int[4]
  const s =  pr.state.globals_float[7]

	var i, ent;
	for (i = 1; i < sv.state.server.num_edicts; ++i)
	{
		ent = sv.state.server.edicts[i];
  
		if (ent.free === true)
			continue;
    if (s !== ent.v_float[f])
      continue

    ent.v_int[pr.entvars.chain] = chain;
    chain = i;
	}

	pr.state.globals_int[1] = chain;
}
const clientcommand = function ()
{
	const ed = sv.state.server.edicts[pr.state.globals_int[4]]
  const str = pr.getString(pr.state.globals_int[7])
	const i = ed.num - 1

	if (i < sv.state.svs.maxclients && sv.state.svs.clients[i].active)
	{
		const save = host.state.client
		host.state.client = sv.state.svs.clients[i]
		cmd.executeString(str, cmd.CMD_SOURCE.src_client)
		host.state.client = save
	}
	else
		con.print("pf.clientcommand: not a client\n");
}

const tokenize = function () {
  const start = pr.getString(pr.state.globals_int[4])
	let str = start
	pr.state.qctoken = []
	while (pr.state.qctoken.length < 64)
	{
		var i = 0;
		/*skip whitespace here so the token's start is accurate*/
		while (i < str.length && str.charCodeAt(i) <= 32)
			i++
		str = str.substring(i)

		if (!str)
			break
		let newToken = { 
			start: start.length - str.length,
			end: 0,
			token: ''
		 }
		pr.state.qctoken.push(newToken)

		str = com.parse(str)
		if (!str && str !== '')
			break

		newToken.token = com.state.token

		newToken.end = start.length - str.length;
	}
	pr.state.globals_int[1] = pr.state.qctoken.length;
}

const argv = function () {
	let idx = pr.state.globals_float[PARM0]
	if (idx < 0)
		idx += pr.state.qctoken.length

	if (idx >= pr.state.qctoken.length) {
		pr.state.globals_int[1] = 0
	} else {
		const token = pr.state.qctoken[idx].token
		pr.tempString(token)
		pr.state.globals_int[RETURN] = pr.state.string_temp
	}
}

const stof = function () {
	pr.state.globals_float[RETURN] = parseFloat(pr.getString(pr.state.globals_int[PARM0]))
}

const min = function ()  {
	let r = pr.state.globals_float[4]
	for (let i = 1; i < pr.state.argc; i++) {
		if (r > pr.state.globals_float[4 + i * 3])
			r = pr.state.globals_float[4 + i * 3]
	}
	pr.state.globals_int[1] = r
}

const max = function ()  {
	let r = pr.state.globals_float[4]
	for (let i = 1; i < pr.state.argc; i++) {
		if (r < pr.state.globals_float[4 + i * 3])
			r = pr.state.globals_float[4 + i * 3]
	}
	pr.state.globals_int[1] = r
}
const bound = function () {
	let minval = pr.state.globals_float[4]
	let curval = pr.state.globals_float[7]
	let maxval = pr.state.globals_float[10]
	if (curval > maxval)
		curval = maxval;
	if (curval < minval)
		curval = minval;
	pr.state.globals_int[1] = curval
}

const pow = function ()
{
	pr.state.globals_int[1] = Math.pow(pr.state.globals_float[4], pr.state.globals_float[7])
}

const extensions = {
	'DP_SV_SETCOLOR': true,
	'KRIMZON_SV_PARSECLIENTCOMMAND': true,
	'FRIK_FILE': true
}	

const checkextension = function () {
	const extFind = pr.getString(pr.state.globals_int[PARM0]) as keyof (typeof extensions)
	pr.state.globals_int[RETURN] = extensions[extFind]  === true ? 1 : 0
}

// void PF_TraceToss (void)
// {
// 	trace_t	trace;
// 	edict_t	*ent, *ignore;

// 	ent = G_EDICT(OFS_PARM0);
// 	ignore = G_EDICT(OFS_PARM1);

// 	trace = SV_Trace_Toss (ent, ignore);

// 	pr_global_struct->trace_allsolid = trace.allsolid;
// 	pr_global_struct->trace_startsolid = trace.startsolid;
// 	pr_global_struct->trace_fraction = trace.fraction;
// 	pr_global_struct->trace_inwater = trace.inwater;
// 	pr_global_struct->trace_inopen = trace.inopen;
// 	VectorCopy (trace.endpos, pr_global_struct->trace_endpos);
// 	VectorCopy (trace.plane.normal, pr_global_struct->trace_plane_normal);
// 	pr_global_struct->trace_plane_dist =  trace.plane.dist;	
// 	if (trace.ent)
// 		pr_global_struct->trace_ent = EDICT_TO_PROG(trace.ent);
// 	else
// 		pr_global_struct->trace_ent = EDICT_TO_PROG(sv.edicts);
// }

const strlen = () => {
	const str = pr.getString(pr.state.globals_int[PARM0])
	pr.state.globals_float[1] = str.length
}

const strcat = () => {
	let out = ''
	for (var i = 0; i < pr.state.argc; ++i){
		out += pr.getString(pr.state.globals_int[PARM0 + i * 3]);
		if (out.length >= 1024)
		{
			con.dPrint("PF strcat: overflow (string truncated)\n");
			break;
		}
	}
	pr.state.globals_float[RETURN] = pr.newString(out, out.length + 1)
}

const substring = () => {
	let str = pr.getString(pr.state.globals_int[PARM0]),
		start = pr.state.globals_float[PARM1],
		length = pr.state.globals_float[PARM2]
	if (start < 0)
		start = str.length + start;
	if (length < 0)
		length = str.length - start + (length+1);
	if (start < 0)
		start = 0;

	let result = ''
	if (start < str.length && length > 0) {
		result = str.substring(start, start + length)
	}
	pr.state.globals_float[RETURN] = pr.newString(result, result.length + 1)
}
const stov = () => {
	const s = pr.getString(pr.state.globals_int[PARM0])
	let str = com.parse(s)
	pr.state.globals_float[RETURN_V1] = parseFloat(com.state.token)
	str = com.parse(str)
	pr.state.globals_float[RETURN_V2] = parseFloat(com.state.token)
	str = com.parse(str)
	pr.state.globals_float[RETURN_V3] = parseFloat(com.state.token)
}

const sprintf = function () {
	const templateStr = pr.getString(pr.state.globals_int[PARM0])
	const formatTree = sprintf_parse(templateStr)
	const result = sprintf_format(formatTree)
	pr.state.globals_int[RETURN] = pr.newString(result, result.length + 1)
}

const strzone = function() {
	var i, out = '';
	for (i = 0; i < pr.state.argc; ++i){
		out += pr.getString(pr.state.globals_int[PARM0 + (i * 3)]);
	}

	pr.state.globals_int[RETURN] = pr.newString(out, out.length + 1)
}

const strunzone = function() {
	// var i, out = '';
	
	// if (!pr.state.globals_int[PARM0])
	// 	return
	// pr.c
	// for (i = 0; i < pr.state.argc; ++i)
	// 	out += pr.getString(pr.state.globals_int[PARM0 + i * 3]);

	// pr.state.globals_int[RETURN] =pr.newString(out, out + 1)
}

const fixFileName = function (name: string): null | string {
	
	if (!name ||	//blank names are bad
		name.includes(':') ||	//dos/win absolute path, ntfs ADS, amiga drives. reject them all.
		name.includes('\\') ||	//windows-only paths.
		name === '/' ||	//absolute path was given - reject
		name.includes('..'))	//someone tried to be clever.
	{
		return null;
	}
	return `data/${name}`
}

// File Handling - kind of a hack
const fopen = async () => {

	const name = pr.getString(pr.state.globals_int[4])
	const mode = pr.state.globals_float[7] as FileMode
	const files = Object.keys(pr.state.openfiles)
	let fileHandle = 0

	pr.state.globals_float[1] = -1
	let file: string | ArrayBuffer = null
	const fname = fixFileName(name)
	const gameDirFile = `${com.cvr.game.value}/${fname}`

	if (!fname)
	{
		con.print(`fopen: Access denied: ${fname}\n`);
		return;
	}
	switch (mode) {
		case FileMode.READ:
			file = await com.loadFile(fname)
			if (!file) {
				// can only *read* files that are not in data
				file = await com.loadFile(name)
			}
			break
		case FileMode.APPEND:
		case FileMode.WRITE:
			if(!await com.state.assetStore.openFile(gameDirFile, mode)) {
				return
			}
			file = gameDirFile
			break
	}		

	if (file) {
		for(var i = 0; i <= files.length; i ++)
			if (!pr.state.openfiles[i]) {
				fileHandle = i
				pr.state.openfiles[i] = {
					position: -1,
					file,
					mode
				}
				break
			}
			pr.state.globals_float[1] = fileHandle
	}

}

const fclose = () => {
	const fileHandle = pr.state.globals_int[4]
	if (fileHandle < 0 )
	{
		con.dPrint(`fclose: invalid file handle ${fileHandle}\n`);
		return;
	}
	if (pr.state.openfiles[fileHandle] === null)
	{
		con.dPrint(`fclose: no such file handle ${fileHandle} (or file has been closed) \n`);
		return;
	}
	pr.state.openfiles[fileHandle] = null
}

const fgets =  async () => {
	pr.state.globals_int[1] = 0
	if (pr.state.globals_float[4] >= Object.keys(pr.state.openfiles).length) {
		con.dPrint('fgets: invalid file handle ${fileHandle}\n')
		return
	} 
	const handle = pr.state.openfiles[pr.state.globals_float[4]]
	if (!handle || !handle.file){
		con.dPrint(`fgets: no such file handle ${handle} (or file has been closed) \n`);
		return
	}
	if (handle.mode != 0) {
		con.dPrint("fgets: file not open for reading\n");
		return
	}
	
	if (!handle.content) {
		let content = ''
		if (typeof handle.file !== 'string') {
			content = String.fromCharCode.apply(null, new Uint8Array(handle.file));
		} else {
			content = (await com.state.assetStore.readFile(handle.file)).toString('utf-8')
		}
		handle.content = content.split(/\r?\n/)
	}
	handle.position++;
	if (handle.position >= handle.content.length) {
		return
	} else {
		pr.tempString(handle.content[handle.position]);
		pr.state.globals_int[RETURN] = pr.state.string_temp;
	}
}

const fputs = async () => {
	pr.state.globals_int[1] = 0
	if (pr.state.globals_float[4] >= Object.keys(pr.state.openfiles).length) {
		con.dPrint('fputs: invalid file handle ${fileHandle}\n')
		return
	} 
	const handle = pr.state.openfiles[pr.state.globals_float[4]]
	if (!handle || !handle.file){
		con.dPrint(`fputs: no such file handle ${handle} (or file has been closed) \n`);
		return
	}
	if (handle.mode != 0) {
		con.dPrint("fputs: file not open for reading\n");
		return
	}
	const str = varString(1)
	await com.state.assetStore.writeTextFile(handle.file as string, str)
}

const infokey = () => {
	const ent = sv.state.server.edicts[pr.state.globals_int[4]];
	const key = pr.getString(pr.state.globals_int[PARM1])
	let r: null | string = null
	if (!ent) {
		if (key === '*version') {
			r = `WebQuake ${def.webquake_version}`
		} else {
			con.dPrint(`infokey: unsupported key ${key}`)
		}
	} else if (ent && ent.num <= sv.state.svs.maxclients && sv.state.svs.clients[ent.num - 1].active) {
		
		const cl = sv.state.svs.clients[ent.num-1];
		switch (key) {
			case "ip":
				r = cl.netconnection.address
				break
			case "ping":
				let total = 0;
				for (var j = 0; j <= 15; ++j)
					total += cl.ping_times[j];
				r = (total * 62.5).toFixed(2);
				break
			case "protocol":
				switch(sv.state.server.protocol) {
					case protocol.netquake:
						r = 'quake'
						break;
					case protocol.fitzquake:
						r = 'fitz666'
						break;
				}
				break;
			case "name":
				r = cl.name
				break;
			case "topcolor":
				r = (cl.colors >> 4).toFixed(0)
				break;
			case "bottomcolor":
				r = (cl.colors & 15).toFixed(0)
				break;
			case "*VIP":
				r = ""
				break;
			case "*spectator":
				r = ""
				break;
			case "*csqcactive":
				r = "0"
				break;
			default: 
				con.dPrint(`infokey: unsupported ent key ${key}`)
		}
	}
	if (r === null) {
		pr.state.globals_int[RETURN] = 0
	} else {
		pr.tempString(r)
		pr.state.globals_int[RETURN] = pr.state.string_temp
	}
}
const strpad = function() {
	const pad = pr.state.globals_float[PARM0]
	const str = varString(1)
	let r = ''
	if (pad < 0) {
		r = str.padStart(Math.abs(pad), ' ')
	} else {
		r = str.padEnd(pad, ' ')
	}
	
	pr.state.globals_int[RETURN] = pr.newString(r, r.length + 1)
}
export const builtin = [
	fixme,
	makevectors,
	setorigin,
	setmodel,
	setsize,
	fixme,
	breakstatement,
	random,
	sound,
	normalize,
	error,
	objerror,
	vlen,
	vectoyaw,
	spawn,
	remove,
	traceline,
	checkclient,
	find,
	precache_sound,
	precache_model,
	stuffcmd,
	findradius,
	bprint,
	sprint,
	dprint,
	ftos,
	vtos,
	coredump,
	traceon,
	traceoff,
	eprint,
	walkmove,
	fixme,
	droptofloor,
	lightstyle,
	rint,
	floor,
	ceil,
	fixme,
	checkbottom,
	pointcontents,
	fixme,
	fabs,
	aim,
	cvar_get,
	localcmd,
	nextent,
	particle,
	changeyaw,
	fixme,
	vectoangles,
	writeByte,
	writeChar,
	writeShort,
	writeLong,
	writeCoord,
	writeAngle,
	writeString,
	writeEntity,
	fixme,
	fixme,
	fixme,
	fixme,
	fixme,
	fixme,
	fixme,
	moveToGoal,
	precache_file,
	makestatic,
	changelevel,
	fixme,
	cvar_set,
	centerprint,
	ambientsound,
	precache_model,
	precache_sound,
	precache_file,
	setspawnparms
];

export const ebfs_builtins = [
	{ defaultFnNbr: 0, name: null, fn: fixme, fnNbr: 0 },				// has to be first entry as it is needed for initialization in PR_LoadProgs()
	{ defaultFnNbr: 1, name: "makevectors", fn: makevectors, fnNbr: 0 },	// void(entity e)	makevectors 		= #1;
	{ defaultFnNbr: 2, name: "setorigin", fn: setorigin, fnNbr: 0 },		// void(entity e, vector o) setorigin	= #2;
	{ defaultFnNbr: 3, name: "setmodel", fn: setmodel, fnNbr: 0 },		// void(entity e, string m) setmodel	= #3;
	{ defaultFnNbr: 4, name: "setsize", fn: setsize, fnNbr: 0 },			// void(entity e, vector min, vector max) setsize = #4;
	//	{ defaultFnNbr: 5, name: "fixme", fn: Fixme, fnNbr: 0 },				// void(entity e, vector min, vector max) setabssize = #5;
	{ defaultFnNbr: 6, name: "break", fn: breakstatement, fnNbr: 0 },				// void() break						= #6;
	{ defaultFnNbr: 7, name: "random", fn: random, fnNbr: 0 },			// float() random						= #7;
	{ defaultFnNbr: 8, name: "sound", fn: sound, fnNbr: 0 },				// void(entity e, float chan, string samp) sound = #8;
	{ defaultFnNbr: 9, name: "normalize", fn: normalize, fnNbr: 0 },		// vector(vector v) normalize			= #9;
	{ defaultFnNbr: 10, name: "error", fn: error, fnNbr: 0 },				// void(string e) error				= #10;
	{ defaultFnNbr: 11, name: "objerror", fn: objerror, fnNbr: 0 },		// void(string e) objerror				= #11;
	{ defaultFnNbr: 12, name: "vlen", fn: vlen, fnNbr: 0 },				// float(vector v) vlen				= #12;
	{ defaultFnNbr: 13, name: "vectoyaw", fn: vectoyaw, fnNbr: 0 },		// float(vector v) vectoyaw		= #13;
	{ defaultFnNbr: 14, name: "spawn", fn: spawn, fnNbr: 0 },				// entity() spawn						= #14;
	{ defaultFnNbr: 15, name: "remove", fn: remove, fnNbr: 0 },			// void(entity e) remove				= #15;
	{ defaultFnNbr: 16, name: "traceline", fn: traceline, fnNbr: 0 },		// float(vector v1, vector v2, float tryents) traceline = #16;
	{ defaultFnNbr: 17, name: "checkclient", fn: checkclient, fnNbr: 0 },	// entity() clientlist					= #17;
	{ defaultFnNbr: 18, name: "find", fn: find, fnNbr: 0 },				// entity(entity start, .string fld, string match) find = #18;
	{ defaultFnNbr: 19, name: "precache_sound", fn: precache_sound, fnNbr: 0 },	// void(string s) precache_sound		= #19;
	{ defaultFnNbr: 20, name: "precache_model", fn: precache_model, fnNbr: 0 },	// void(string s) precache_model		= #20;
	{ defaultFnNbr: 21, name: "stuffcmd", fn: stuffcmd, fnNbr: 0 },		// void(entity client, string s)stuffcmd = #21;
	{ defaultFnNbr: 22, name: "findradius", fn: findradius, fnNbr: 0 },	// entity(vector org, float rad) findradius = #22;
	{ defaultFnNbr: 23, name: "bprint", fn: bprint, fnNbr: 0 },			// void(string s) bprint				= #23;
	{ defaultFnNbr: 24, name: "sprint", fn: sprint, fnNbr: 0 },			// void(entity client, string s) sprint = #24;
	{ defaultFnNbr: 25, name: "dprint", fn: dprint, fnNbr: 0 },			// void(string s) dprint				= #25;
	{ defaultFnNbr: 26, name: "ftos", fn: ftos, fnNbr: 0 },				// void(string s) ftos				= #26;
	{ defaultFnNbr: 27, name: "vtos", fn: vtos, fnNbr: 0 },				// void(string s) vtos				= #27;
	{ defaultFnNbr: 28, name: "coredump", fn: coredump, fnNbr: 0 },
	{ defaultFnNbr: 29, name: "traceon", fn: traceon, fnNbr: 0 },
	{ defaultFnNbr: 30, name: "traceoff", fn: traceoff, fnNbr: 0 },
	{ defaultFnNbr: 31, name: "eprint", fn: eprint, fnNbr: 0 },			// void(entity e) debug print an entire entity
	{ defaultFnNbr: 32, name: "walkmove", fn: walkmove, fnNbr: 0 },		// float(float yaw, float dist) walkmove
	//	{ defaultFnNbr: 33, name: "fixme", fn: Fixme, fnNbr: 0 },				// float(float yaw, float dist) walkmove
	{ defaultFnNbr: 34, name: "droptofloor", fn: droptofloor, fnNbr: 0 },
	{ defaultFnNbr: 35, name: "lightstyle", fn: lightstyle, fnNbr: 0 },
	{ defaultFnNbr: 36, name: "rint", fn: rint, fnNbr: 0 },
	{ defaultFnNbr: 37, name: "floor", fn: floor, fnNbr: 0 },
	{ defaultFnNbr: 38, name: "ceil", fn: ceil, fnNbr: 0 },
	//	{ defaultFnNbr: 39, name: "fixme", fn: Fixme, fnNbr: 0 },
	{ defaultFnNbr: 40, name: "checkbottom", fn: checkbottom, fnNbr: 0 },
	{ defaultFnNbr: 41, name: "pointcontents", fn: pointcontents, fnNbr: 0 },
	//	{ defaultFnNbr: 42, name: "fixme", fn: Fixme, fnNbr: 0 },
	{ defaultFnNbr: 43, name: "fabs", fn: fabs, fnNbr: 0 },
	{ defaultFnNbr: 44, name: "aim", fn: aim, fnNbr: 0 },
	{ defaultFnNbr: 45, name: "cvar", fn: cvar_get, fnNbr: 0 },
	{ defaultFnNbr: 46, name: "localcmd", fn: localcmd, fnNbr: 0 },
	{ defaultFnNbr: 47, name: "nextent", fn: nextent, fnNbr: 0 },
	{ defaultFnNbr: 48, name: "particle", fn: particle, fnNbr: 0 },
	{ defaultFnNbr: 49, name: "ChangeYaw", fn: changeyaw, fnNbr: 0 },
	//	{ defaultFnNbr: 50, name: "fixme", fn: Fixme, fnNbr: 0 },
	{ defaultFnNbr: 51, name: "vectoangles", fn: vectoangles, fnNbr: 0 },
	{ defaultFnNbr: 52, name: "WriteByte", fn: writeByte, fnNbr: 0 },
	{ defaultFnNbr: 53, name: "WriteChar", fn: writeChar, fnNbr: 0 },
	{ defaultFnNbr: 54, name: "WriteShort", fn: writeShort, fnNbr: 0 },
	{ defaultFnNbr: 55, name: "WriteLong", fn: writeLong, fnNbr: 0 },
	{ defaultFnNbr: 56, name: "WriteCoord", fn: writeCoord, fnNbr: 0 },
	{ defaultFnNbr: 57, name: "WriteAngle", fn: writeAngle, fnNbr: 0 },
	{ defaultFnNbr: 58, name: "WriteString", fn: writeString, fnNbr: 0 },
	{ defaultFnNbr: 59, name: "WriteEntity", fn: writeEntity, fnNbr: 0 },
	{ defaultFnNbr: 60, name: "sin", fn: sin, fnNbr: 0 },
	{ defaultFnNbr: 61, name: "cos", fn: cos, fnNbr: 0 },
	{ defaultFnNbr: 62, name: "sqrt", fn: sqrt, fnNbr: 0 },
	{ defaultFnNbr: 63, name: "changepitch", fn: changepitch, fnNbr: 0 },
	{ defaultFnNbr: 64, name: "TraceToss", fn: fixme, fnNbr: 0 },
	{ defaultFnNbr: 65, name: "etos", fn: fixme, fnNbr: 0 },
	//	{ defaultFnNbr: 66, name: "WaterMove", fn: WaterMove, fnNbr: 0 },
	{ defaultFnNbr: 67, name: "movetogoal", fn: moveToGoal, fnNbr: 0 },
	{ defaultFnNbr: 68, name: "precache_file", fn: precache_file, fnNbr: 0 },
	{ defaultFnNbr: 69, name: "makestatic", fn: makestatic, fnNbr: 0 },
	{ defaultFnNbr: 70, name: "changelevel", fn: changelevel, fnNbr: 0 },
	//	{ defaultFnNbr: 71, name: "fixme", fn: Fixme, fnNbr: 0 },
	{ defaultFnNbr: 72, name: "cvar_set", fn: cvar_set, fnNbr: 0 },
	{ defaultFnNbr: 73, name: "centerprint", fn: centerprint, fnNbr: 0 },
	{ defaultFnNbr: 74, name: "ambientsound", fn: ambientsound, fnNbr: 0 },
	{ defaultFnNbr: 75, name: "precache_model2", fn: precache_model, fnNbr: 0 },
	{ defaultFnNbr: 76, name: "precache_sound2", fn: precache_sound, fnNbr: 0 },	// precache_sound2 is different only for qcc
	{ defaultFnNbr: 77, name: "precache_file2", fn: precache_file, fnNbr: 0 },
	{ defaultFnNbr: 78, name: "setspawnparms", fn: setspawnparms, fnNbr: 0 },
	//	{  79, "fixme", FIXME},
	//	{  80, "fixme", FIXME},
	{ defaultFnNbr: 80, name: 'infokey', fn: infokey, fnNbr: 0 },
	{ defaultFnNbr: 81, name: "stof", fn: stof, fnNbr: 0 },	// 2001-09-20 QuakeC string manipulation by FrikaC/Maddes

	// 2001-11-15 DarkPlaces general builtin functions by Lord Havoc  start
	{ defaultFnNbr: 90, name: "tracebox", fn: fixme, fnNbr: 0 },
	{ defaultFnNbr: 91, name: "randomvec", fn: fixme, fnNbr: 0 },
	//	{ defaultFnNbr: 92, name: "getlight", fn: GetLight, fnNbr: 0 },	// not implemented yet
	//	{ defaultFnNbr: 93, name: "cvar_create", fn: cvar_create, fnNbr: 0 },		// 2001-09-18 New BuiltIn Function: cvar_create() by Maddes
	{ defaultFnNbr: 94, name: "fmin", fn: min, fnNbr: 0 },
	{ defaultFnNbr: 95, name: "fmax", fn: max, fnNbr: 0 },
	{ defaultFnNbr: 96, name: "fbound", fn: bound, fnNbr: 0 },
	{ defaultFnNbr: 97, name: "fpow", fn: pow, fnNbr: 0 },
	{ defaultFnNbr: 98, name: "findfloat", fn: fixme, fnNbr: 0 },
	{ defaultFnNbr: 99, name: "checkextension", fn: checkextension, fnNbr: 0 },	// 2001-10-20 Extension System by Lord Havoc/Maddes
	//	{ defaultFnNbr: 0, name: "checkextension", fn: extension_find, fnNbr: 0 },
	{ defaultFnNbr: 100, name: "builtin_find", fn: fixme, fnNbr: 0 },		// 2001-09-14 Enhanced BuiltIn Function System (EBFS) by Maddes
	{ defaultFnNbr: 101, name: "cmd_find", fn: fixme, fnNbr: 0 },				// 2001-09-16 New BuiltIn Function: cmd_find() by Maddes
	{ defaultFnNbr: 102, name: "cvar_find", fn: fixme, fnNbr: 0 },				// 2001-09-16 New BuiltIn Function: cvar_find() by Maddes
	{ defaultFnNbr: 103, name: "cvar_string", fn: fixme, fnNbr: 0 },			// 2001-09-16 New BuiltIn Function: cvar_string() by Maddes
	//	{ defaultFnNbr: 105, name: "cvar_free", fn: cvar_free, fnNbr: 0 },				// 2001-09-18 New BuiltIn Function: cvar_free() by Maddes
	//	{ defaultFnNbr: 106, name: "NVS_InitSVCMsg", fn: NVS_InitSVCMsg, fnNbr: 0 },	// 2000-05-02 NVS SVC by Maddes
	{ defaultFnNbr: 107, name: "WriteFloat", fn: fixme, fnNbr: 0 },			// 2001-09-16 New BuiltIn Function: WriteFloat() by Maddes
	{ defaultFnNbr: 108, name: "etof", fn: fixme, fnNbr: 0 },						// 2001-09-25 New BuiltIn Function: etof() by Maddes
	{ defaultFnNbr: 109, name: "ftoe", fn: fixme, fnNbr: 0 },						// 2001-09-25 New BuiltIn Function: ftoe() by Maddes
	// 2001-09-20 QuakeC file access by FrikaC/Maddes  start
	{ defaultFnNbr: 110, name: "fopen", fn: fopen, fnNbr: 0 },
	{ defaultFnNbr: 111, name: "fclose", fn: fclose, fnNbr: 0 },
	{ defaultFnNbr: 112, name: "fgets", fn: fgets, fnNbr: 0 },
	{ defaultFnNbr: 113, name: "fputs", fn: fputs, fnNbr: 0 },
	{ defaultFnNbr: 0, name: "open", fn: fixme, fnNbr: 0 },						// 0 indicates that this entry is just for remapping (because of name and number change)
	{ defaultFnNbr: 0, name: "close", fn: fixme, fnNbr: 0 },
	{ defaultFnNbr: 0, name: "read", fn: fixme, fnNbr: 0 },
	{ defaultFnNbr: 0, name: "write", fn: fixme, fnNbr: 0 },
	// 2001-09-20 QuakeC file access by FrikaC/Maddes  end

	// 2001-09-20 QuakeC string manipulation by FrikaC/Maddes  start
	{ defaultFnNbr: 114, name: "strlen", fn: strlen, fnNbr: 0 },
	{ defaultFnNbr: 115, name: "strcat", fn: strcat, fnNbr: 0 },
	{ defaultFnNbr: 116, name: "substring", fn: substring, fnNbr: 0 },
	{ defaultFnNbr: 117, name: "stov", fn: stov, fnNbr: 0 },
	{ defaultFnNbr: 118, name: "strzone", fn: strzone, fnNbr: 0 },
	{ defaultFnNbr: 119, name: "strunzone", fn: strunzone, fnNbr: 0 },
	{ defaultFnNbr: 225, name: "strpad", fn: strpad, fnNbr: 0 },
	{ defaultFnNbr: 0, name: "zone", fn: fixme, fnNbr: 0 },		// 0 indicates that this entry is just for remapping (because of name and number change)
	{ defaultFnNbr: 0, name: "unzone", fn: fixme, fnNbr: 0 },
	// 2001-09-20 QuakeC string manipulation by FrikaC/Maddes  end

	// 2001-11-15 DarkPlaces general builtin functions by LordHavoc  start
	{ defaultFnNbr: 400, name: "copyentity", fn: copyentity, fnNbr: 0 },
	{ defaultFnNbr: 401, name: "setcolor", fn: setcolors, fnNbr: 0 },
	{ defaultFnNbr: 402, name: "findchain", fn: findchain, fnNbr: 0 },
	{ defaultFnNbr: 403, name: "findchainfloat", fn: findchainfloat, fnNbr: 0},
	{ defaultFnNbr: 440, name: 'clientcommand', fn: clientcommand, fnNbr: 0},
	{ defaultFnNbr: 441, name: 'tokenize', fn: tokenize, fnNbr: 0},
	{ defaultFnNbr: 442, name: 'argv', fn: argv, fnNbr: 0},
	{ defaultFnNbr: 514, name: 'tokenize_console', fn: tokenize, fnNbr: 0},
	{ defaultFnNbr: 627, name: 'sprintf', fn: sprintf, fnNbr: 0}
	
]