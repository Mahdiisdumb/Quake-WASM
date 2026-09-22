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
import * as loc from './loc'
import {sprintf_format, sprintf_parse} from './pf_sprintf'
import * as pf_strings from './pf_strings'
// Import cycle: pf_fte reaches back for readQCFileText/fwriteInternal, but only from inside its
// function bodies, so its module body completes before this one reads its exports.
import * as pf_fte from './pf_fte'
import { FileMode } from './interfaces/store/IAssetStore'
import { Edict, V3, Model, Face } from './types'

const PARM0 = 4
const PARM1 = 7
const PARM2 = 10
const PARM3 = 13
const PARM4 = 16
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

// 2021 rerelease PR_VarString_qex (pr_ext.c ~8535): arg[first] is a LOC_Format string with
// {N}/{} placeholders substituted from args[first+1..]. Format string and every substituted
// argument go through the localization table first (QSS-M PR_GetStringArg); with no loc file
// loaded loc.getString returns its input and this degrades to plain substitution.
const varStringQex = function(first: number)
{
	if (first >= pr.state.argc)
		return '';
	const format = loc.getString(pr.getString(pr.state.globals_int[PARM0 + first * 3]));
	const argBase = first + 1;
	// PR_GetStringArg: out-of-range arguments are empty strings, in-range ones are localized.
	const out = loc.format(format, (idx: number) => {
		const i = argBase + idx;
		if (i < 0 || i >= pr.state.argc)
			return '';
		return loc.getString(pr.getString(pr.state.globals_int[PARM0 + i * 3]));
	});
	if (out.length > 255)
		con.dPrint('PF_VarString: ' + out.length + ' characters exceeds standard limit of 255.\n');
	return out;
};

export const error = function()
{
	con.print('======SERVER ERROR in ' + pr.getString(pr.state.xfunction.name) + '\n' + varString(0) + '\n');
	ed.print(pr.state.edicts[pr.state.globals_int[pr.globalvars.self]]);
	host.throwError('Program error');
};

export const objerror = function()
{
	con.print('======OBJECT ERROR in ' + pr.getString(pr.state.xfunction.name) + '\n' + varString(0) + '\n');
	const ent = pr.state.edicts[pr.state.globals_int[pr.globalvars.self]]
	ed.print(ent);
	ed.free(ent)

	//johnfitz -- by design, this should not be fatal
	//await host.error('Program error');
};

export const makevectors = function()
{
	var forward = vec.scratch(), right = vec.scratch(), up = vec.scratch();
	var angles = vec.scratch();
	angles[0] = pr.state.globals_float[4]; angles[1] = pr.state.globals_float[5]; angles[2] = pr.state.globals_float[6];
	vec.angleVectors(angles, forward, right, up);
	var i;
	for (i = 0; i <= 2; ++i)
	{
		pr.state.globals_float[pr.globalvars.v_forward + i] = forward[i];
		pr.state.globals_float[pr.globalvars.v_right + i] = right[i];
		pr.state.globals_float[pr.globalvars.v_up + i] = up[i];
	}
};

export const setorigin = function()
{
	var e = pr.state.edicts[pr.state.globals_int[4]];
	e.v_float[pr.entvars.origin] = pr.state.globals_float[7];
	e.v_float[pr.entvars.origin1] = pr.state.globals_float[8];
	e.v_float[pr.entvars.origin2] = pr.state.globals_float[9];
	sv.linkEdict(e);
};

export const setMinMaxSize = function(e: Edict, min:V3, max: V3)
{
	if ((min[0] > max[0]) || (min[1] > max[1]) || (min[2] > max[2]))
		pr.runError('backwards mins/maxs');
	ed.setVector(e, pr.entvars.mins, min);
	ed.setVector(e, pr.entvars.maxs, max);
	e.v_float[pr.entvars.size] = max[0] - min[0];
	e.v_float[pr.entvars.size1] = max[1] - min[1];
	e.v_float[pr.entvars.size2] = max[2] - min[2];
	sv.linkEdict(e);
};

export const setsize = function()
{
	setMinMaxSize(pr.state.edicts[pr.state.globals_int[4]],
		[pr.state.globals_float[7], pr.state.globals_float[8], pr.state.globals_float[9]],
		[pr.state.globals_float[10], pr.state.globals_float[11], pr.state.globals_float[12]]);
};

// Runtime precache: append + load + tell live clients (QSS SV_Precache_Model, pr_cmds.c:1203).
export const precacheModelLate = function (name: string): number
{
	var i;
	for (i = 0; i < sv.state.server.model_precache.length; ++i)
	{
		if (sv.state.server.model_precache[i] === name)
			return i;
	}
	sv.state.server.model_precache[i] = name;
	// Missing file is only fatal for the worldmodel (QSS Mod_ForName(s, i==1)).
	sv.state.server.models[i] = mod.forName(name, i === 1);
	latePrecache(protocol.PRECACHE_TYPE.model, i, name);
	return i;
};

export const setmodel = function()
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
	{
		// With the extension system on, an unprecached setmodel late-precaches instead of
		// the vanilla fatal (QSS PF_sv_setmodel, pr_cmds.c:298).
		if (pr.cvr.pr_checkextension.value)
		{
			con.print('PF_setmodel("' + m + '"): Model was not precached\n');
			i = precacheModelLate(m);
		}
		else
			pr.runError('no precache: ' + m + '\n');
	}

	e.v_int[pr.entvars.model] = pr.state.globals_int[7];
	e.v_float[pr.entvars.modelindex] = i;
	var mod = sv.state.server.models[i];
	if (mod != null)
		// Alias models carry vanilla's +/-16 clip box separate from their real render
		// bounds (QSS PF_setmodel with sv_gameplayfix_setmodelrealbox 0, its default).
		setMinMaxSize(e, mod.clip_mins != null ? mod.clip_mins : mod.mins, mod.clip_maxs != null ? mod.clip_maxs : mod.maxs);
	else
		setMinMaxSize(e, vec.origin, vec.origin);
};

// QSS-M runs bprint/sprint/centerprint/WriteString through LOC_GetString unconditionally
// (pr_cmds.c:368/389/421/1694); classic progs' strings never start with '$'.
export const bprint = function()
{
	host.broadcastPrint(loc.getString(varString(0)));
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
	msg.writeString(client.message, loc.getString(varString(1)));
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
	msg.writeString(client.message, loc.getString(varString(1)));
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

	// Float precision (no truncation): modern engines bind vectoangles (#51) to
	// a float builtin (QSS-M PF_ext_vectoangles). The classic int cast forced
	// QC-computed view angles onto whole degrees, making scripted camera pans
	// (e.g. progs_dump cutscenes, which set self.angles = vectoangles(dir) each
	// frame) step 1 degree at a time instead of sweeping smoothly.
	var yaw = Math.atan2(value1[1], value1[0]) * 180.0 / Math.PI;
	if (yaw < 0)
		yaw += 360;
	var pitch = Math.atan2(value1[2], Math.sqrt(value1[0] * value1[0] + value1[1] * value1[1])) * 180.0 / Math.PI;
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
	msg.writeCoord(signon, pr.state.globals_float[4], sv.state.server.protocolFlags);
	msg.writeCoord(signon, pr.state.globals_float[5], sv.state.server.protocolFlags);
	msg.writeCoord(signon, pr.state.globals_float[6], sv.state.server.protocolFlags);
	//johnfitz -- PROTOCOL_FITZQUAKE
	if (large)
		msg.writeShort(signon, i)
	else
		msg.writeByte(signon, i)
	//johnfitz
	
	msg.writeByte(signon, pr.state.globals_float[10] * 255.0);
	msg.writeByte(signon, pr.state.globals_float[13] * 64.0);
};

export const sound = function()
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

