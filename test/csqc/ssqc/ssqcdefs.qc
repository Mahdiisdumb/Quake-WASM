/*
ssqcdefs.qc — minimal server-side QuakeC defs for the WP3.2 companion progs.dat.

This is the SERVER half of the CSQC test fixtures: a standalone progs.dat that
networks one entity through .SendEntity, so test/csqc/full/csprogs.dat has
something to receive. It is deliberately self-contained (no id1 defs.qc
dependency) and implements only what the engine requires of a progs.dat plus
the bits WP3.2 exercises.

Sources, as with ../csqcdefs.qc — everything here is transcribed from the
authoritative C, not copied from a compiled artifact:

  - system globals/fields block: the literal fprintf text QSS emits for
    `#if defined(CSQC_SIMPLE) || defined(SSQC)`, QSS/Quake/pr_ext.c:8876-8920
    (identical to the block in ../csqcdefs.qc — same vanilla NQ layout, which
    is the whole point of design decision 2 in docs/csqc-plan.md).
  - SSQC extension fields: QCEXTFIELDS_SS, QSS/Quake/progs.h:310-330.
  - builtin numbers: vanilla NQ #1-#78 (QSS pr_cmds.c pr_builtin[]) plus
    #82 multicast (QSS PF_multicast, pr_ext.c:4789).

NQ PROGHEADER_CRC: the compiled progs.dat must report 5927, same requirement
and same reason as ../csqcdefs.qc — do not touch anything before
end_sys_fields. Verify with:

  node -e "const b=require('fs').readFileSync('progs.dat'); console.log('version', b.readInt32LE(0), 'crc', b.readInt32LE(4));"
*/

#pragma noref 1

//====================================================================
// Vanilla NQ system globals/fields block (QSS pr_ext.c:8876-8920).
// Byte-identical in names, types and order to vanilla NQ defs.qc's system
// block — this is what the header CRC 5927 is computed from.
//====================================================================
entity		self,other,world;
float		time,frametime,force_retouch;
string		mapname;
float		deathmatch,coop,teamplay,serverflags,total_secrets,total_monsters,found_secrets,killed_monsters,parm1, parm2, parm3, parm4, parm5, parm6, parm7, parm8, parm9, parm10, parm11, parm12, parm13, parm14, parm15, parm16;
vector		v_forward, v_up, v_right;
float		trace_allsolid,trace_startsolid,trace_fraction;
vector		trace_endpos,trace_plane_normal;
float		trace_plane_dist;
entity		trace_ent;
float		trace_inopen,trace_inwater;
entity		msg_entity;
void() 		main,StartFrame,PlayerPreThink,PlayerPostThink,ClientKill,ClientConnect,PutClientInServer,ClientDisconnect,SetNewParms,SetChangeParms;
void		end_sys_globals;

.float		modelindex;
.vector		absmin, absmax;
.float		ltime,movetype,solid;
.vector		origin,oldorigin,velocity,angles,avelocity,punchangle;
.string		classname,model;
.float		frame,skin,effects;
.vector		mins, maxs,size;
.void()		touch,use,think,blocked;
.float		nextthink;
.entity		groundentity;
.float		health,frags,weapon;
.string		weaponmodel;
.float		weaponframe,currentammo,ammo_shells,ammo_nails,ammo_rockets,ammo_cells,items,takedamage;
.entity		chain;
.float		deadflag;
.vector		view_ofs;
.float		button0,button1,button2,impulse,fixangle;
.vector		v_angle;
.float		idealpitch;
.string		netname;
.entity 	enemy;
.float		flags,colormap,team,max_health,teleport_time,armortype,armorvalue,waterlevel,watertype,ideal_yaw,yaw_speed;
.entity		aiment,goalentity;
.float		spawnflags;
.string		target,targetname;
.float		dmg_take,dmg_save;
.entity		dmg_inflictor,owner;
.vector		movedir;
.string		message;
.float		sounds;
.string		noise, noise1, noise2, noise3;
void		end_sys_fields;

//====================================================================
// SSQC extension fields (QCEXTFIELDS_SS, QSS progs.h:310-330). Only the
// three the csqc entity stream reads are declared; the engine resolves them
// by name at progs load (sv.resolveCsqcFields).
//====================================================================
.float(entity to, float changedflags) SendEntity;	// nonzero => this entity is networked by csqc
.float SendFlags;									// changed-bits the engine ORs in, cleared each frame
.float pvsflags;									// PVSF_* — pvs behaviour for this entity

// Mod field, not an engine one: the value SendEntity streams and CSQC_Ent_Update
// stores into the client edict's own .drawmask (which IS an engine field, csqc-side).
.float drawmask;

// Mod fields the WP3.4 custom stats are registered against. clientstat reads the field
// off the receiving client's OWN player edict, so both live on the player.
.float csqc_counter;	// networked as EV_FLOAT stat 100
.string csqc_label;		// networked as EV_STRING stat 101

//====================================================================
// Constants
//====================================================================
const float FALSE = 0;
const float TRUE = 1;

