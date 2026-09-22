/*
csqcdefs.qc — hand-extracted CSQC API surface for QSS (QuakeSpasm-Spiked).

WP1.5 status: QSS's checked-in source tree (C:\source\QSS) does NOT ship a
pre-generated `qsextensions.qc` — that file is only produced at runtime by
the `pr_dumpplatform` console command (`PR_DumpPlatform_f`, QSS/Quake/pr_ext.c
~line 8766), which requires a *running, built* QSS binary. No such binary
exists in this checkout (no .exe under C:\source\QSS), and building the
engine from source is out of scope for this WP. So this file is the
hand-written fallback the task describes, transcribed directly from the
authoritative C source rather than generated:

  - system globals/fields block: QSS/Quake/pr_ext.c:8873-8921 (the literal
    fprintf'd text QSS emits for `#if defined(CSQC_SIMPLE) || defined(SSQC)`)
  - entry points / extglobals / extfields: QSS/Quake/progs.h:176-340
    (QCEXTFUNCS_*, QCEXTGLOBALS_*, QCEXTFIELDS_* macros — these are the
    literal struct member lists PR_DumpPlatform_f iterates to emit its
    output, so this transcription is equivalent in content, just typed by
    hand instead of macro-expanded)
  - extension builtin numbers/signatures: QSS/Quake/pr_ext.c, the
    `extensionbuiltins[]` table (~line 7770-7960), matched by builtin name
    ("clearscene", "drawfill", "getstati", ...) since the table itself is
    ~450 entries and only the CSQC-relevant slice enumerated in the WP1.5
    task is transcribed here.

IMPORTANT — NQ progheader CRC requirement (design decision WP0.1 #2 in
docs/csqc-plan.md, QSS pr_edict.c:1329-1365): QSS requires csprogs.dat to
report PROGHEADER_CRC 5927, the same CRC as vanilla NQ progs.dat. That CRC
is a crc16 over the *engine-visible reflection data* (the sys globals +
sys fields blocks below, i.e. the exact set and order of global/field names
declared before `end_sys_globals`/`end_sys_fields`) — NOT over QC code or
extension declarations. Getting 5927 requires:
  1. This sys-globals/sys-fields block to be byte-identical in names, types,
     and order to vanilla NQ defs.qc's system block (transcribed verbatim
     below from pr_ext.c's fprintf sequence).
  2. Any extension globals/fields to be declared *after* end_sys_globals /
     end_sys_fields (extensions don't affect the header CRC — only the
     system block does), which this file does correctly (extensions follow
     the #endif that closes the sys block).
  3. progs.src listing this file before any file defining `main`/entry
     points, per fteqcc convention.
  See test/csqc/README.md for the exact compile command and CRC check.
*/

#if defined(QUAKEWORLD) || defined(MENU)
#error Mixed up module defs
#endif

#if !defined(CSQC) && !defined(SSQC) && !defined(MENU)
	#define CSQC
	#ifndef CSQC_SIMPLE
		#define CSQC_SIMPLE
	#endif
#endif

#ifndef QSSDEP
	#define QSSDEP __deprecated
#endif

#pragma noref 1

//====================================================================
// Vanilla NQ system globals/fields block.
// Transcribed verbatim from QSS/Quake/pr_ext.c:8876-8920 (the fprintf
// sequence for `#if defined(CSQC_SIMPLE) || defined(SSQC)`). QSS shares
// this block between SSQC and (simple-tier) CSQC on purpose, specifically
// so csprogs.dat gets the same PROGHEADER_CRC (5927) as a vanilla NQ
// progs.dat — see QSS pr_edict.c:1329-1365.
//====================================================================
#if defined(CSQC_SIMPLE) || defined(SSQC)
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
#endif

//====================================================================
// Common accessor-type stand-ins (pr_ext.c:8932-8945). We don't use
// _ACCESSORS, so these just become float/string like QSS's non-accessor path.
//====================================================================
#define strbuf float
#define searchhandle float
#define hashtable float
#define infostring string
#define filestream float

//====================================================================
// Common entry points (QCEXTFUNCS_COMMON + QCEXTFUNCS_GAME, progs.h:179-183)
//====================================================================
void(string cmdtext) GameCommand;			// obsoleted by registercommand/CSQC_ConsoleCommand, dp compat
void() EndFrame;							// csqc+ssqc shared