const setTraceGlobals = function(trace: ReturnType<typeof sv.move>)
{
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

export const traceline = function()
{
	var v1 = vec.scratch(), v2 = vec.scratch();
	v1[0] = pr.state.globals_float[4]; v1[1] = pr.state.globals_float[5]; v1[2] = pr.state.globals_float[6];
	v2[0] = pr.state.globals_float[7]; v2[1] = pr.state.globals_float[8]; v2[2] = pr.state.globals_float[9];
	var trace = sv.move(v1, vec.origin, vec.origin, v2,
		pr.state.globals_float[10] >> 0, pr.state.edicts[pr.state.globals_int[13]], sv.state.traceTraceline);
	setTraceGlobals(trace);
};

// void(vector v1, vector mins, vector maxs, vector v2, float nomonsters, entity forent)
// tracebox = #90 (DP_QC_TRACEBOX; FTE PF_tracebox)
export const tracebox = function()
{
	var g = pr.state.globals_float;
	var v1 = vec.scratch(), mins = vec.scratch(), maxs = vec.scratch(), v2 = vec.scratch();
	v1[0] = g[4]; v1[1] = g[5]; v1[2] = g[6];
	mins[0] = g[7]; mins[1] = g[8]; mins[2] = g[9];
	maxs[0] = g[10]; maxs[1] = g[11]; maxs[2] = g[12];
	v2[0] = g[13]; v2[1] = g[14]; v2[2] = g[15];
	var trace = sv.move(v1, mins, maxs, v2,
		g[16] >> 0, pr.state.edicts[pr.state.globals_int[19]], sv.state.traceTraceline);
	setTraceGlobals(trace);
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
	checkpvs = mod.leafPVS(mod.pointInLeaf(ed.eyePosition(ent, vec.scratch()), sv.state.server.worldmodel), sv.state.server.worldmodel);
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
	var l = mod.pointInLeaf(ed.eyePosition(self, vec.scratch()), sv.state.server.worldmodel) - 1;
	// checkpvs == null: no PVS cached yet. Vanilla's checkpvs is a zeroed static buffer, and a
	// zeroed row reads as "not visible" — same result here. Reachable when the JS sim resumes
	// with a wasm-fresh lastchecktime (live sv_wasm fallback mid-map) before its first refresh.
	if ((l < 0) || (checkpvs == null) || ((checkpvs[l >> 3] & (1 << (l & 7))) === 0))
	{
		pr.state.globals_int[1] = 0;
		return;
	}
	pr.state.globals_int[1] = ent.num;
};

// Varargs (FTE PF_stuffcmd: PF_VarString(1)). Vanilla/QSS-M read PARM1 only, which sends a
// rerelease-style stuffcmd(client, "fog ", ftos(d), ...) as a bare command.
export const stuffcmd = function()
{
	var entnum = pr.state.globals_int[4];
	if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
		pr.runError('Parm 0 not a client');
	var client = sv.state.svs.clients[entnum - 1];
	msg.writeByte(client.message, protocol.SVC.stufftext);
	msg.writeString(client.message, varString(1));
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
	for (i = 1; i < pr.state.num_edicts; ++i)
	{
		ent = pr.state.edicts[i];
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
	ed.free(pr.state.edicts[pr.state.globals_int[4]]);
};

export const find = function()
{
	var e = pr.state.globals_int[4];
	var f = pr.state.globals_int[7];
	var s = pr.state.globals_int[10];
	var ed;
	for (++e; e < pr.state.num_edicts; ++e)
	{
		ed = pr.state.edicts[e];
		if (ed.free === true)
			continue;
		if (pr.compareStrings(ed.v_int[f], s))
		{
			pr.state.globals_int[1] = ed.num;
			return;
		}
	}
	pr.state.globals_int[1] = 0;
};

// entity(entity start, .float fld, float match) findfloat = #98 (DP_QC_FINDFLOAT). FTE's
// PF_FindFloat compares raw int bits (pr_bgcmd.c:1672), so the one builtin serves float fields
// and entity fields (DP's findentity alias) alike.
export const findfloat = function()
{
	var e = pr.state.globals_int[4];
	var f = pr.state.globals_int[7];
	var s = pr.state.globals_int[10];
	var ed;
	for (++e; e < pr.state.num_edicts; ++e)
	{
		// a csqc VM mid-rebuild (reconnect/reload) has holes below num_edicts
		ed = pr.state.edicts[e];
		if ((ed == null) || (ed.free === true))
			continue;
		if (ed.v_int[f] === s)
		{
			pr.state.globals_int[1] = ed.num;
			return;
		}
	}
	pr.state.globals_int[1] = 0;
};

// float(entity e) wasfreed = #353 (DP_QC_ENTITYDATA; FTE PF_WasFreed pr_bgcmd.c:3961).
export const wasfreed = function()
{
	var ed = pr.state.edicts[pr.state.globals_int[4]];
	pr.state.globals_float[1] = (ed == null || ed.free === true) ? 1.0 : 0.0;
};

export const moveToGoal = function()
{
	var ent = pr.state.edicts[pr.state.globals_int[pr.globalvars.self]];
	if ((ent.v_float[pr.entvars.flags] & (sv.FL.onground + sv.FL.fly + sv.FL.swim)) === 0)
	{
		pr.state.globals_float[1] = 0.0;
		return;
	}
	var goal = pr.state.edicts[ent.v_int[pr.entvars.goalentity]];
	var dist = pr.state.globals_float[4];
	if ((ent.v_int[pr.entvars.enemy] !== 0) && (sv.closeEnough(ent, goal, dist) === true))
		return;
	if ((Math.random() >= 0.75) || (sv.stepDirection(ent, ent.v_float[pr.entvars.ideal_yaw], dist) !== true))
		sv.newChaseDir(ent, goal, dist);
};

export const precache_file = function()
{
	pr.state.globals_int[1] = pr.state.globals_int[4];
};

// A precache that lands after the map has spawned: tell the connected clients about the new table
// entry (FTE PF_precache_model_Internal, pr_cmds.c:4558, svcdp_precache) instead of erroring the
// QC out mid-entry-point. Gated on foreign defs - vanilla progs keep the historical PR_RunError.
const latePrecache = function (type: number, index: number, name: string) {
	if ((sv.state.server.phase === 'loading') || !pr.vms.ssqc.foreigndefs)
		return;
	con.dPrint(`Delayed precache: ${name}\n`);
	msg.writeByte(sv.state.server.reliable_datagram, protocol.SVC.dp_precache);
	msg.writeShort(sv.state.server.reliable_datagram, (index & 0x3fff) | (type << 14));
	msg.writeString(sv.state.server.reliable_datagram, name);
};

export const precache_sound = function()
{
	var s = pr.getString(pr.state.globals_int[4]);
	pr.state.globals_int[1] = pr.state.globals_int[4];
	pr.checkEmptyString(s);
	var i;
	for (i = 0; i < sv.state.server.sound_precache.length; ++i)
	{
		if (sv.state.server.sound_precache[i] === s)
			return;
	}
	sv.state.server.sound_precache[i] = s;
	latePrecache(protocol.PRECACHE_TYPE.sound, i, s);
};

export const precache_model = function()
{
	// Vanilla's fatal post-spawn precache, kept for vanilla defs (see latePrecache).
	if ((sv.state.server.phase !== 'loading') && !pr.vms.ssqc.foreigndefs)
		pr.runError('PF.Precache_*: Precache can only be done in spawn functions');
	var s = pr.getString(pr.state.globals_int[4]);
	pr.state.globals_int[1] = pr.state.globals_int[4];
	pr.checkEmptyString(s);
	var i;
	for (i = 0; i < sv.state.server.model_precache.length; ++i)
	{
		if (sv.state.server.model_precache[i] === s)
			return;
	}
	sv.state.server.model_precache[i] = s;
	// A missing file at spawn fails the map load (vanilla PF_precache_model crash=true);
	// at runtime it yields a null model instead of killing the session (QSS i==1 rule).
	sv.state.server.models[i] = mod.forName(s, sv.state.server.phase === 'loading' || i === 1);
	latePrecache(protocol.PRECACHE_TYPE.model, i, s);
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
	ed.print(pr.state.edicts[pr.state.globals_int[4]]);
};

export const walkmove = function()
{
	var ent = pr.state.edicts[pr.state.globals_int[pr.globalvars.self]];
	if ((ent.v_float[pr.entvars.flags] & (sv.FL.onground + sv.FL.fly + sv.FL.swim)) === 0)
	{
		pr.state.globals_float[1] = 0.0;
		return;
	}
	var yaw = pr.state.globals_float[4] * Math.PI / 180.0;
	var dist = pr.state.globals_float[7];
	var oldf = pr.state.xfunction;
	pr.state.globals_float[1] = sv.movestep(ent, [Math.cos(yaw) * dist, Math.sin(yaw) * dist], true);
	pr.state.xfunction = oldf;
	pr.state.globals_int[pr.globalvars.self] = ent.num;
};

export const droptofloor = function()
{
	var ent = pr.state.edicts[pr.state.globals_int[pr.globalvars.self]];
	var dfEnd = vec.scratch();
	dfEnd[0] = ent.v_float[pr.entvars.origin]; dfEnd[1] = ent.v_float[pr.entvars.origin1]; dfEnd[2] = ent.v_float[pr.entvars.origin2] - 256.0;
	var trace = sv.move(ed.vector(ent, pr.entvars.origin, vec.scratch()),
		ed.vector(ent, pr.entvars.mins, vec.scratch()), ed.vector(ent, pr.entvars.maxs, vec.scratch()),
		dfEnd, 0, ent, sv.state.traceDropToFloor);
	if ((trace.fraction === 1.0) || (trace.allsolid === true))
	{
		pr.state.globals_float[1] = 0.0;
		return;
	}
	ed.setVector(ent, pr.entvars.origin, trace.endpos);
	sv.linkEdict(ent);
	ent.v_float[pr.entvars.flags] |= sv.FL.onground;
	ent.v_int[pr.entvars.groundentity] = trace.ent.num;
	pr.state.globals_float[1] = 1.0;
};

export const lightstyle = function()
{
	var style = pr.state.globals_float[4] >> 0;
	var val = pr.getString(pr.state.globals_int[7]);
	sv.state.server.lightstyles[style] = val;
	if (sv.state.server.phase === 'loading')
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
	pr.state.globals_float[1] = sv.checkBottom(pr.state.edicts[pr.state.globals_int[4]]) ? 1 : 0;
};

export const pointcontents = function()
{
	var p = vec.scratch();
	p[0] = pr.state.globals_float[4]; p[1] = pr.state.globals_float[5]; p[2] = pr.state.globals_float[6];
	pr.state.globals_float[1] = sv.pointContents(p);
};

export const nextent = function()
{
	var i;
	for (i = pr.state.globals_int[4] + 1; i < pr.state.num_edicts; ++i)
	{
		if (pr.state.edicts[i].free !== true)
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
	var start: V3 = vec.scratch();
	start[0] = ent.v_float[pr.entvars.origin]; start[1] = ent.v_float[pr.entvars.origin1]; start[2] = ent.v_float[pr.entvars.origin2] + 20.0;
	var dir: V3 = vec.scratch();
	dir[0] = pr.state.globals_float[pr.globalvars.v_forward]; dir[1] = pr.state.globals_float[pr.globalvars.v_forward1]; dir[2] = pr.state.globals_float[pr.globalvars.v_forward2];
	var end: V3 = vec.scratch();
	end[0] = start[0] + 2048.0 * dir[0]; end[1] = start[1] + 2048.0 * dir[1]; end[2] = start[2] + 2048.0 * dir[2];
	var tr = sv.move(start, vec.origin, vec.origin, end, 0, ent, sv.state.traceAim);
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
	var bestdir: V3 = vec.scratch();
	vec.copy(dir, bestdir);
	var bestdist = sv.cvr.aim.value;
	var bestent, i, check, dist;
	end = vec.scratch();
	for (i = 1; i < pr.state.num_edicts; ++i)
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
		tr = sv.move(start, vec.origin, vec.origin, end, 0, ent, sv.state.traceAim);
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
	var ent = pr.state.edicts[pr.state.globals_int[pr.globalvars.self]];
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

export const writeDest = function()
{
	switch (pr.state.globals_float[4] >> 0)
	{
	case 0: // broadcast
		return sv.state.server.datagram;
	case 1: // one
		var entnum = pr.state.globals_int[pr.globalvars.msg_entity];
		if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
			pr.runError('WriteDest: not a client');
		return sv.state.svs.clients[entnum - 1].message;
	case 2: // all
		return sv.state.server.reliable_datagram;
	case 3: // init
		return sv.state.server.signon;
	// MSG_EXT_MULTICAST / MSG_EXT_ENTITY (QSS server.h:298-299) name the same staging buffer: the
	// multicast builtin decides who gets it, the csqc entity writer splices what .SendEntity wrote.
	case 4: // multicast
	case 5: // entity
		return sv.state.server.multicast;
	}
	pr.runError('WriteDest: bad destination');
};

export const writeByte = function() {msg.writeByte(writeDest(), pr.state.globals_float[7]);};
export const writeChar = function() {msg.writeChar(writeDest(), pr.state.globals_float[7]);};
export const writeShort = function() {msg.writeShort(writeDest(), pr.state.globals_float[7]);};
export const writeLong = function() {msg.writeLong(writeDest(), pr.state.globals_float[7]);};
export const writeAngle = function() {msg.writeAngle(writeDest(), pr.state.globals_float[7], sv.state.server.protocolFlags);};
export const writeCoord = function() {msg.writeCoord(writeDest(), pr.state.globals_float[7], sv.state.server.protocolFlags);};
export const writeString = function() {msg.writeString(writeDest(), loc.getString(pr.getString(pr.state.globals_int[7])));};
export const writeEntity = function() {msg.writeShort(writeDest(), pr.state.globals_int[7]);};

// void(vector where, float set) multicast = #82 -- send whatever the QC staged in the
// multicast buffer to the clients the destination selects (QSS PF_multicast, pr_ext.c:4789).
export const multicast = function()
{
	const org = vec.scratch();
	org[0] = pr.state.globals_float[4];
	org[1] = pr.state.globals_float[5];
	org[2] = pr.state.globals_float[6];
	// requireext2 = 0, as QSS passes: an explicit QC multicast ignores negotiated extensions.
	sv.multicast(pr.state.globals_float[7] >> 0, org,
		pr.state.globals_int[pr.globalvars.msg_entity], 0);
};

// void(float num, float type, .__variant fld) clientstat = #232 -- network an entity field of
// the receiving client's own edict as stat `num` (QSS PF_clientstat, pr_ext.c:5024-5032).
export const clientstat = function()
{
	const stat = sv.registerCustomStat(pr.state.globals_float[4] >> 0, pr.state.globals_float[7] >> 0);
	if (stat == null)
		return;
	stat.fld = pr.state.globals_int[10];
};

// void(float num, float type, string name) globalstat = #233 -- the same, reading a named
// global instead, so every client gets the one value (QSS PF_globalstat, pr_ext.c:5034-5047).
export const globalstat = function()
{
	const type = pr.state.globals_float[7] >> 0;
	// PR_FindExtGlobal (pr_ext.c:8553): the global must exist AND already carry the claimed type -
	// a float global read as a string hands the stat writer a bogus string-heap offset.
	const def = ed.findGlobal(pr.getString(pr.state.globals_int[10]));
	if ((def == null) || ((def.type & 0x7fff) !== type))
		return;
	const stat = sv.registerCustomStat(pr.state.globals_float[4] >> 0, type);
	if (stat == null)
		return;
	stat.glob = def.ofs;
};

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
	msg.writeCoord(message, ent.v_float[pr.entvars.origin], sv.state.server.protocolFlags);
	msg.writeAngle(message, ent.v_float[pr.entvars.angles], sv.state.server.protocolFlags);
	msg.writeCoord(message, ent.v_float[pr.entvars.origin1], sv.state.server.protocolFlags);
	msg.writeAngle(message, ent.v_float[pr.entvars.angles1], sv.state.server.protocolFlags);
	msg.writeCoord(message, ent.v_float[pr.entvars.origin2], sv.state.server.protocolFlags);
	msg.writeAngle(message, ent.v_float[pr.entvars.angles2], sv.state.server.protocolFlags);

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

export const setspawnparms = function()
{
	var i = pr.state.globals_int[4];
	if ((i <= 0) || (i > sv.state.svs.maxclients))
		pr.runError('pf:setspawnparams: Entity is not a client');
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

// The table's gap filler, and every builtin registered by name but never written. Tagged as a stub
// so the load-time gap report can name it.
export const fixme = pr.markStub(function()
{

	con.dPrint('Unimplemented builtin')
	//await pr.runError('unimplemented builtin');
});


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

  // Copy all fields via the edicts' own views (not `new Uint8Array(.v)`): v_int/v_float carry
  // their byteOffset, so this is correct whether storage is standalone or shared with the WASM
  // sim's linear memory (which is one big buffer — a raw `.v` copy would span the whole memory).
  oute.v_int.set(ine.v_int);
}


// chained search for strings in entity fields
// entity(.string field, string match) findchain = #402;
const findchain = function ()
{
	let chain = 0
	const f = pr.state.globals_int[4]
  const s = pr.state.globals_int[7]

  // f = G_INT(OFS_PARM0);
	// s = G_STRING(OFS_PARM1);

	if (pr.state.strings[s] == null || pr.state.strings[s] === 0)
	{
    pr.state.globals_int[1] = 0
		return;
	}

	var i, ent;
	for (i = 1; i < pr.state.num_edicts; ++i)
	{
		ent = sv.state.server.edicts[i];

		if (ent.free === true)
			continue;
    if (!pr.compareStrings(ent.v_int[f], s))
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
	for (i = 1; i < pr.state.num_edicts; ++i)
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
	// float, not int: QC reads the token count as a float (QSS PF_tokenize, pr_ext.c:1498).
	// Through the int view it arrives as a denormal.
	pr.state.globals_float[RETURN] = pr.state.qctoken.length;
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
	pr.state.globals_float[1] = r   // OFS_RETURN is a float; was globals_int (truncated -> garbage)
}

const max = function ()  {
	let r = pr.state.globals_float[4]
	for (let i = 1; i < pr.state.argc; i++) {
		if (r < pr.state.globals_float[4 + i * 3])
			r = pr.state.globals_float[4 + i * 3]
	}
	pr.state.globals_float[1] = r
}
const bound = function () {
	let minval = pr.state.globals_float[4]
	let curval = pr.state.globals_float[7]
	let maxval = pr.state.globals_float[10]
	if (curval > maxval)
		curval = maxval;
	if (curval < minval)
		curval = minval;
	pr.state.globals_float[1] = curval
}

const pow = function ()
{
	pr.state.globals_float[1] = Math.pow(pr.state.globals_float[4], pr.state.globals_float[7])
}

const extensions = {
	'DP_SV_SETCOLOR': true,
	'KRIMZON_SV_PARSECLIENTCOMMAND': true,
	'FRIK_FILE': true,
	// DP_GFX_FOG deliberately NOT advertised (QSS-M doesn't either): AD's QC would
	// switch to DarkPlaces' 9-arg fog command syntax, which we don't implement.
	// Fog works through the QuakeSpasm path (worldspawn key + fog command + svc).
	'DP_QC_SPRINTF': true,
	'DP_SV_ROTATINGBMODEL': true,
	'FTE_STRINGS': true,
	'DP_QC_GETSURFACE': true,
	'DP_SV_POINTPARTICLES': true,
	'FTE_SV_POINTPARTICLES': true,
	'FTE_PART_NAMESPACE_EFFECTINFO': true,
	'DP_TE_PARTICLERAIN': true,
	'DP_TE_PARTICLESNOW': true,
	'FTE_ENT_SKIN_CONTENTS': true,
	// CSQC-era additions - QSS's own strings (qcextensions[], pr_ext.c:8209-8311), claimed only
	// where the feature really exists. One table serves both VMs, as in QSS.
	'EXT_CSQC': true,                   // client progs: csqc.ts lifecycle + the pfcl builtin tables
	'DP_CSQC_QUERYRENDERENTITY': true,  // #504 getentity over the engine's render-entity list
	'FTE_QC_MULTICAST': true,           // #82 multicast + the MULTICAST/EXT_ENTITY Write* dests
	'FTE_QC_INFOKEY': true,             // #80 infokey, incl. name/colours/ping/ip/team/csqcactive
	'DP_QC_MULTIPLETEMPSTRINGS': true,  // pr.tempString's rotating temp-string ring
	// FTE's own strings (qcextensions[], pr_bgcmd.c:8273-8513) at the line cited, claimed only
	// where every builtin FTE lists under them is implemented here for real.
	'DP_QC_STRINGBUFFERS': true,        // 8304: buf_create/del/getsize/copy/sort/implode + bufstr_*
	'DP_QC_TOKENIZEBYSEPARATOR': true,  // 8307: tokenizebyseparator
	'EXT_BITSHIFT': true,               // 8367: bitshift
	'FTE_QC_CROSSPRODUCT': true,        // 8459: crossproduct
	'FTE_QC_INTCONV': true,             // 8469: stoi, itos, stoh, htos, itof, ftoi - all six
	// 8303: strtolower/strtoupper
	'DP_QC_STRING_CASE_FUNCTIONS': true
	// NOT advertised, deliberately:
	//  FTE_MEMALLOC (8403) - our mem* arena is builtin-private, not the progs' addressable space.
	//  DP_QC_URI_GET (8316) - uri_get is a named refusal; see pf_fte.uri_get.
	//  FTE_QC_DIGEST_* (8461-8464) - every one names an SHA variant; digest_hex has MD4/CRC16.
	//  FTE_CSQC_SKELETONOBJECTS (8388) - bundles the skel_* family, which we do not implement.
}

// Extensions whose meaning the rerelease redefined — reported unsupported to rerelease progs.
// The subset of FTE's check_notrerelease predicate (pr_bgcmd.c:8223-8547) that we implement.
const notRerelease = new Set([
	'DP_EF_ADDITIVE', 'DP_EF_BLUE', 'DP_EF_NODRAW', 'DP_EF_RED',
	'DP_MOVETYPEBOUNCEMISSILE', 'DP_QC_GETLIGHT', 'DP_QC_RANDOMVEC', 'DP_QC_TRACEBOX',
	'DP_SV_ROTATINGBMODEL', 'FRIK_FILE', 'FTE_QC_INFOKEY', 'FTE_QC_MULTICAST', 'FTE_STRINGS',
	'QW_ENGINE', 'TOMAZ_STRINGS', 'ZQ_QC_STRINGS'
])

export const checkextension = function () {
	const extFind = pr.getString(pr.state.globals_int[PARM0]) as keyof (typeof extensions)
	const supported = extensions[extFind] === true && !(pr.state.rerelease && notRerelease.has(extFind))
	// OFS_RETURN is a float here (QSS G_FLOAT, pr_ext.c:8375); through the int view it reads back
	// as a denormal.
	pr.state.globals_float[RETURN] = supported ? 1 : 0
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
	// Tempstring, not a fresh string per call (QSS PF_strcat) - a per-frame HUD strcat would grow
	// the string heap forever. The offset goes out through the INT view.
	pr.tempString(out);
	pr.state.globals_int[RETURN] = pr.state.string_temp;
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
	pr.tempString(result);
	pr.state.globals_int[RETURN] = pr.state.string_temp;
}
// Components default 0, optional quake-vector quotes, stops at the first non-number
// (FTE PF_stov, pr_bgcmd.c:4740).
export const stov = () => {
	let s = pr.getString(pr.state.globals_int[PARM0])
	pr.state.globals_float[RETURN_V1] = 0
	pr.state.globals_float[RETURN_V2] = 0
	pr.state.globals_float[RETURN_V3] = 0
	if (s[0] === "'")
		s = s.substring(1)
	const parts = s.split("'")[0].trim().split(/\s+/)
	for (let i = 0; i < 3 && i < parts.length; ++i) {
		const f = parseFloat(parts[i])
		if (isNaN(f))
			break
		pr.state.globals_float[RETURN_V1 + i] = f
	}
}

const sprintf = function () {
	const templateStr = pr.getString(pr.state.globals_int[PARM0])
	let result: string
	// A bad format is a console complaint, not a fatal (FTE pr_bgcmd.c:7667). Delta from FTE: it
	// returns the partial build, we return the raw format - all the parse/format split allows.
	try {
		result = sprintf_format(sprintf_parse(templateStr))
	} catch (e: any) {
		con.print('PF_sprintf: invalid format string: ' + templateStr + '\n')
		result = templateStr
	}
	pr.tempString(result);
	pr.state.globals_int[RETURN] = pr.state.string_temp;
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

// string(string name) cvar_string = #103/#448 (DP_QC_CVAR_STRING; FTE binds #448): the cvar's
// value as a tempstring, "" when it doesn't exist (FTE PF_cvar_string).
const cvar_string_qc = () => {
	const cv = cvar.findVar(pr.getString(pr.state.globals_int[PARM0]))
	pr.tempString(cv != null ? cv.string : '')
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// float(string name, string value) registercvar = #93 (FTE/DP PF_register_cvar): gamecode-owned
// cvar; returns false (and keeps the engine's value) when the name already exists.
const registercvar_qc = () => {
	const name = pr.getString(pr.state.globals_int[PARM0])
	const value = pr.getString(pr.state.globals_int[PARM1])
	if ((name.length === 0) || (cvar.findVar(name) != null)) {
		pr.state.globals_float[RETURN] = 0
		return
	}
	cvar.registerVariable(name, value)
	pr.state.globals_float[RETURN] = 1
}

// File Handling - kind of a hack
export const fopen = () => {

	const name = pr.getString(pr.state.globals_int[4])
	const mode = pr.state.globals_float[7] as FileMode
	const files = Object.keys(pr.state.openfiles)
	let fileHandle = 0

	pr.state.globals_float[1] = -1
	let file: string | ArrayBuffer = null
	const fname = fixFileName(name)

	if (!fname)
	{
		con.print(`fopen: Access denied: "${name}" from ${pr.state.xfunction ? pr.getString(pr.state.xfunction.name) : '?'}\n`);
		return;
	}
	switch (mode) {
		case FileMode.READ:
		case FileMode.READNL:	// same open, fgets is what differs
			file = com.loadFileSync(fname)
			if (!file) {
				// can only *read* files that are not in data
				file = com.loadFileSync(name)
			}
			break
		case FileMode.APPEND:
		case FileMode.WRITE:
			// Relative name, not `<gamedir>/<name>`: the store already writes into the current
			// gamedir, so a prefix lands at `<gamedir>/<gamedir>/...` where no read can find it.
			com.state.assetStore.openFile(fname, mode)
			file = fname
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

export const fclose = () => {
	// float handle, as fopen returned and fgets/fputs read it (FRIK_FILE `void(float fhandle)`).
	const fileHandle = pr.state.globals_float[PARM0]
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

export const fgets = () => {
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
	if ((handle.mode !== FileMode.READ) && (handle.mode !== FileMode.READNL)) {
		con.dPrint("fgets: file not open for reading\n");
		return
	}

	if (!handle.content) {
		let content = ''
		if (typeof handle.file !== 'string') {
			content = bytesToString(new Uint8Array(handle.file));
		} else {
			const raw = com.loadFileSync(handle.file)
			content = raw ? bytesToString(new Uint8Array(raw as ArrayBuffer)) : ''
		}
		// FILE_READNL: newlines are not special, the whole file comes back in one fgets
		// (FTE pr_bgcmd.c:3023).
		handle.content = (handle.mode === FileMode.READNL) ? [content] : content.split(/\r?\n/)
	}
	handle.position++;
	if (handle.position >= handle.content.length) {
		return
	} else {
		pr.tempString(handle.content[handle.position]);
		pr.state.globals_int[RETURN] = pr.state.string_temp;
	}
}

export const fputs = () => {
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
	// Only FILE_WRITE/FILE_APPEND can take a write (FTE PF_fputs).
	if ((handle.mode !== FileMode.WRITE) && (handle.mode !== FileMode.APPEND)) {
		con.dPrint("fputs: file not open for writing\n");
		return
	}
	fwriteInternal(pr.state.globals_float[4] >> 0, varString(1))
}

// Text onto an open write handle, false when the handle can't take it (FTE PF_fwrite_internal).
// Accumulates on the handle and rewrites the whole file: the store has no append.
export const fwriteInternal = function (fileHandle: number, text: string): boolean {
	const handle = pr.state.openfiles[fileHandle]
	if (!handle || !handle.file)
		return false
	if ((handle.mode !== FileMode.WRITE) && (handle.mode !== FileMode.APPEND))
		return false
	handle.content = (handle.content ?? []).concat(text)
	com.state.assetStore.writeTextFile(handle.file as string, handle.content.join(''))
	return true
}

// A QC-named file's whole text, or null - fopen's FILE_READ lookup (data/ policy first, then the
// raw name) without the handle bookkeeping.
export const readQCFileText = function (name: string): string | null {
	const fname = fixFileName(name)
	if (fname == null) {
		con.print(`buf_loadfile: Access denied: "${name}"\n`)
		return null
	}
	const raw = com.loadFileSync(fname) ?? com.loadFileSync(name)
	if (raw == null)
		return null
	if (typeof raw === 'string')
		return raw
	return bytesToString(new Uint8Array(raw))
}

// Chunked: fromCharCode.apply over a whole file blows V8's ~100k argument limit.
const bytesToString = function (bytes: Uint8Array): string {
	let out = ''
	for (let i = 0; i < bytes.length; i += 8192)
		out += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[])
	return out
}

// float(string fname) fexists = #653 (FTE PF_fexists). Same lookup as fopen's FILE_READ, so a mod
// can test exactly what it could open.
export const fexists = () => {
	const name = pr.getString(pr.state.globals_int[PARM0])
	const fname = fixFileName(name)
	pr.state.globals_float[RETURN] =
		((fname != null) && (com.loadFileSync(fname) != null)) || (com.loadFileSync(name) != null) ? 1 : 0
}

// string(string file) whichpack = #503 (DP_QC_WHICHPACK; FTE PF_whichpack, pr_bgcmd.c:3464): the
// pack serving the file ("dir/pakN.pak"), "" when it is loose, the null string when not found.
// Packs walk newest-first, as COM file lookup does.
export const whichpack = () => {
	const name = pr.getString(pr.state.globals_int[PARM0]).toLowerCase()
	for (let i = com.state.searchpaths.length - 1; i >= 0; --i) {
		const sp = com.state.searchpaths[i]
		for (let j = sp.packs.length - 1; j >= 0; --j) {
			const pak = sp.packs[j]
			for (let k = 0; k < pak.contents.length; ++k) {
				if (pak.contents[k].name.toLowerCase() === name) {
					pr.tempString(sp.dir + '/' + pak.name)
					pr.state.globals_int[RETURN] = pr.state.string_temp
					return
				}
			}
		}
	}
	if (com.loadFileSync(name) != null) {
		pr.tempString('')
		pr.state.globals_int[RETURN] = pr.state.string_temp
	}
	else
		pr.state.globals_int[RETURN] = 0
}

// DP_QC_FS_SEARCH (FTE pr_searches, pr_bgcmd.c:3603-3690). Delta from FTE: only searchpath packs
// are enumerated - the asset store has no synchronous listing of loose files. Handles live on
// pr.state.searches, per-VM and freed with the progs like openfiles.
export const search_begin = () => {
	const pattern = pr.getString(pr.state.globals_int[PARM0])
	// FTE's bad-pattern set: empty, parent-relative, absolute, or drive-qualified.
	if (pattern === '' || pattern.startsWith('..') || pattern[0] === '/' || pattern[0] === '\\' || pattern.indexOf(':') >= 0) {
		con.print('PF_search_begin: bad search pattern "' + pattern + '"\n')
		pr.state.globals_float[RETURN] = -1
		return
	}
	// glob -> regex: * spans path separators too (FTE wildcmp), ? matches one character
	const rx = new RegExp('^' + pattern.toLowerCase().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
	const names: string[] = []
	const seen: Record<string, boolean> = {}
	for (let i = com.state.searchpaths.length - 1; i >= 0; --i) {
		const sp = com.state.searchpaths[i]
		for (let j = sp.packs.length - 1; j >= 0; --j) {
			const contents = sp.packs[j].contents
			for (let k = 0; k < contents.length; ++k) {
				const n = contents[k].name.toLowerCase()
				if (seen[n] !== true && rx.test(n)) {
					seen[n] = true
					names.push(n)
				}
			}
		}
	}
	let handle = pr.state.searches.indexOf(null)
	if (handle < 0)
		handle = pr.state.searches.length
	pr.state.searches[handle] = names
	pr.state.globals_float[RETURN] = handle
}

export const search_end = () => {
	const handle = pr.state.globals_float[PARM0] >> 0
	if (pr.state.searches[handle] != null)
		pr.state.searches[handle] = null
}

export const search_getsize = () => {
	const handle = pr.state.globals_float[PARM0] >> 0
	const s = pr.state.searches[handle]
	if (s == null) {
		con.print('PF_search_getsize: invalid search handle ' + handle + '\n')
		pr.state.globals_float[RETURN] = 0
		return
	}
	pr.state.globals_float[RETURN] = s.length
}

export const search_getfilename = () => {
	const handle = pr.state.globals_float[PARM0] >> 0
	const idx = pr.state.globals_float[PARM1] >> 0
	const s = pr.state.searches[handle]
	pr.state.globals_int[RETURN] = 0
	if (s == null) {
		con.print('PF_search_getfilename: invalid search handle ' + handle + '\n')
		return
	}
	if (idx < 0 || idx >= s.length)
		return
	pr.tempString(s[idx])
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// float(string fname) fremove = #652 (FTE PF_fremove): deletes a file under the writable data/
// subdir, 0 on success. The store's delete is async and QC is not, so success is assumed and a
// failure only surfaces on the next fexists.
export const fremove = () => {
	const fname = fixFileName(pr.getString(pr.state.globals_int[PARM0]))
	if (fname == null) {
		pr.state.globals_float[RETURN] = -1
		return
	}
	com.state.assetStore.deleteFile(fname)
	pr.state.globals_float[RETURN] = 0
}

// float(string src, string dst) frename = #651 (FTE PF_frename), 0 on success. The store has no
// rename, so this is a copy-then-delete through writeTextFile: text only, which is all fputs
// can have written.
export const frename = () => {
	const src = fixFileName(pr.getString(pr.state.globals_int[PARM0]))
	const dst = fixFileName(pr.getString(pr.state.globals_int[PARM1]))
	const raw = (src != null) ? com.loadFileSync(src) : null
	if ((src == null) || (dst == null) || (raw == null)) {
		pr.state.globals_float[RETURN] = -1
		return
	}
	com.state.assetStore.writeTextFile(dst, bytesToString(new Uint8Array(raw)))
	com.state.assetStore.deleteFile(src)
	pr.state.globals_float[RETURN] = 0
}

// void(entity killer, entity killee) logfrag = #79 (QW/FTE PF_logfrag). Delta from FTE: no fraglog
// file exists here, so the event is only traced.
export const logfrag = () => {
	con.dPrint('logfrag: ' + pr.state.globals_int[PARM0] + ' killed ' + pr.state.globals_int[PARM1] + '\n')
}

export const infokey = () => {
	const ent = sv.state.server.edicts[pr.state.globals_int[4]];
	const key = pr.getString(pr.state.globals_int[PARM1])
	let r: null | string = null
	// infokey(world, key) queries the SERVERINFO, not a client (FTE PF_infokey).
	if (!ent || ent.num === 0) {
		if (key === '*version') {
			r = `WebQuake ${def.webquake_version}`
		} else {
			con.dPrint(`infokey: unsupported serverinfo key ${key}`)
		}
	} else if (ent.num >= 1 && ent.num <= sv.state.svs.maxclients && sv.state.svs.clients[ent.num - 1].active) {
		
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
			case "team":
				// NQ has no teams, so QW's team key is the bottom colour (QSS pr_ext.c:4656).
				r = 't' + ((cl.colors & 15) + 1).toFixed(0)
				break;
			case "csqcactive":
			case "*csqcactive":
				// QSS spells the key without the star (pr_ext.c:4662); FTE answers to both
				// (pr_cmds.c:6435).
				r = cl.csqcactive ? "1" : "0"
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
export const strpad = function() {
	const pad = pr.state.globals_float[PARM0]
	const str = varString(1)
	let r = ''
	if (pad < 0) {
		r = str.padStart(Math.abs(pad), ' ')
	} else {
		r = str.padEnd(pad, ' ')
	}
	
	pr.tempString(r);
	pr.state.globals_int[RETURN] = pr.state.string_temp;
}

// DP_QC_GETSURFACE family. Ported from QSS-M pr_ext.c PF_getsurface*.
// Resolves an entity's precached brush model (mod.TYPE.brush) via its modelindex,
// same lookup sv.ts uses for MOVETYPE_PUSH SOLID_BSP (see hullForEntity).
const getBrushModel = function(ent: Edict): Model | null {
	const model = sv.state.server.models[ent.v_float[pr.entvars.modelindex] >> 0]
	if (model == null || model.type !== mod.TYPE.brush)
		return null
	return model
}

// mod.ts only copies faces/texinfo/textures onto '*N' submodel proxies
// (loadSubmodels), not edges/surfedges/vertexes — those stay on the owning
// worldmodel and are shared by all its submodels (matches QSS-M's `*loadmodel = *mod`
// full struct copy, where those pointers end up identical across submodels).
const brushGeometry = function(model: Model): Model {
	return model.edges != null ? model : sv.state.server.worldmodel
}

const getSurfaceVertex = function(model: Model, face: Face, vert: number): V3 {
	const geo = brushGeometry(model)
	return mod.surfedgeVertexInto(geo, geo.surfedges[vert + face.firstedge], [0, 0, 0]);
}

// Clips `point` onto face's plane then each boundary edge, pushing it back inside
// the polygon. Mirrors QSS-M's getsurface_clippointpoly (pr_ext.c). Writes the
// clipped point into `out` and returns the (possibly updated) best squared distance;
// leaves `out`/bestDistSq untouched when this face isn't an improvement.
const clipPointToPoly = function(model: Model, face: Face, point: V3, out: V3, bestDistSq: number): number {
	const plane = face.plane
	const planeDist = point[0] * plane.normal[0] + point[1] * plane.normal[1] + point[2] * plane.normal[2] - plane.dist
	if (planeDist * planeDist >= bestDistSq)
		return bestDistSq
	const geo = brushGeometry(model)
	const cx0 = point[0] + planeDist * plane.normal[0], cy0 = point[1] + planeDist * plane.normal[1], cz0 = point[2] + planeDist * plane.normal[2]
	let cx = cx0, cy = cy0, cz = cz0
	for (let e = face.firstedge + face.numedges - 1; e >= face.firstedge; --e) {
		const edge = geo.surfedges[e]
		const v1: V3 = [0, 0, 0], v2: V3 = [0, 0, 0]
		if (edge < 0) {
			mod.edgeVertexInto(geo, -edge, 0, v1);
			mod.edgeVertexInto(geo, -edge, 1, v2);
		} else {
			mod.edgeVertexInto(geo, edge, 0, v2);
			mod.edgeVertexInto(geo, edge, 1, v1);
		}
		const ex = v1[0] - v2[0], ey = v1[1] - v2[1], ez = v1[2] - v2[2]
		let nx = ey * plane.normal[2] - ez * plane.normal[1]
		let ny = ez * plane.normal[0] - ex * plane.normal[2]
		let nz = ex * plane.normal[1] - ey * plane.normal[0]
		if (!(face.flags & def.SURF.planeback)) { nx = -nx; ny = -ny; nz = -nz; }
		const nlen = Math.sqrt(nx * nx + ny * ny + nz * nz)
		if (nlen > 0) { nx /= nlen; ny /= nlen; nz /= nlen; }
		const d = (v1[0] * nx + v1[1] * ny + v1[2] * nz) - (cx * nx + cy * ny + cz * nz)
		if (d < 0) { cx += d * nx; cy += d * ny; cz += d * nz; }
	}
	const dx = cx - point[0], dy = cy - point[1], dz = cz - point[2]
	const distSq = dx * dx + dy * dy + dz * dz
	if (distSq < bestDistSq) {
		out[0] = cx; out[1] = cy; out[2] = cz;
		return distSq
	}
	return bestDistSq
}

// float(entity e, float s) getsurfacenumpoints = #434
const getsurfacenumpoints = function() {
	const ent = sv.state.server.edicts[pr.state.globals_int[PARM0]]
	const surfidx = (pr.state.globals_float[PARM1] | 0) >>> 0
	const model = getBrushModel(ent)
	pr.state.globals_float[RETURN] = (model && surfidx < model.numfaces) ? model.faces[model.firstface + surfidx].numedges : 0
}

// vector(entity e, float s, float n) getsurfacepoint = #435
const getsurfacepoint = function() {
	const ent = sv.state.server.edicts[pr.state.globals_int[PARM0]]
	const surfidx = (pr.state.globals_float[PARM1] | 0) >>> 0
	const point = (pr.state.globals_float[PARM2] | 0) >>> 0
	const model = getBrushModel(ent)
	const face = (model && surfidx < model.numfaces) ? model.faces[model.firstface + surfidx] : null
	if (face && point < face.numedges) {
		const v = getSurfaceVertex(model, face, point)
		pr.state.globals_float[RETURN_V1] = v[0]
		pr.state.globals_float[RETURN_V2] = v[1]
		pr.state.globals_float[RETURN_V3] = v[2]
	} else {
		pr.state.globals_float[RETURN_V1] = 0
		pr.state.globals_float[RETURN_V2] = 0
		pr.state.globals_float[RETURN_V3] = 0
	}
}

// vector(entity e, float s) getsurfacenormal = #436
const getsurfacenormal = function() {
	const ent = sv.state.server.edicts[pr.state.globals_int[PARM0]]
	const surfidx = (pr.state.globals_float[PARM1] | 0) >>> 0
	const model = getBrushModel(ent)
	if (model && surfidx < model.numfaces) {
		const face = model.faces[model.firstface + surfidx]
		const back = (face.flags & def.SURF.planeback) !== 0
		pr.state.globals_float[RETURN_V1] = back ? -face.plane.normal[0] : face.plane.normal[0]
		pr.state.globals_float[RETURN_V2] = back ? -face.plane.normal[1] : face.plane.normal[1]
		pr.state.globals_float[RETURN_V3] = back ? -face.plane.normal[2] : face.plane.normal[2]
	} else {
		// matches PF_getsurfacenormal: only the x component is cleared on failure
		pr.state.globals_float[RETURN] = 0
	}
}

// string(entity e, float s) getsurfacetexture = #437
export const getsurfacetexture = function() {
	const ent = sv.state.server.edicts[pr.state.globals_int[PARM0]]
	const surfidx = (pr.state.globals_float[PARM1] | 0) >>> 0
	const model = getBrushModel(ent)
	if (model && surfidx < model.numfaces) {
		const face = model.faces[model.firstface + surfidx]
		pr.tempString(model.textures[face.texture].name)
		pr.state.globals_int[RETURN] = pr.state.string_temp
	} else {
		pr.state.globals_int[RETURN] = 0
	}
}

// float(entity e, vector p) getsurfacenearpoint = #438
export const getsurfacenearpoint = function() {
	const ent = sv.state.server.edicts[pr.state.globals_int[PARM0]]
	const point: V3 = [pr.state.globals_float[PARM1], pr.state.globals_float[PARM1 + 1], pr.state.globals_float[PARM1 + 2]]
	pr.state.globals_float[RETURN] = -1
	const model = getBrushModel(ent)
	if (!model)
		return
	let bestDistSq = 256
	let bestSurf = -1
	const cpoint: V3 = [0, 0, 0]
	for (let i = 0; i < model.numfaces; ++i) {
		const d = clipPointToPoly(model, model.faces[model.firstface + i], point, cpoint, bestDistSq)
		if (d < bestDistSq) {
			bestDistSq = d
			bestSurf = i
		}
	}
	pr.state.globals_float[RETURN] = bestSurf
}

// vector(entity e, float s, vector p) getsurfaceclippedpoint = #439
const getsurfaceclippedpoint = function() {
	const ent = sv.state.server.edicts[pr.state.globals_int[PARM0]]
	const surfnum = pr.state.globals_float[PARM1] | 0
	const point: V3 = [pr.state.globals_float[PARM2], pr.state.globals_float[PARM2 + 1], pr.state.globals_float[PARM2 + 2]]
	pr.state.globals_float[RETURN_V1] = point[0]
	pr.state.globals_float[RETURN_V2] = point[1]
	pr.state.globals_float[RETURN_V3] = point[2]
	const model = getBrushModel(ent)
	// QSS-M's bounds check only rejects surfnum >= nummodelsurfaces, not negative
	// (an OOB C array read); we additionally reject negative to avoid an
	// out-of-bounds JS array access instead of replicating that bug.
	if (!model || surfnum < 0 || surfnum >= model.numfaces)
		return
	const out: V3 = [point[0], point[1], point[2]]
	clipPointToPoly(model, model.faces[model.firstface + surfnum], point, out, 0x7fffffff)
	pr.state.globals_float[RETURN_V1] = out[0]
	pr.state.globals_float[RETURN_V2] = out[1]
	pr.state.globals_float[RETURN_V3] = out[2]
}

// DP_SV_POINTPARTICLES / FTE_SV_POINTPARTICLES / FTE_PART_NAMESPACE_EFFECTINFO (pscript.ts is
// Phase A/B; this is Phase C's server-side precache + wire writers, ported from QSS-M pr_ext.c
// PF_sv_particleeffectnum/PF_sv_trailparticles/PF_sv_pointparticles ~5100-5220). QSS-M gates
// transport on a PEXT2 capability bit we don't implement; since our server always negotiates
// RMQ/FitzQuake (never plain protocol 15, see sv.ts SpawnServer), these are unconditional --
// the same precedent as spawnstatic2/spawnbaseline2 above.
const MAX_PARTICLE_PRECACHE = 2048 // matches QSS-M's MAX_PARTICLETYPES

// float(string effectname) particleeffectnum = #335
export const particleeffectnum = function() {
	const s = pr.getString(pr.state.globals_int[PARM0])
	pr.state.globals_float[RETURN] = 0
	if (!s)
		return

	const precache = sv.state.server.particle_precache
	let i = 1
	for (; i < precache.length; ++i) {
		if (precache[i] === s) {
			if (sv.state.server.phase !== 'loading' && sv.state.server.particlePrecacheWarnCount++ < 3)
				con.dPrint(`PF_sv_particleeffectnum(${s}): Precache should only be done in spawn functions\n`)
			pr.state.globals_float[RETURN] = i
			return
		}
	}
	if (i >= MAX_PARTICLE_PRECACHE)
		pr.runError('PF_sv_particleeffectnum: overflow')

	if (sv.state.server.phase !== 'loading') {
		if (sv.state.server.particlePrecacheWarnCount++ < 3)
			con.dPrint(`PF_sv_particleeffectnum(${s}): Precache should only be done in spawn functions\n`)
		// Registering after load: QSS-M's MULTICAST_ALL_R equivalent -- broadcast the new
		// index/name to every already-connected client's reliable stream. Late joiners get
		// the whole table anyway via sendServerinfo's dp_precache dump.
		msg.writeByte(sv.state.server.reliable_datagram, protocol.SVC.dp_precache)
		msg.writeShort(sv.state.server.reliable_datagram, (protocol.PRECACHE_TYPE.particle << 14) | i)
		msg.writeString(sv.state.server.reliable_datagram, s)
	}
	precache[i] = s
	pr.state.globals_float[RETURN] = i
}

// DP_TE_PARTICLERAIN/SNOW (pr_ext.c PF_sv_te_particlerain ~3150): svc_temp_entity +
// TE 55/56, box min/max + dir coords, short count, byte colour, unreliable broadcast.
// void(vector mincorner, vector maxcorner, vector vel, float howmany, float color)
const writeTEWeather = (te: number) => {
	let count = pr.state.globals_float[PARM3]
	if (count < 1)
		return
	if (count > 65535) count = 65535
	const flags = sv.state.server.protocolFlags
	const datagram = sv.state.server.datagram
	msg.writeByte(datagram, protocol.SVC.temp_entity)
	msg.writeByte(datagram, te)
	for (let p = PARM0; p <= PARM2; p += 3) {
		msg.writeCoord(datagram, pr.state.globals_float[p], flags)
		msg.writeCoord(datagram, pr.state.globals_float[p + 1], flags)
		msg.writeCoord(datagram, pr.state.globals_float[p + 2], flags)
	}
	msg.writeShort(datagram, count)
	msg.writeByte(datagram, pr.state.globals_float[PARM4])
}
export const te_particlerain = () => writeTEWeather(protocol.TE.dp_particlerain)
export const te_particlesnow = () => writeTEWeather(protocol.TE.dp_particlesnow)

// void(float effectnum, entity ent, vector start, vector end) trailparticles = #336
// QSS-M also tolerates a (ent, effectnum, ...) swapped call order some DP mods use, detected
// via a raw-pointer-range heuristic specific to their C entity representation; our entities
// are plain small array indices so that heuristic doesn't carry over, and AD/FTE-dialect QC
// calls the documented order below, so only that order is implemented.
export const trailparticles = function() {
	const efnum = pr.state.globals_float[PARM0]
	if (efnum <= 0)
		return
	const ent = sv.state.server.edicts[pr.state.globals_int[PARM1]]
	const flags = sv.state.server.protocolFlags
	const datagram = sv.state.server.datagram
	const START = PARM2, END = PARM2 + 3
	msg.writeByte(datagram, protocol.SVC.dp_trailparticles)
	msg.writeShort(datagram, ent ? ent.num : 0)
	msg.writeShort(datagram, efnum)
	msg.writeCoord(datagram, pr.state.globals_float[START], flags)
	msg.writeCoord(datagram, pr.state.globals_float[START + 1], flags)
	msg.writeCoord(datagram, pr.state.globals_float[START + 2], flags)
	msg.writeCoord(datagram, pr.state.globals_float[END], flags)
	msg.writeCoord(datagram, pr.state.globals_float[END + 1], flags)
	msg.writeCoord(datagram, pr.state.globals_float[END + 2], flags)
}

// void(float effectnum, vector origin, optional vector dir, optional float count) pointparticles = #337
export const pointparticles = function() {
	const efnum = pr.state.globals_float[PARM0]
	if (efnum <= 0)
		return
	let count = pr.state.argc < 4 ? 1 : pr.state.globals_float[PARM2 + 3]
	if (count > 65535) count = 65535
	if (count < 1)
		return

	const flags = sv.state.server.protocolFlags
	const ox = pr.state.globals_float[PARM1], oy = pr.state.globals_float[PARM1 + 1], oz = pr.state.globals_float[PARM1 + 2]
	const vx = pr.state.argc < 3 ? 0 : pr.state.globals_float[PARM2]
	const vy = pr.state.argc < 3 ? 0 : pr.state.globals_float[PARM2 + 1]
	const vz = pr.state.argc < 3 ? 0 : pr.state.globals_float[PARM2 + 2]

	const datagram = sv.state.server.datagram
	if (count === 1 && vx === 0 && vy === 0 && vz === 0) {
		msg.writeByte(datagram, protocol.SVC.dp_pointparticles1)
		msg.writeShort(datagram, efnum)
		msg.writeCoord(datagram, ox, flags)
		msg.writeCoord(datagram, oy, flags)
		msg.writeCoord(datagram, oz, flags)
	} else {
		msg.writeByte(datagram, protocol.SVC.dp_pointparticles)
		msg.writeShort(datagram, efnum)
		msg.writeCoord(datagram, ox, flags)
		msg.writeCoord(datagram, oy, flags)
		msg.writeCoord(datagram, oz, flags)
		msg.writeCoord(datagram, vx, flags)
		msg.writeCoord(datagram, vy, flags)
		msg.writeCoord(datagram, vz, flags)
		msg.writeShort(datagram, count)
	}
}

export type Builtin = pr.Builtin

// The base server builtin table: immutable, copied into each VM by pr.loadProgs.
export const builtin: Builtin[] = [
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

// 2021 rerelease (Kex) QC compat - pr_ext.c ~8562-8674. Rerelease QCC declares these as
// "= #0;" (auto-numbered/immediate builtins) rather than a fixed number; pr.loadProgs binds
// them by name only when rerelease progs are detected (see pr.ts state.rerelease). Semantics
// match QSS-M's PF_ex_* exactly, including the stub return values.
const ex_finaleFinished = function()
{
	pr.state.globals_float[RETURN] = 0;
};

const ex_bprint = function()
{
	host.broadcastPrint(varStringQex(0));
};

const ex_sprint = function()
{
	var entnum = pr.state.globals_int[PARM0];
	if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
	{
		con.print('tried to sprint to a non-client\n');
		return;
	}
	var client = sv.state.svs.clients[entnum - 1];
	msg.writeByte(client.message, protocol.SVC.print);
	msg.writeString(client.message, varStringQex(1));
};

const ex_centerprint = function()
{
	var entnum = pr.state.globals_int[PARM0];
	if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
	{
		con.print('tried to sprint to a non-client\n');
		return;
	}
	var client = sv.state.svs.clients[entnum - 1];
	msg.writeByte(client.message, protocol.SVC.centerprint);
	msg.writeString(client.message, varStringQex(1));
};

// Stubs - QSS-M ships these undocumented/unimplemented; return failure exactly as it does
// rather than inventing pathfinding/bot behavior.
const ex_CheckPlayerEXFlags = function()
{
	pr.state.globals_float[RETURN] = 0;
};

const ex_walkpathtogoal = function()
{
	pr.state.globals_float[RETURN] = 0; // PATH_ERROR - pretend there are no waypoints
};

const ex_bot_movetopoint = function()
{
	pr.state.globals_float[RETURN] = 0; // BOT_GOAL_ERROR - pretend there are no waypoints
};

const ex_bot_followentity = function()
{
	pr.state.globals_float[RETURN] = 0; // BOT_GOAL_ERROR - pretend there are no waypoints
};

// void(entity client, string sample) - plays a sound to one client at full volume with no
// attenuation/spatialization (sv_main.c SV_LocalSound): a targeted svc_sound write straight
// into that client's own reliable buffer, atten byte forced to 0, entity/channel 0.
const ex_localsound = function()
{
	var entnum = pr.state.globals_int[PARM0];
	var sample = pr.getString(pr.state.globals_int[PARM1]);
	if ((entnum <= 0) || (entnum > sv.state.svs.maxclients))
	{
		con.print('tried to localsound to a non-client\n');
		return;
	}
	var client = sv.state.svs.clients[entnum - 1];
	var i;
	for (i = 1; i < sv.state.server.sound_precache.length; ++i)
	{
		if (sample === sv.state.server.sound_precache[i])
			break;
	}
	if (i >= sv.state.server.sound_precache.length)
	{
		con.print('SV_LocalSound: ' + sample + ' not precached\n');
		return;
	}

	var field_mask = 2; // attenuation byte present (forced to 0 below); no volume byte -> full volume
	if (i >= 256)
	{
		if (sv.state.server.protocol === protocol.VERSION.netquake)
			return; // sound index doesn't fit in the packet, drop it
		field_mask |= protocol.SND.largesound;
	}

	msg.writeByte(client.message, protocol.SVC.sound);
	msg.writeByte(client.message, field_mask);
	msg.writeByte(client.message, 0); // attenuation 0 = full volume regardless of distance
	msg.writeShort(client.message, 0); // entity 0, channel 0
	if ((field_mask & protocol.SND.largesound) !== 0)
		msg.writeShort(client.message, i);
	else
		msg.writeByte(client.message, i);

	var e = client.edict;
	msg.writeCoord(client.message, e.v_float[pr.entvars.origin] + 0.5 *
		(e.v_float[pr.entvars.mins] + e.v_float[pr.entvars.maxs]), sv.state.server.protocolFlags);
	msg.writeCoord(client.message, e.v_float[pr.entvars.origin1] + 0.5 *
		(e.v_float[pr.entvars.mins1] + e.v_float[pr.entvars.maxs1]), sv.state.server.protocolFlags);
	msg.writeCoord(client.message, e.v_float[pr.entvars.origin2] + 0.5 *
		(e.v_float[pr.entvars.mins2] + e.v_float[pr.entvars.maxs2]), sv.state.server.protocolFlags);
};

// Extension builtin table: name + classic number, resolved into each VM's table per load.
export const ebfs_builtins: pr.ExtBuiltin[] = [
	{ defaultFnNbr: 0, name: null, fn: fixme },				// has to be first entry as it is needed for initialization in PR_LoadProgs()
	{ defaultFnNbr: 1, name: "makevectors", fn: makevectors },	// void(entity e)	makevectors 		= #1;
	{ defaultFnNbr: 2, name: "setorigin", fn: setorigin },		// void(entity e, vector o) setorigin	= #2;
	{ defaultFnNbr: 3, name: "setmodel", fn: setmodel },		// void(entity e, string m) setmodel	= #3;
	{ defaultFnNbr: 4, name: "setsize", fn: setsize },			// void(entity e, vector min, vector max) setsize = #4;
	//	{ defaultFnNbr: 5, name: "fixme", fn: Fixme },				// void(entity e, vector min, vector max) setabssize = #5;
	{ defaultFnNbr: 6, name: "break", fn: breakstatement },				// void() break						= #6;
	{ defaultFnNbr: 7, name: "random", fn: random },			// float() random						= #7;
	{ defaultFnNbr: 8, name: "sound", fn: sound },				// void(entity e, float chan, string samp) sound = #8;
	{ defaultFnNbr: 9, name: "normalize", fn: normalize },		// vector(vector v) normalize			= #9;
	{ defaultFnNbr: 10, name: "error", fn: error },				// void(string e) error				= #10;
	{ defaultFnNbr: 11, name: "objerror", fn: objerror },		// void(string e) objerror				= #11;
	{ defaultFnNbr: 12, name: "vlen", fn: vlen },				// float(vector v) vlen				= #12;
	{ defaultFnNbr: 13, name: "vectoyaw", fn: vectoyaw },		// float(vector v) vectoyaw		= #13;
	{ defaultFnNbr: 14, name: "spawn", fn: spawn },				// entity() spawn						= #14;
	{ defaultFnNbr: 15, name: "remove", fn: remove },			// void(entity e) remove				= #15;
	{ defaultFnNbr: 16, name: "traceline", fn: traceline },		// float(vector v1, vector v2, float tryents) traceline = #16;
	{ defaultFnNbr: 17, name: "checkclient", fn: checkclient },	// entity() clientlist					= #17;
	{ defaultFnNbr: 18, name: "find", fn: find },				// entity(entity start, .string fld, string match) find = #18;
	{ defaultFnNbr: 19, name: "precache_sound", fn: precache_sound },	// void(string s) precache_sound		= #19;
	{ defaultFnNbr: 20, name: "precache_model", fn: precache_model },	// void(string s) precache_model		= #20;
	{ defaultFnNbr: 21, name: "stuffcmd", fn: stuffcmd },		// void(entity client, string s)stuffcmd = #21;
	{ defaultFnNbr: 22, name: "findradius", fn: findradius },	// entity(vector org, float rad) findradius = #22;
	{ defaultFnNbr: 23, name: "bprint", fn: bprint },			// void(string s) bprint				= #23;
	{ defaultFnNbr: 24, name: "sprint", fn: sprint },			// void(entity client, string s) sprint = #24;
	{ defaultFnNbr: 25, name: "dprint", fn: dprint },			// void(string s) dprint				= #25;
	{ defaultFnNbr: 26, name: "ftos", fn: ftos },				// void(string s) ftos				= #26;
	{ defaultFnNbr: 27, name: "vtos", fn: vtos },				// void(string s) vtos				= #27;
	{ defaultFnNbr: 28, name: "coredump", fn: coredump },
	{ defaultFnNbr: 29, name: "traceon", fn: traceon },
	{ defaultFnNbr: 30, name: "traceoff", fn: traceoff },
	{ defaultFnNbr: 31, name: "eprint", fn: eprint },			// void(entity e) debug print an entire entity
	{ defaultFnNbr: 32, name: "walkmove", fn: walkmove },		// float(float yaw, float dist) walkmove
	//	{ defaultFnNbr: 33, name: "fixme", fn: Fixme },				// float(float yaw, float dist) walkmove
	{ defaultFnNbr: 34, name: "droptofloor", fn: droptofloor },
	{ defaultFnNbr: 35, name: "lightstyle", fn: lightstyle },
	{ defaultFnNbr: 36, name: "rint", fn: rint },
	{ defaultFnNbr: 37, name: "floor", fn: floor },
	{ defaultFnNbr: 38, name: "ceil", fn: ceil },
	//	{ defaultFnNbr: 39, name: "fixme", fn: Fixme },
	{ defaultFnNbr: 40, name: "checkbottom", fn: checkbottom },
	{ defaultFnNbr: 41, name: "pointcontents", fn: pointcontents },
	//	{ defaultFnNbr: 42, name: "fixme", fn: Fixme },
	{ defaultFnNbr: 43, name: "fabs", fn: fabs },
	{ defaultFnNbr: 44, name: "aim", fn: aim },
	{ defaultFnNbr: 45, name: "cvar", fn: cvar_get },
	{ defaultFnNbr: 46, name: "localcmd", fn: localcmd },
	{ defaultFnNbr: 47, name: "nextent", fn: nextent },
	{ defaultFnNbr: 48, name: "particle", fn: particle },
	{ defaultFnNbr: 49, name: "ChangeYaw", fn: changeyaw },
	//	{ defaultFnNbr: 50, name: "fixme", fn: Fixme },
	{ defaultFnNbr: 51, name: "vectoangles", fn: vectoangles },
	{ defaultFnNbr: 52, name: "WriteByte", fn: writeByte },
	{ defaultFnNbr: 53, name: "WriteChar", fn: writeChar },
	{ defaultFnNbr: 54, name: "WriteShort", fn: writeShort },
	{ defaultFnNbr: 55, name: "WriteLong", fn: writeLong },
	{ defaultFnNbr: 56, name: "WriteCoord", fn: writeCoord },
	{ defaultFnNbr: 57, name: "WriteAngle", fn: writeAngle },
	{ defaultFnNbr: 58, name: "WriteString", fn: writeString },
	{ defaultFnNbr: 59, name: "WriteEntity", fn: writeEntity },
	{ defaultFnNbr: 60, name: "sin", fn: sin },
	{ defaultFnNbr: 61, name: "cos", fn: cos },
	{ defaultFnNbr: 62, name: "sqrt", fn: sqrt },
	{ defaultFnNbr: 63, name: "changepitch", fn: changepitch },
	{ defaultFnNbr: 64, name: "TraceToss", fn: fixme },
	{ defaultFnNbr: 65, name: "etos", fn: fixme },
	//	{ defaultFnNbr: 66, name: "WaterMove", fn: WaterMove },
	{ defaultFnNbr: 67, name: "movetogoal", fn: moveToGoal },
	{ defaultFnNbr: 68, name: "precache_file", fn: precache_file },
	{ defaultFnNbr: 69, name: "makestatic", fn: makestatic },
	{ defaultFnNbr: 70, name: "changelevel", fn: changelevel },
	//	{ defaultFnNbr: 71, name: "fixme", fn: Fixme },
	{ defaultFnNbr: 72, name: "cvar_set", fn: cvar_set },
	{ defaultFnNbr: 73, name: "centerprint", fn: centerprint },
	{ defaultFnNbr: 74, name: "ambientsound", fn: ambientsound },
	{ defaultFnNbr: 75, name: "precache_model2", fn: precache_model },
	{ defaultFnNbr: 76, name: "precache_sound2", fn: precache_sound },	// precache_sound2 is different only for qcc
	{ defaultFnNbr: 77, name: "precache_file2", fn: precache_file },
	{ defaultFnNbr: 78, name: "setspawnparms", fn: setspawnparms },
	//	{  79, "fixme", FIXME},
	//	{  80, "fixme", FIXME},
	{ defaultFnNbr: 79, name: 'logfrag', fn: logfrag },	// QW_ENGINE (pr_cmds.c #79)
	{ defaultFnNbr: 80, name: 'infokey', fn: infokey },
	{ defaultFnNbr: 82, name: 'multicast', fn: multicast },	// FTE_SV_MULTICAST (pr_ext.c #82)
	{ defaultFnNbr: 81, name: "stof", fn: stof },	// 2001-09-20 QuakeC string manipulation by FrikaC/Maddes

	// 2001-11-15 DarkPlaces general builtin functions by Lord Havoc  start
	{ defaultFnNbr: 90, name: "tracebox", fn: tracebox },
	{ defaultFnNbr: 91, name: "randomvec", fn: fixme },
	//	{ defaultFnNbr: 92, name: "getlight", fn: GetLight },	// not implemented yet
	//	{ defaultFnNbr: 93, name: "cvar_create", fn: cvar_create },		// 2001-09-18 New BuiltIn Function: cvar_create() by Maddes
	{ defaultFnNbr: 94, name: "fmin", fn: min },
	{ defaultFnNbr: 95, name: "fmax", fn: max },
	{ defaultFnNbr: 96, name: "fbound", fn: bound },
	{ defaultFnNbr: 97, name: "fpow", fn: pow },
	{ defaultFnNbr: 98, name: "findfloat", fn: findfloat },
	{ defaultFnNbr: 353, name: "wasfreed", fn: wasfreed },	// DP_QC_ENTITYDATA
	// DP_QC_WHICHPACK + DP_QC_FS_SEARCH (FTE pr_bgcmd.c) - VM-generic, csqc binds them by name.
	{ defaultFnNbr: 503, name: "whichpack", fn: whichpack },
	{ defaultFnNbr: 444, name: "search_begin", fn: search_begin },
	{ defaultFnNbr: 445, name: "search_end", fn: search_end },
	{ defaultFnNbr: 446, name: "search_getsize", fn: search_getsize },
	{ defaultFnNbr: 447, name: "search_getfilename", fn: search_getfilename },
	{ defaultFnNbr: 99, name: "checkextension", fn: checkextension },	// 2001-10-20 Extension System by Lord Havoc/Maddes
	//	{ defaultFnNbr: 0, name: "checkextension", fn: extension_find },
	{ defaultFnNbr: 100, name: "builtin_find", fn: fixme },		// 2001-09-14 Enhanced BuiltIn Function System (EBFS) by Maddes
	{ defaultFnNbr: 101, name: "cmd_find", fn: fixme },				// 2001-09-16 New BuiltIn Function: cmd_find() by Maddes
	{ defaultFnNbr: 102, name: "cvar_find", fn: fixme },				// 2001-09-16 New BuiltIn Function: cvar_find() by Maddes
	{ defaultFnNbr: 103, name: "cvar_string", fn: cvar_string_qc },	// 2001-09-16 by Maddes; DP/FTE bind it at #448 (entry below)
	// Same builtin at DP/FTE's number; the name key has to be unique in this table.
	{ defaultFnNbr: 448, name: "cvar_string_dp", fn: cvar_string_qc },
	{ defaultFnNbr: 93, name: "registercvar", fn: registercvar_qc },
	//	{ defaultFnNbr: 105, name: "cvar_free", fn: cvar_free },				// 2001-09-18 New BuiltIn Function: cvar_free() by Maddes
	//	{ defaultFnNbr: 106, name: "NVS_InitSVCMsg", fn: NVS_InitSVCMsg },	// 2000-05-02 NVS SVC by Maddes
	{ defaultFnNbr: 107, name: "WriteFloat", fn: fixme },			// 2001-09-16 New BuiltIn Function: WriteFloat() by Maddes
	{ defaultFnNbr: 108, name: "etof", fn: fixme },						// 2001-09-25 New BuiltIn Function: etof() by Maddes
	{ defaultFnNbr: 109, name: "ftoe", fn: fixme },						// 2001-09-25 New BuiltIn Function: ftoe() by Maddes
	// 2001-09-20 QuakeC file access by FrikaC/Maddes  start
	{ defaultFnNbr: 110, name: "fopen", fn: fopen },
	{ defaultFnNbr: 111, name: "fclose", fn: fclose },
	{ defaultFnNbr: 112, name: "fgets", fn: fgets },
	{ defaultFnNbr: 113, name: "fputs", fn: fputs },
	{ defaultFnNbr: 0, name: "open", fn: fixme },						// 0 indicates that this entry is just for remapping (because of name and number change)
	{ defaultFnNbr: 0, name: "close", fn: fixme },
	{ defaultFnNbr: 0, name: "read", fn: fixme },
	{ defaultFnNbr: 0, name: "write", fn: fixme },
	// 2001-09-20 QuakeC file access by FrikaC/Maddes  end
	// FTE's file extensions (pr_cmds.c #651-653)
	{ defaultFnNbr: 651, name: "frename", fn: frename },
	{ defaultFnNbr: 652, name: "fremove", fn: fremove },
	{ defaultFnNbr: 653, name: "fexists", fn: fexists },

	// 2001-09-20 QuakeC string manipulation by FrikaC/Maddes  start
	{ defaultFnNbr: 114, name: "strlen", fn: strlen },
	{ defaultFnNbr: 115, name: "strcat", fn: strcat },
	{ defaultFnNbr: 116, name: "substring", fn: substring },
	{ defaultFnNbr: 117, name: "stov", fn: stov },
	{ defaultFnNbr: 118, name: "strzone", fn: strzone },
	{ defaultFnNbr: 119, name: "strunzone", fn: strunzone },
	{ defaultFnNbr: 225, name: "strpad", fn: strpad },
	{ defaultFnNbr: 0, name: "zone", fn: fixme },		// 0 indicates that this entry is just for remapping (because of name and number change)
	{ defaultFnNbr: 0, name: "unzone", fn: fixme },
	// 2001-09-20 QuakeC string manipulation by FrikaC/Maddes  end

	// FTE_STRINGS (pr_ext.c PF_str*/PF_info*)
	{ defaultFnNbr: 221, name: "strstrofs", fn: pf_strings.strstrofs },
	{ defaultFnNbr: 222, name: "str2chr", fn: pf_strings.str2chr },
	{ defaultFnNbr: 223, name: "chr2str", fn: pf_strings.chr2str },
	{ defaultFnNbr: 224, name: "strconv", fn: pf_strings.strconv },
	{ defaultFnNbr: 226, name: "infoadd", fn: pf_strings.infoadd },
	{ defaultFnNbr: 227, name: "infoget", fn: pf_strings.infoget },
	{ defaultFnNbr: 228, name: "strncmp", fn: pf_strings.strncmp },
	// strcasecmp/strncasecmp share PF_strncasecmp in pr_ext.c (argc picks the call shape)
	{ defaultFnNbr: 229, name: "strcasecmp", fn: pf_strings.strncasecmp },
	{ defaultFnNbr: 230, name: "strncasecmp", fn: pf_strings.strncasecmp },
	// DP_QC_STRING_CASE_FUNCTIONS (pr_cmds.c #480/#481)
	{ defaultFnNbr: 480, name: "strtolower", fn: pf_strings.strtolower },
	{ defaultFnNbr: 481, name: "strtoupper", fn: pf_strings.strtoupper },

	// 2001-11-15 DarkPlaces general builtin functions by LordHavoc  start
	{ defaultFnNbr: 400, name: "copyentity", fn: copyentity },
	{ defaultFnNbr: 401, name: "setcolor", fn: setcolors },
	{ defaultFnNbr: 402, name: "findchain", fn: findchain },
	{ defaultFnNbr: 403, name: "findchainfloat", fn: findchainfloat},
	{ defaultFnNbr: 440, name: 'clientcommand', fn: clientcommand},
	{ defaultFnNbr: 441, name: 'tokenize', fn: tokenize},
	{ defaultFnNbr: 442, name: 'argv', fn: argv},
	{ defaultFnNbr: 514, name: 'tokenize_console', fn: tokenize},
	{ defaultFnNbr: 627, name: 'sprintf', fn: sprintf},

	// DP_QC_GETSURFACE (pr_ext.c PF_getsurface*)
	{ defaultFnNbr: 434, name: "getsurfacenumpoints", fn: getsurfacenumpoints },
	{ defaultFnNbr: 435, name: "getsurfacepoint", fn: getsurfacepoint },
	{ defaultFnNbr: 436, name: "getsurfacenormal", fn: getsurfacenormal },
	{ defaultFnNbr: 437, name: "getsurfacetexture", fn: getsurfacetexture },
	{ defaultFnNbr: 438, name: "getsurfacenearpoint", fn: getsurfacenearpoint },
	{ defaultFnNbr: 439, name: "getsurfaceclippedpoint", fn: getsurfaceclippedpoint },

	// EXT_CSQC extended stats (pr_ext.c:7805-7806)
	{ defaultFnNbr: 232, name: "clientstat", fn: clientstat },
	{ defaultFnNbr: 233, name: "globalstat", fn: globalstat },

	// effectinfo-particles Phase C (pr_ext.c ~8870-8872, EXT_CSQC / FTE_SV_POINTPARTICLES)
	{ defaultFnNbr: 335, name: "particleeffectnum", fn: particleeffectnum },
	{ defaultFnNbr: 336, name: "trailparticles", fn: trailparticles },
	{ defaultFnNbr: 337, name: "pointparticles", fn: pointparticles },

	// DP_TE_PARTICLERAIN/SNOW (pr_ext.c #409/#410)
	{ defaultFnNbr: 409, name: "te_particlerain", fn: te_particlerain },
	{ defaultFnNbr: 410, name: "te_particlesnow", fn: te_particlesnow },

	// 2021 rerelease (Kex) QC compat (pr_ext.c ~8656-8674). defaultFnNbr:0 keeps these out of
	// the fixed classic table - same "remap-only" convention as the open/close/zone entries
	// above. Bound to a synthesized high builtin number by pr.loadProgs, but only when
	// state.rerelease is detected (see pr.ts) - classic progs never declare a "= #0;" function
	// named any of these, so this table addition is inert for id1/AD/Copper.
	{ defaultFnNbr: 0, name: "ex_finaleFinished", fn: ex_finaleFinished },
	{ defaultFnNbr: 0, name: "ex_localsound", fn: ex_localsound },
	{ defaultFnNbr: 0, name: "ex_centerprint", fn: ex_centerprint },
	{ defaultFnNbr: 0, name: "ex_bprint", fn: ex_bprint },
	{ defaultFnNbr: 0, name: "ex_sprint", fn: ex_sprint },
	{ defaultFnNbr: 0, name: "ex_CheckPlayerEXFlags", fn: ex_CheckPlayerEXFlags },
	{ defaultFnNbr: 0, name: "ex_walkpathtogoal", fn: ex_walkpathtogoal },
	{ defaultFnNbr: 0, name: "ex_bot_movetopoint", fn: ex_bot_movetopoint },
	{ defaultFnNbr: 0, name: "ex_bot_followentity", fn: ex_bot_followentity },

	// ---- FTE builtin breadth. Impls in pf_fte.ts; numbers are FTE's own, from server/pr_cmds.c
	// unless noted. defaultFnNbr 0 = name-binding only, as FTE gives these too.

	// DP_QC_STRINGBUFFERS (pr_cmds.c:12078-12087) + FTE's file pair (pr_cmds.c:12180-12181).
	{ defaultFnNbr: 460, name: "buf_create", fn: pf_fte.buf_create },
	{ defaultFnNbr: 461, name: "buf_del", fn: pf_fte.buf_del },
	{ defaultFnNbr: 462, name: "buf_getsize", fn: pf_fte.buf_getsize },
	{ defaultFnNbr: 463, name: "buf_copy", fn: pf_fte.buf_copy },
	{ defaultFnNbr: 464, name: "buf_sort", fn: pf_fte.buf_sort },
	{ defaultFnNbr: 465, name: "buf_implode", fn: pf_fte.buf_implode },
	{ defaultFnNbr: 466, name: "bufstr_get", fn: pf_fte.bufstr_get },
	{ defaultFnNbr: 467, name: "bufstr_set", fn: pf_fte.bufstr_set },
	{ defaultFnNbr: 468, name: "bufstr_add", fn: pf_fte.bufstr_add },
	{ defaultFnNbr: 469, name: "bufstr_free", fn: pf_fte.bufstr_free },
	{ defaultFnNbr: 535, name: "buf_loadfile", fn: pf_fte.buf_loadfile },
	{ defaultFnNbr: 536, name: "buf_writefile", fn: pf_fte.buf_writefile },

	// DP_QC_TOKENIZEBYSEPARATOR (pr_cmds.c:12100)
	{ defaultFnNbr: 479, name: "tokenizebyseparator", fn: pf_fte.tokenizebyseparator },

	// Model frame introspection (pr_cmds.c:11679/11680/11752/11767)
	{ defaultFnNbr: 276, name: "frameforname", fn: pf_fte.frameforname },
	{ defaultFnNbr: 277, name: "frameduration", fn: pf_fte.frameduration },
	{ defaultFnNbr: 284, name: "frametoname", fn: pf_fte.frametoname },
	{ defaultFnNbr: 0, name: "modelframecount", fn: pf_fte.modelframecount },

	// checkbuiltin (pr_cmds.c:11473) - name-bound, as its whole point is testing "= #0" imports.
	{ defaultFnNbr: 0, name: "checkbuiltin", fn: pf_fte.checkbuiltin },

	// EXT_BITSHIFT / FTE_QC_CROSSPRODUCT / FTE_QC_INTCONV
	// (pr_cmds.c:11555/11685/11603/11639-11644)
	{ defaultFnNbr: 218, name: "bitshift", fn: pf_fte.bitshift },
	{ defaultFnNbr: 0, name: "crossproduct", fn: pf_fte.crossproduct },
	{ defaultFnNbr: 245, name: "mod", fn: pf_fte.qcmod },
	{ defaultFnNbr: 259, name: "stoi", fn: pf_fte.stoi },
	{ defaultFnNbr: 260, name: "itos", fn: pf_fte.itos },
	{ defaultFnNbr: 261, name: "stoh", fn: pf_fte.stoh },
	{ defaultFnNbr: 262, name: "htos", fn: pf_fte.htos },
	{ defaultFnNbr: 0, name: "ftoi", fn: pf_fte.ftoi },
	{ defaultFnNbr: 0, name: "itof", fn: pf_fte.itof },

	// strtrim (pr_cmds.c:11575) + digest_hex (pr_cmds.c:12236)
	{ defaultFnNbr: 0, name: "strtrim", fn: pf_fte.strtrim },
	{ defaultFnNbr: 639, name: "digest_hex", fn: pf_fte.digest_hex },

	// FTE_MEMALLOC's builtin-only subset (pr_cmds.c:11923-11931). Not advertised - see pf_fte.ts.
	{ defaultFnNbr: 384, name: "memalloc", fn: pf_fte.memalloc },
	{ defaultFnNbr: 385, name: "memfree", fn: pf_fte.memfree },
	{ defaultFnNbr: 386, name: "memcpy", fn: pf_fte.memcpy },
	{ defaultFnNbr: 387, name: "memfill8", fn: pf_fte.memfill8 },
	{ defaultFnNbr: 388, name: "memgetval", fn: pf_fte.memgetval },
	{ defaultFnNbr: 389, name: "memsetval", fn: pf_fte.memsetval },
	{ defaultFnNbr: 390, name: "memptradd", fn: pf_fte.memptradd },

	// uri_get (pr_cmds.c:12144) - a named refusal, not an implementation. See pf_fte.uri_get.
	{ defaultFnNbr: 513, name: "uri_get", fn: pf_fte.uri_get }
]