const float MOVETYPE_NONE = 0;
const float MOVETYPE_WALK = 3;
const float MOVETYPE_NOCLIP = 8;

const float SOLID_NOT = 0;
const float SOLID_TRIGGER = 1;
const float SOLID_BBOX = 2;
const float SOLID_SLIDEBOX = 3;
const float SOLID_BSP = 4;

const float FL_CLIENT = 8;
const float DEAD_NO = 0;

// Write* destinations (QSS server.h:294-299). MSG_ENTITY is the one SendEntity uses:
// it and MSG_MULTICAST name the same staging buffer (QSS WriteDest, pr_cmds.c:1646).
const float MSG_BROADCAST = 0;
const float MSG_ONE = 1;
const float MSG_ALL = 2;
const float MSG_INIT = 3;
const float MSG_MULTICAST = 4;
const float MSG_ENTITY = 5;

// multicast destinations (QSS multicast_t, pr_ext.c:56-67)
const float MULTICAST_ALL_U = 0;
const float MULTICAST_PHS_U = 1;
const float MULTICAST_PVS_U = 2;
const float MULTICAST_ALL_R = 3;
const float MULTICAST_PHS_R = 4;
const float MULTICAST_PVS_R = 5;
const float MULTICAST_ONE_U = 6;
const float MULTICAST_ONE_R = 7;
const float MULTICAST_INIT = 8;

// svcfte_cgamepacket (QSS protocol.h:352, FTE protocol.h:358). Written by the mod as the FIRST
// byte of an MSG_MULTICAST payload; the engine then restricts that multicast to clients which
// negotiated PEXT1_CSQC, and their CSQC_Parse_Event reads back everything after this byte.
// FTE declares the same constant to QC as SVC_CGAMEPACKET (pr_cmds.c:13632, "must only be
// multicast").
const float SVC_CGAMEPACKET = 83;

// .pvsflags values (QSS server.h:301-306)
const float PVSF_NORMALPVS = 0;
const float PVSF_NOTRACECHECK = 1;
const float PVSF_USEPHS = 2;
const float PVSF_IGNOREPVS = 3;
const float PVSF_NOREMOVE = 128;

// The .drawmask bit test/csqc/full/full.qc's addentities(MASK_NORMAL) pass matches.
const float MASK_NORMAL = 4;

// QC value types, as clientstat/globalstat's `type` argument takes them (QSS etype_t,
// pr_comp.h:47-61). Only the subset the engine's registerCustomStat accepts is named.
const float EV_STRING = 1;
const float EV_FLOAT = 2;
const float EV_VECTOR = 3;
const float EV_ENTITY = 4;
const float EV_INTEGER = 8;
const float EV_UINT = 9;

// Stat numbers this fixture registers. QSS's clientstat docs reserve everything outside
// 32..127 (pr_ext.c:7805), so both sit inside that window; both are also >= 32, which is
// what makes them extended stats — they only reach a client that negotiated PEXT1_CSQC.
const float STAT_FIXTURE_COUNTER = 100;
const float STAT_FIXTURE_LABEL = 101;

//====================================================================
// Vanilla NQ builtins (QSS pr_cmds.c pr_builtin[]) — only the ones used.
//====================================================================
void(vector ang) makevectors			= #1;
void(entity e, vector o) setorigin		= #2;
void(entity e, string m) setmodel		= #3;
void(entity e, vector min, vector max) setsize = #4;
float() random							= #7;
void(entity e, float chan, string samp, float vol, float atten) sound = #8;
void(string e) error					= #10;
void(string e) objerror					= #11;
entity() spawn							= #14;
void(entity e) remove					= #15;
entity(entity start, .string fld, string match) find = #18;
string(string s) precache_sound			= #19;
string(string s) precache_model			= #20;
void(string s) bprint					= #23;
void(entity client, string s) sprint	= #24;
void(string s) dprint					= #25;
string(float f) ftos					= #26;
string(vector v) vtos					= #27;
float() droptofloor						= #34;
void(float style, string value) lightstyle = #35;
void(float to, float f) WriteByte		= #52;
void(float to, float f) WriteChar		= #53;
void(float to, float f) WriteShort		= #54;
void(float to, float f) WriteLong		= #55;
void(float to, float f) WriteCoord		= #56;
void(float to, float f) WriteAngle		= #57;
void(float to, string s) WriteString	= #58;
void(float to, entity s) WriteEntity	= #59;
void(entity e) setspawnparms			= #78;

// FTE_SV_MULTICAST (QSS PF_multicast, pr_ext.c:4789) — not used by the echo
// entity (SendEntity's buffer is spliced by the engine, not multicast), declared
// so the fixture can grow a cgamepacket case in WP3.5.
void(vector where, float set) multicast	= #82;

// EXT_CSQC extended stats (QSS PF_clientstat/PF_globalstat, pr_ext.c:7805-7806).
// clientstat networks a field of each client's own edict; globalstat networks a named
// global, so every client sees the same value.
void(float num, float type, .__variant fld) clientstat = #232;
void(float num, float type, string name) globalstat = #233;