//====================================================================
// CSQC entry points (QCEXTFUNCS_CS, progs.h:189-207)
//====================================================================
void(float apilevel, string enginename, float engineversion) CSQC_Init;
void() CSQC_Shutdown;
void(vector virtsize, float showscores) CSQC_DrawHud;			// simple: simple-hud-only tier
void(vector virtsize, float showscores) CSQC_DrawScores;		// simple: optional, simple-hud-only tier
float(float evtype, float scanx, float chary, float devid) CSQC_InputEvent;
float(string cmdstr) CSQC_ConsoleCommand;
void() CSQC_Parse_Event;					// an svcfte_cgamepacket the ssqc multicast; read it with the read* builtins
float(float save, float take, vector dir) CSQC_Parse_Damage;
void(float vwidth, float vheight, float notmenu) CSQC_UpdateView;			// full only: owns the whole screen
void(float vwidth, float vheight, float notmenu) CSQC_UpdateViewLoading;	// full only
void() CSQC_Input_Frame;						// full only: input angles stuff
float(string msg) CSQC_Parse_CenterPrint;
void(string printmsg, float printlvl) CSQC_Parse_Print;
void(float isnew) CSQC_Ent_Update;				// full: read the entity bytestream
void() CSQC_Ent_Remove;						// full: basically remove(self)
void(float entnum, float channel, string soundname, float vol, float attenuation, vector pos, float pitchmod, float flags) CSQC_Event_Sound;	// full
float() CSQC_Parse_TempEntity;					// full
void(string msg) CSQC_Parse_StuffCmd;			// full only

//====================================================================
// Extension globals (QCEXTGLOBALS_COMMON/GAME/CSQC, progs.h:230-263).
// `time`/`frametime` are QCEXTGLOBALS_COMMON but already declared in the
// sys block above (shared name+type — QSS redeclares them too via macro
// expansion; fteqcc merges identical redeclarations, so omitted here to
// avoid relying on that merge behavior unnecessarily).
//====================================================================
float clframetime;
float cltime;
float maxclients;
float intermission;
float intermission_time;
float player_localnum;
float player_localentnum;
vector view_angles;
float clientcommandframe;
float servercommandframe;

// Input globals (QCEXTGLOBALS_INPUTS, progs.h:234-247) — used by full CSQC's
// CSQC_Input_Frame / getinputstate; harmless if unread by simple-hud fixture.
float input_sequence;
float input_servertime;
float input_timelength;
vector input_movevalues;
vector input_angles;
float input_buttons;
float input_impulse;
int input_weapon;
vector input_cursor_screen;
vector input_cursor_trace_start;
vector input_cursor_trace_endpos;
float input_cursor_entitynumber;
__used var float physics_mode = 2;

//====================================================================
// Extension fields (QCEXTFIELDS_ALL + QCEXTFIELDS_CL + QCEXTFIELDS_CS,
// progs.h:278-309). QCEXTFIELDS_SS (SendEntity etc) intentionally omitted —
// that's ssqc-only and belongs to a future WP3.2 fixture progs.dat, not csqc.
//====================================================================
.float alpha;
.float scale;
.vector colormod;
.entity tag_entity;
.float tag_index;
.float modelflags;
// NOTE: .origin/.angles/.frame/.skin are already declared in the sys block
// above (shared with SSQC) — QSS's QCEXTFIELDS_ALL redeclares them only
// when compiling MenuQC (which has no sys block); csqc/ssqc builds must NOT
// redeclare, or fteqcc errors on a duplicate field. Left commented for
// documentation of the required set per the WP1.5 task:
//   .vector origin; .vector angles; .float frame; .float skin;
.float frame2;
.float lerpfrac;
.float frame1time;
.float frame2time;
.float renderflags;
.float entnum;
.float drawmask;
.float() predraw;

//====================================================================
// Constants
//====================================================================
const float FALSE = 0;
const float TRUE = 1;

// addentities masks. MASK_ENGINE/MASK_VIEWMODEL are the engine's own (QSS pr_ext.c:6686-6690,
// FTE csplat.qc:1395); MASK_NORMAL is just the conventional first .drawmask bit for csqc entities
// (FTE csqctest/src/cs/constants.qc:44) - the engine only ever ANDs it against .drawmask.
const float MASK_ENGINE = 1;
const float MASK_VIEWMODEL = 2;
const float MASK_NORMAL = 4;

const float STAT_HEALTH = 0;
const float STAT_WEAPONMODELI = 2;
const float STAT_AMMO = 3;
const float STAT_ARMOR = 4;
const float STAT_WEAPONFRAME = 5;
const float STAT_SHELLS = 6;
const float STAT_NAILS = 7;
const float STAT_ROCKETS = 8;
const float STAT_CELLS = 9;
const float STAT_ACTIVEWEAPON = 10;
const float STAT_TOTALSECRETS = 11;
const float STAT_TOTALMONSTERS = 12;
const float STAT_FOUNDSECRETS = 13;
const float STAT_KILLEDMONSTERS = 14;
const float STAT_ITEMS = 15;
const float STAT_VIEWHEIGHT = 16;
const float STAT_USER = 32;

const float IE_KEYDOWN = 0;
const float IE_KEYUP = 1;
const float IE_MOUSEDELTA = 2;
const float IE_MOUSEABS = 3;
const float IE_JOYAXIS = 6;

const float VF_MIN = 1;
const float VF_MIN_X = 2;
const float VF_MIN_Y = 3;
const float VF_SIZE = 4;
const float VF_SIZE_X = 5;
const float VF_SIZE_Y = 6;
const float VF_VIEWPORT = 7;
const float VF_FOV = 8;
const float VF_FOV_X = 9;
const float VF_FOV_Y = 10;
const float VF_ORIGIN = 11;
const float VF_ORIGIN_X = 12;
const float VF_ORIGIN_Y = 13;
const float VF_ORIGIN_Z = 14;
const float VF_ANGLES = 15;
const float VF_ANGLES_X = 16;
const float VF_ANGLES_Y = 17;
const float VF_ANGLES_Z = 18;
const float VF_DRAWWORLD = 19;
const float VF_DRAWENGINESBAR = 20;
const float VF_DRAWCROSSHAIR = 21;
const float VF_MINDIST = 23;
const float VF_MAXDIST = 24;
const float VF_CL_VIEWANGLES = 33;
const float VF_CL_VIEWANGLES_X = 34;
const float VF_CL_VIEWANGLES_Y = 35;
const float VF_CL_VIEWANGLES_Z = 36;
const float VF_ACTIVESEAT = 202;
const float VF_AFOV = 203;
const float VF_SCREENVSIZE = 204;
const float VF_SCREENPSIZE = 205;

// getentity field selectors (pr_ext.c:7381-7425, getrenderentityfield_e).
const float GE_MAXENTS = -1;
const float GE_ACTIVE = 0;
const float GE_ORIGIN = 1;
const float GE_FORWARD = 2;
const float GE_RIGHT = 3;
const float GE_UP = 4;
const float GE_SCALE = 5;
const float GE_ORIGINANDVECTORS = 6;
const float GE_ALPHA = 7;
const float GE_COLORMOD = 8;
const float GE_PANTSCOLOR = 9;
const float GE_SHIRTCOLOR = 10;
const float GE_SKIN = 11;
const float GE_MODELINDEX = 200;
const float GE_EFFECTS = 202;
const float GE_FRAME = 203;
const float GE_ANGLES = 204;

// .predraw return values (EXT_CSQC): 0 lets addentities add the entity itself.
const float PREDRAW_AUTOADD = 0;
const float PREDRAW_NEXT = 1;

//====================================================================
// Vanilla low-numbered builtins used by the fixtures (subset of QSS's
// "Vanilla Builtin list", pr_ext.c:9281-9354; these are #1-#78, shared by
// SSQC/CSQC — QSS makes csqc's copy operate on the active/client VM).
//====================================================================
void(entity e, vector o) setorigin = #2;
// pr_cmds.c:2165 — the csqc form resolves the name through the client's model precache
// (server-precached names keep their index, csqc-only ones get a negative one).
void(entity e, string m) setmodel = #3;
void(entity e, vector min, vector max) setsize = #4;
// pr_cmds.c:2231 — SV_MoveToGoal, shared verbatim between the two VMs.
void(float dist) movetogoal = #67;
// pr_cmds.c:2234 — the csqc form promotes the edict to a client-side static entity.
void(entity e) makestatic = #69;
entity() spawn = #14;
void(entity e) remove = #15;
void(vector v1, vector v2, float flags, entity ent) traceline = #16;
float(vector v) pointcontents = #41;
string(string s) precache_sound = #19;
string(string s) precache_model = #20;
void(string,...) dprint = #25;
string(float) ftos = #26;
string(vector) vtos = #27;
string(string s1, optional string s2, optional string s3, optional string s4, optional string s5, optional string s6, optional string s7, optional string s8) strcat = #115;	// pr_ext.c:7764 (FRIK_FILE)
float(string) cvar = #45;
void(string,...) localcmd = #46;

//====================================================================
// CSQC extension builtins — exact numbers/signatures transcribed from the
// extensionbuiltins[] table in QSS/Quake/pr_ext.c (line noted per entry).
// This is the literal subset enumerated in the WP1.5 task description.
//====================================================================

// pr_ext.c:7770 — plays a sound locally, no serverside equivalent needed.
void(string soundname, optional float channel, optional float volume) localsound = #177;

// pr_ext.c:7876 — resets viewprops + rentity/dlight/poly lists.
void() clearscene = #300;
// pr_ext.c:7877 — mask&MASK_ENGINE walks engine-owned (server) entities,
// mask&MASK_NORMAL walks csqc edicts honoring .drawmask/.predraw.
void(float mask) addentities = #301;
// pr_ext.c:7878 — copies one csqc edict's render-relevant fields into a rentity.
void(entity ent) addentity = #302;
// pr_ext.c:7881 — sets a VF_* view property; varargs per-property.
float(float property, ...) setproperty = #303;
// pr_ext.c:7882 — draws everything added via addentity/addentities so far.
void() renderscene = #304;
// pr_ext.c:7887 — reads back a VF_* view property (nogameaccess-gated for some).
__variant(float property) getproperty = #309;
// pr_ext.c:7883 — adds a one-frame dlight to the scene being built.
float(vector org, float radius, vector lightcolours, optional float style, optional string cubemapname, optional float pflags) dynamiclight_add = #305;
// pr_ext.c:7888 — 2d screen point (with depth) -> 3d world point, per the current view properties.
vector(vector v) unproject = #310;
// pr_ext.c:7889 — 3d world point -> 2d screen point; a negative z means "behind the camera".
vector(vector v) project = #311;

// pr_ext.c:7743 — the lightmap sample under a point, 0-1 per component.
vector(vector org) getlight = #92;
// pr_ext.c:7815 — is any leaf the entity touches visible from viewpos?
float(vector viewpos, entity ent) checkpvs = #240;
// pr_ext.c:7850 — relink an entity (optionally moving it first) and fire the triggers it overlaps.
void(optional entity ent, optional vector neworigin) touchtriggers = #279;

// pr_ext.c:7913 — like setmodel, but by precache index (negative = a csqc-side precache).
void(entity e, float mdlindex) setmodelindex = #333;
// pr_ext.c:7914 — the name behind a model index, either sign.
string(float mdlindex) modelnameforindex = #334;
// pr_ext.c:7915-7917 — effectinfo particles, resolved and run client-side (no server round trip).
float(string effectname) particleeffectnum = #335;
void(float effectnum, entity ent, vector start, vector end) trailparticles = #336;
void(float effectnum, vector origin, optional vector dir, optional float count) pointparticles = #337;

// pr_ext.c:7892 — true if the named pic is already loaded/cached.
float(string name) iscachedpic = #316;
// pr_ext.c:7893 — forces the engine to load/cache the named pic.
string(string name, optional float flags) precache_pic = #317;
// pr_ext.c:7896 — returns the pic's pixel dimensions as a vector (z unused).
vector(string picname) drawgetimagesize = #318;
// pr_ext.c:7898 — draws one console-font character at a 2D position.
float(vector position, float character, vector size, vector rgb, float alpha, optional float drawflag) drawcharacter = #320;
// pr_ext.c:7900 — draws a pic within a 2D box, tinted by rgb/alpha.
float(vector position, string pic, vector size, vector rgb, float alpha, optional float drawflag) drawpic = #322;
// pr_ext.c:7901 — draws a solid-colour filled 2D box.
float(vector position, vector size, vector rgb, float alpha, optional float drawflag) drawfill = #323;
// pr_ext.c:7902 — sets the 2D scissor rect; draws are clipped to it until reset.
void(float x, float y, float width, float height) drawsetcliparea = #324;
// pr_ext.c:7903 — reverts the scissor rect to the full screen.
void(void) drawresetcliparea = #325;
// pr_ext.c:7904 — draws a markup string at a 2D position.
float(vector position, string text, vector size, vector rgb, float alpha, float drawflag) drawstring = #326;
// pr_ext.c:7905 — measures a string's on-screen width in virtual pixels.
float(string text, float usecolours, vector fontsize) stringwidth = #327;
// pr_ext.c:7906 — draws a rescaled sub-rect of a pic (atlas/sprite-sheet use).
void(vector pos, vector sz, string pic, vector srcpos, vector srcsz, vector rgb, float alpha, optional float drawflag) drawsubpic = #328;

// pr_ext.c:7909 — reads an EV_INTEGER/EV_ENTITY stat by index (see STAT_*).
int(float stnum) getstati = #330;
// pr_ext.c:7909's own doc comment: punning helper to read a stat as a float
// without tripping fteqcc's itof-denormal warning on a plain int->float cast.
#define getstati_punf(stnum) (float)(__variant)getstati(stnum)
// pr_ext.c:7910 — reads an EV_FLOAT stat, optionally a bitfield slice of it.
float(float stnum, optional float firstbit, optional float bitcount) getstatf = #331;
// pr_ext.c:7911 — reads an EV_STRING stat (separate pool from numeric stats).
string(float stnum) getstats = #332;

// pr_ext.c:7918 — prints into the center of the screen (like ssqc centerprint).
void(string s, ...) cprint = #338;
// pr_ext.c:7919 — unconditional console print, even in ssqc.
void(string s, ...) print = #339;

// pr_ext.c:7921-7923 — QC key codes (DP's numbering) <-> engine key names and bindings.
string(float keynum) keynumtostring = #340;
float(string keyname) stringtokeynum = #341;
string(float keynum) getkeybind = #342;

// pr_ext.c:7924-7925 — cursor mode. TRUE releases the mouse (pointer lock off, CSIE_MOUSEABS
// events in virtual canvas units), FALSE grabs it again for looking. The cursor image arguments
// are accepted and ignored — draw your own cursor. getcursormode is name-bound (#0 in QSS's table).
void(float usecursor, optional string cursorimage, optional vector hotspot, optional float scale) setcursormode = #343;
float(optional float effective) getcursormode = #0;

// pr_ext.c:7927 — looks up a logged input frame into the input_* globals (WP4.2).
float(float inputsequencenum) getinputstate = #345;

// pr_ext.c:7928 — temporary multiplier on mouse look sensitivity (for zoom), never saved to the cvar.
void(float sens) setsensitivityscaler = #346;

// pr_ext.c:7930 — a scoreboard field for a player slot ("name", "frags", "ping", ...).
string(float playernum, string keyname) getplayerkeyvalue = #348;
// pr_ext.c:7932-7933 — demo playback / listen-server tests (isserver: 0.5 when singleplayer).
float() isdemo = #349;
float() isserver = #350;
// pr_ext.c:7934 — overrides the audio listener for this video frame.
void(vector origin, vector forward, vector right, vector up, optional float reverbtype) SetListener = #351;

// pr_ext.c:7936 — registers a console command; unhandled invocations reach
// CSQC_ConsoleCommand.
void(string cmdname) registercommand = #352;

// pr_ext.c:7938 — a serverinfo key; only "constate" is answerable on NQ.
string(string key) serverkey = #354;
// pr_ext.c:7940 — walks the map's entity lump one token at a time.
string(optional string resetstring) getentitytoken = #355;

// pr_ext.c:8079 — reads a field off an engine-owned render entity (nogameaccess-gated).
__variant(float entnum, float fieldnum) getentity = #504;

// pr_ext.c:7943 — invokes CSEv_<evname>_<evargs> serverside; evargs chars:
// v=vector e=entity(.entnum sent) f=float i=int, max 6 args.
void(string evname, string evargs, ...) sendevent = #359;

// pr_ext.c:7944-7957 — read the current network message's cursor, exactly
// mirroring what an SSQC SendEntity/WriteFoo call wrote for this entity.
// Under-reading or over-reading desyncs the rest of the message (same
// footgun as vanilla read/write builtin pairing).
float() readbyte = #360;
float() readchar = #361;
float() readshort = #362;
float() readlong = #363;
float() readcoord = #364;
float() readangle = #365;
string() readstring = #366;
float() readfloat = #367;
float() readentitynum = #368;

// docs/fte-support-plan.md §4 WP-F3 — string buffers (DP_QC_STRINGBUFFERS) and the separator
// tokenizer, at fte's csqc numbers (fteqw/engine/client/pr_csqc.c:7205-7214 and :7234). argv
// is the same #442 tokenize/tokenizebyseparator both feed.
float() buf_create = #460;
void(float bufhandle) buf_del = #461;
float(float bufhandle) buf_getsize = #462;
string(float bufhandle, string glue) buf_implode = #465;
string(float bufhandle, float string_index) bufstr_get = #466;
float(float bufhandle, string str, float order) bufstr_add = #468;
float(string s, string separator1, ...) tokenizebyseparator = #479;
string(float idx) argv = #442;

#pragma noref 0
