/*
full.qc — WP1.5 fixture: "full CSQC" tier (CSQC_UpdateView owns the screen,
client-side edicts, CSQC_Ent_Update entity stream, sendevent, input hooks).
Everything in ../simplehud/simplehud.qc is duplicated here too (per the
WP1.5 task: "everything in simplehud plus...") so this single csprogs.dat
exercises the complete surface Phases 2-4 will build against. Ground truth:
load this csprogs.dat in QSS itself and diff behavior against our engine as
each later phase lands (docs/csqc-plan.md WP2.1-WP4.3).

Each hook below documents what correct output/behavior looks like.
*/

float csqc_test_seen;		// set by CSQC_ConsoleCommand, read nowhere else —
							// just a landing pad you can inspect from the QC
							// debugger / a later "print csqc_test_seen" probe.
float inputevent_count;	// caps CSQC_InputEvent's key spam to a few lines.
float inputmouse_count;	// ...and its mouse spam separately (mouse motion is
						// far chattier than the keyboard, so one shared cap
						// would be used up before you pressed anything).

//====================================================================
// WP2.1 — client-side edicts, the csqc physics pass and world traces.
// physics_mode 1 (set in CSQC_Init) is the "run thinks, don't move
// anything" pass (QSS sv_phys.c:1545). Correct output: one think line
// roughly every 2 seconds of client time, the first 3 of them carrying a
// traceline result taken against the CLIENT VM's own world — a fraction
// below 1 with an endpos on a surface proves the trace ran on the csqc
// areanode tree/worldmodel, and the rising `time` proves the VM clock
// advances. Nothing here needs a server: it is all client-side.
// The trace starts high above the map origin rather than at the view
// origin because getproperty(VF_ORIGIN) is a WP2.2 builtin.
//====================================================================
entity csqc_thinker;
float think_prints;

// One-shot trigger for the WP3.5 round trip. CSQC_ConsoleCommand is the intended
// way in (type "csqc_test"), but registercommand/CSQC_ConsoleCommand is WP4.3 —
// until that lands the console command never reaches the progs, so the first
// think fires the same sendevent instead. Both paths call it identically.
float csqc_event_sent;

// WP-F3 breadth check (docs/fte-support-plan.md §4). Correct output, exactly once:
//   [full] WP-F3: size=2 get1=beta implode=alpha,beta tok=3 argv1=b
// size/get1/implode prove the strbuf create->add->get->implode->del round trip (handles are
// 1-based, so a 0 here means buf_create failed); tok/argv1 prove tokenizebyseparator split on
// the given separator and fed the shared argv machinery.
float wpf3_done;

//====================================================================
// WP-PHY — VM-generic physics: physics_mode 2 runs the FULL movetype
// pass on the csqc VM (QSS sv_phys.c:1556+), not just thinks. A
// MOVETYPE_BOUNCE ball dropped 200 above the VIEW origin (the thinker's
// '0 0 4096' anchor is void on most maps — a ball there falls forever)
// must fall under sv_gravity and come to rest (FL_ONGROUND, velocity
// zeroed by the ground-stop in physics_Toss). Correct output: a few
// `bounce z=` lines with FALLING z, then exactly one `bounce RESTED`
// near the player's floor height; plus exactly one
// `EndFrame alive` line — QSS only calls EndFrame in mode 2
// (sv_phys.c:1644), so that line ALSO proves the mode took effect.
//====================================================================
// not in our csqcdefs.qc transcription - vanilla values
float MOVETYPE_BOUNCE = 10;
float SOLID_BBOX = 2;
float FL_ONGROUND = 512;
void(vector ang) makevectors = #1;

entity phys_ball;
float ball_rested;
float ball_prints;
float endframe_seen;
entity lerp_ent;	// WP-REND: the tinted explicit-lerp flame (see CSQC_UpdateView)
vector last_vieworg;	// captured by CSQC_UpdateView; '0 0 0' until the first rendered frame

void() EndFrame =
{
	if (endframe_seen)
		return;
	endframe_seen = 1;
	print("^2[full] WP-PHY: EndFrame alive (mode 2)\n");
};

void() ball_think =
{
	self.nextthink = time + 0.25;
	if (self.flags & FL_ONGROUND)
	{
		ball_rested = 1;
		self.nextthink = 0;
		print(strcat("^2[full] WP-PHY: bounce RESTED z=", ftos(self.origin_z), "\n"));
		return;
	}
	// once a second, not every think - the drop takes ~10s of bouncing to settle
	ball_prints = ball_prints + 1;
	if (!(ball_prints & 3))
		print(strcat("^2[full] WP-PHY: bounce z=", ftos(self.origin_z), "\n"));
};

void() csqc_test_think =
{
	self.nextthink = time + 2;

	// Spawned from a think, not CSQC_Init, so the csqc worldmodel is guaranteed live for the
	// ball's movetype traces; waits for a rendered frame so the view origin anchor is real.
	if (!phys_ball && last_vieworg != '0 0 0')
	{
		phys_ball = spawn();
		setorigin(phys_ball, last_vieworg + '0 0 200');
		setsize(phys_ball, '-4 -4 -4', '4 4 4');
		phys_ball.movetype = MOVETYPE_BOUNCE;
		phys_ball.solid = SOLID_BBOX;
		phys_ball.think = ball_think;
		phys_ball.nextthink = time + 0.25;
	}

	if (!wpf3_done)
	{
		local float b, n;
		wpf3_done = 1;
		b = buf_create();
		bufstr_add(b, "alpha", TRUE);
		bufstr_add(b, "beta", TRUE);
		n = tokenizebyseparator("a:b:c", ":");
		print(strcat("^5[full] WP-F3: size=", ftos(buf_getsize(b)), " get1=", bufstr_get(b, 1)));
		print(strcat(" implode=", buf_implode(b, ","), " tok=", ftos(n), " argv1=", argv(1), "\n"));
		buf_del(b);
	}

	if (!csqc_event_sent)
	{
		csqc_event_sent = 1;
		print("^5[full] think: sending test event\n");
		sendevent("test", "f", 1);
	}

	if (think_prints >= 3)
		return;
	think_prints = think_prints + 1;
	traceline(self.origin, self.origin - '0 0 8192', FALSE, self);
	print(strcat("^2[full] think: time=", ftos(time), " frac=", ftos(trace_fraction)));
	print(strcat(" endpos=", vtos(trace_endpos), "\n"));
};

void(float apilevel, string enginename, float engineversion) CSQC_Init =
{
	print("^2[full] CSQC_Init: banner ok, apilevel/enginename/engineversion received\n");
	precache_pic("gfx/face1");	// wad-lump convention - see simplehud.qc
	precache_model("progs/flame.mdl");	// WP-REND explicit-lerp/colormod fixture

	// registercommand + CSQC_ConsoleCommand round trip (see below): typing
	// "csqc_test" at the console should hit CSQC_ConsoleCommand instead of
	// falling through to "unknown command".
	registercommand("csqc_test");

	csqc_test_seen = 0;
	csqc_event_sent = 0;
	inputevent_count = 0;

	// 2 = the full movetype pass (thinks AND movement AND EndFrame - see WP-PHY above).
	// 0 (the engine default for csqc) would only advance the clock; 1 runs thinks only.
	physics_mode = 2;
	think_prints = 0;
	csqc_thinker = spawn();
	setorigin(csqc_thinker, '0 0 4096');
	csqc_thinker.think = csqc_test_think;
	csqc_thinker.nextthink = time + 2;
};

void() CSQC_Shutdown =
{
	print("^2[full] CSQC_Shutdown\n");
};

//====================================================================
// Simple-tier HUD (identical intent to simplehud.qc — see that file for
// the full per-element correctness notes). Full CSQC must draw its own HUD
// since CSQC_UpdateView below skips the engine sbar entirely.
//====================================================================
void(vector virtsize, float showscores) CSQC_DrawHud =
{
	local float health, ammo;
	local vector pos, sz, barsize;
	local float barw;

	// getstatf, not getstati_punf: vanilla stats are ints, the pun-cast is only
	// valid for mod-registered EV_FLOAT stats (see simplehud.qc).
	health = getstatf(STAT_HEALTH);
	ammo = getstatf(STAT_AMMO);
	drawstring('8 8 0', strcat("HP:", ftos(health)), '8 8 0', '1 1 1', 1, 0);
	drawstring('8 20 0', strcat("AMMO:", ftos(ammo)), '8 8 0', '1 1 1', 1, 0);

	barw = health;
	if (barw < 0) barw = 0;
	if (barw > 100) barw = 100;
	pos = '8 36 0';
	barsize_x = barw;
	barsize_y = 8;
	barsize_z = 0;
	drawfill(pos, '100 8 0', '0.3 0 0', 1, 0);
	drawfill(pos, barsize, '0 0.8 0', 1, 0);

	drawstring('8 48 0', "full-csqc fixture", '8 8 0', '1 1 0', 1, 0);
	drawpic('8 60 0', "gfx/face1", '24 24 0', '1 1 1', 1, 0);

	drawsetcliparea(8, 96, 40, 10);
	drawfill('8 96 0', '200 10 0', '1 0.5 0', 1, 0);
	drawresetcliparea();
	drawstring('56 96 0', "clip-ok", '8 8 0', '1 1 1', 1, 0);

	// WP3.4 extended stats, fed by ../ssqc/ssqc.qc's clientstat registrations.
	// Correct output with that progs.dat running: "STAT100:" counting up in 0.25
	// steps once per player frame, and "STAT101:hello-csqc" standing still. Both
	// stat numbers are >= 32, so both read back 0/"" against any server that did
	// not negotiate PEXT1_CSQC (or any mod that does not register them) — which is
	// itself the check that the gate holds.
	drawstring('8 110 0', strcat("STAT100:", ftos(getstatf(100))), '8 8 0', '0 1 1', 1, 0);
	drawstring('8 122 0', strcat("STAT101:", getstats(101)), '8 8 0', '0 1 1', 1, 0);

	sz = '8 8 0';
	pos_x = virtsize_x - 16;
	pos_y = 8;
	pos_z = 0;
	drawstring(pos, "V", sz, '1 1 1', 1, 0);
};

void(vector virtsize, float showscores) CSQC_DrawScores =
{
	local vector pos;

	if (!showscores)
		return;

	pos_x = virtsize_x * 0.5 - 40;
	pos_y = 4;
	pos_z = 0;
	drawstring(pos, "SCOREBOARD PLACEHOLDER", '8 8 0', '1 1 1', 1, 0);
};

//====================================================================
// CSQC_UpdateView — full tier owns the whole screen. Correct output: the
// normal 3D view still renders (MASK_ENGINE re-adds every engine-owned
// entity QSS would otherwise draw itself), AND the HUD from CSQC_DrawHud
// above is composited on top in the same frame — if either half is
// missing, the view is either blank/HUD-less or the world doesn't render.
//====================================================================
void(float vwidth, float vheight, float notmenu) CSQC_UpdateView =
{
	local vector vorg, vang, virtsize;

	clearscene();

	// Re-adds every entity the engine itself would have drawn (players,
	// monsters, world brushes, temp entities, ...) — this is what makes a
	// full-CSQC UpdateView that does nothing else pixel-equivalent to the
	// vanilla view. MASK_ENGINE does NOT cover the player's own weapon model
	// (QSS PF_cs_addentities, pr_ext.c:6752): MASK_VIEWMODEL is the separate
	// opt-in bit, and a mod wanting the vanilla view asks for both.
	addentities(MASK_ENGINE | MASK_VIEWMODEL);

	// setproperty/getproperty round-trip: read the engine's current view
	// origin/angles back out, then set them again unchanged. This is a
	// no-op visually, but exercises both builtins together — if either is
	// broken (e.g. getproperty returns stale/zeroed data, or setproperty
	// silently no-ops) the round-trip result will visibly diverge from the
	// unmodified default view.
	vorg = getproperty(VF_ORIGIN);
	vang = getproperty(VF_ANGLES);
	last_vieworg = vorg;	// anchors the WP-PHY bounce ball to playable space
	setproperty(VF_ORIGIN, vorg);
	setproperty(VF_ANGLES, vang);

	// WP-REND — explicit lerp + colormod: a GREEN-tinted flame floats ~96 units ahead of the
	// camera, animating through its framegroup on .frame1time (the LERP_EXPLICIT group path,
	// QSS r_alias.c:804-825). Correct output: a green flame in view wherever you look; a WHITE
	// or motionless flame means colormod / the explicit path regressed.
	if (!lerp_ent)
	{
		lerp_ent = spawn();
		setmodel(lerp_ent, "progs/flame.mdl");
		lerp_ent.colormod = '0.2 2 0.2';
		lerp_ent.lerpfrac = 0;		// frame 0's group is the "stronger" sequence
		print("^2[full] WP-REND: tinted explicit-lerp flame up\n");
	}
	makevectors(vang);
	setorigin(lerp_ent, vorg + v_forward * 96);
	lerp_ent.frame1time = time;		// group-path clock - drives the animation
	addentity(lerp_ent);

	renderscene();

	// Full CSQC must draw its own HUD — CSQC_DrawHud is not auto-invoked by
	// the engine sbar once CSQC_UpdateView exists (see docs/csqc-plan.md
	// WP1.4 early-out / WP2.3 sbar-skip).
	virtsize_x = vwidth;
	virtsize_y = vheight;
	virtsize_z = 0;
	CSQC_DrawHud(virtsize, FALSE);
};

//====================================================================
// CSQC_InputEvent — logs the first few input events then returns FALSE so
// every event still falls through to the engine's normal handling (binds,
// console toggle, view turning, etc). Correct behavior: the console shows
// the first 5 key events (evtype 0/1, scanx = the DP key code — 512 for
// mouse1, 515/516 for the wheel, 27 for escape; chary = the typed
// character on key-down) and the first 3 mouse events (evtype 2 with the
// pointer-lock deltas, or evtype 3 with virtual-canvas positions while a
// mod holds setcursormode), and nothing after that. Engine binds, escape
// and mouse look all keep working because this returns FALSE.
//====================================================================
float(float evtype, float scanx, float chary, float devid) CSQC_InputEvent =
{
	if (evtype == IE_KEYDOWN || evtype == IE_KEYUP)
	{
		if (inputevent_count < 5)
		{
			inputevent_count = inputevent_count + 1;
			print(strcat("^3[full] CSQC_InputEvent: evtype=", ftos(evtype), " scanx=", ftos(scanx)));
			print(strcat(" chary=", ftos(chary), " devid=", ftos(devid), "\n"));
		}
	}
	else if (inputmouse_count < 3)
	{
		inputmouse_count = inputmouse_count + 1;
		print(strcat("^3[full] CSQC_InputEvent: evtype=", ftos(evtype), " x=", ftos(scanx)));
		print(strcat(" y=", ftos(chary), " devid=", ftos(devid), "\n"));
	}
	return FALSE;
};

//====================================================================
// CSQC_Input_Frame — runs once per move the client sends (full tier only;
// the simple tier has this entry point zeroed at load, so seeing the line
// below on a simple-csqc progs would be a bug). The engine publishes the
// move into the input_* globals just before writing it to the wire and
// reads them back afterwards, so anything assigned here is what the server
// receives.
//
// Correct output: exactly ONE line, the first time a move is sent
// (~immediately after the level loads). Any repeat means the one-shot guard
// isn't holding — i.e. the progs was reloaded.
//
// To verify the read-back by hand, uncomment the invert below and recompile:
// walking forward then drives the player backwards (and back/forward swap),
// because forwardmove is negated after the engine composed it. It is left
// commented out on purpose — an always-on invert would make every other
// fixture check in this file (and the entity/event round trips) miserable to
// drive.
//====================================================================
float inputframe_seen;

void() CSQC_Input_Frame =
{
	if (!inputframe_seen)
	{
		inputframe_seen = 1;
		print("^3[full] CSQC_Input_Frame: live\n");
	}

//	input_movevalues_x = -input_movevalues_x;
};

//====================================================================
// CSQC_ConsoleCommand — pairs with registercommand("csqc_test") above.
// Correct behavior: typing "csqc_test" prints the banner line below, then
// sendevent("test", "f", 1) reaches CSEv_test_f in test/csqc/ssqc/ssqc.qc,
// which sprints its own line back and replies with a cgamepacket that
// CSQC_Parse_Event (below) prints. Three lines, in that order. Any other
// command string falls through (return FALSE) to the engine's normal
// command dispatch.
//====================================================================
float(string cmdstr) CSQC_ConsoleCommand =
{
	if (cmdstr == "csqc_test")
	{
		print("^5[full] CSQC_ConsoleCommand: csqc_test recognized, sending event\n");
		csqc_test_seen = 1;
		sendevent("test", "f", 1);
		return TRUE;
	}
	return FALSE;
};

//====================================================================
// CSQC_Parse_Event — the other half of the sendevent round trip: an
// svcfte_cgamepacket the server multicast to us, read back with the same
// read* builtins CSQC_Ent_Update uses (there is no length prefix, so this
// must consume exactly what CSEv_test_f wrote or the rest of the server
// message is garbage).
//
// Wire format written by ssqc.qc's CSEv_test_f:
//   byte   7        fixture tag
//   coord  f        the float the event carried, echoed back
//====================================================================
void() CSQC_Parse_Event =
{
	local float tag, f;

	tag = readbyte();
	f = readcoord();

	if (tag != 7)
	{
		print(strcat("^1[full] CSQC_Parse_Event: unexpected tag ", ftos(tag), "\n"));
		return;
	}
	print(strcat("^5[full] CSQC_Parse_Event: got ", ftos(f), "\n"));
};

//====================================================================
// CSQC_Parse_CenterPrint — intercepts every centerprint, prefixes it, and
// re-displays it via cprint (the CSQC-side "print to center of screen"
// builtin) instead of letting the engine draw its own. Correct behavior:
// every server centerprint appears on screen prefixed with "[csqc] "
// exactly once (not twice — returning TRUE must suppress the engine's own
// centerprint draw, per docs/csqc-plan.md WP4.3).
//====================================================================
float(string msg) CSQC_Parse_CenterPrint =
{
	cprint(strcat("[csqc] ", msg));
	return TRUE;
};

//====================================================================
// CSQC_Ent_Update / CSQC_Ent_Remove — the echo-entity round trip other
// phases build on. Wire format (must exactly match whatever SendEntity
// writes server-side, once a companion ssqc fixture exists per WP3.2):
//   byte   modelindex
//   short  drawmask
//   coord  origin_x
//   coord  origin_y
//   coord  origin_z
// Correct behavior: a new csqc edict appears at the streamed origin with
// the streamed modelindex/drawmask; on later updates for the same entnum,
// isnew is FALSE and only the fields change (no duplicate edict); removal
// frees the edict cleanly (no dangling .predraw calls afterward).
//====================================================================
void(float isnew) CSQC_Ent_Update =
{
	local float mi, dm;

	mi = readbyte();
	dm = readshort();
	self.origin_x = readcoord();
	self.origin_y = readcoord();
	self.origin_z = readcoord();

	self.modelindex = mi;
	self.drawmask = dm;

	if (isnew)
		print(strcat("^6[full] CSQC_Ent_Update: new entnum=", ftos(self.entnum), "\n"));
};

void() CSQC_Ent_Remove =
{
	remove(self);
};

//====================================================================
// CSQC_Parse_Print — every svc_print the server sends, one COMPLETE line
// at a time (the engine buffers fragments until the newline arrives and
// hands the terminator over with the line). Having this entry point at
// all suppresses the engine's own console print, so the echo below is
// what keeps the console working: correct behavior is that server prints
// look exactly as they did without a csprogs — no doubled lines, no lost
// lines, no lines split in the middle of a word — preceded once by the
// banner. printlvl is a guess the engine makes from the \x01 chat prefix:
// 3 for chat, 2 for everything else (NQ has no print levels on the wire).
//====================================================================
float print_seen;

void(string printmsg, float printlvl) CSQC_Parse_Print =
{
	if (!print_seen)
	{
		print_seen = 1;
		print(strcat("^3[full] CSQC_Parse_Print: live, first lvl=", ftos(printlvl), "\n"));
	}
	print(printmsg);
};

//====================================================================
// CSQC_Parse_StuffCmd — the stufftext lines the engine did not claim for
// itself (it keeps only the handful of commands servers legitimately send
// it, e.g. cl_downloadbegin). The trailing newline is restored before the
// line arrives. The mod is expected to run anything it doesn't recognise
// itself, which is what the localcmd below does — so correct behavior is
// that server stufftexts still take effect, with a log line for the first
// few. Full tier only: the simple tier has this entry point zeroed at
// load, so a line here from a simple-csqc progs would be a bug.
//====================================================================
float stuffcmd_prints;

void(string msg) CSQC_Parse_StuffCmd =
{
	if (stuffcmd_prints < 5)
	{
		stuffcmd_prints = stuffcmd_prints + 1;
		print(strcat("^3[full] CSQC_Parse_StuffCmd: ", msg));
	}
	localcmd(msg);
};

//====================================================================
// CSQC_Parse_Damage — svc_damage, before the engine's red flash and view
// kick. save/take are the armor/health bytes off the wire and dir is the
// RAW world position of the damage source (not a direction: the engine
// turns it into one relative to the view entity after this returns).
// Returning FALSE keeps the engine's own blend and kick, so correct
// behavior is that taking damage looks exactly as it did without a
// csprogs, plus the first 3 hits logging a line.
//====================================================================
float damage_prints;

float(float save, float take, vector dir) CSQC_Parse_Damage =
{
	if (damage_prints < 3)
	{
		damage_prints = damage_prints + 1;
		print(strcat("^3[full] CSQC_Parse_Damage: save=", ftos(save), " take=", ftos(take)));
		print(strcat(" from=", vtos(dir), "\n"));
	}
	return FALSE;
};

//====================================================================
// CSQC_Event_Sound — every svc_sound, before the engine plays it. Full
// tier only (the engine refuses this one to simple csqc: knowing where
// sounds come from is knowing where entities are). Returning nothing
// leaves the engine to play the sound as usual, so correct behavior is
// unchanged audio plus a line for the first 3 sounds.
//====================================================================
float sound_prints;

void(float entnum, float channel, string soundname, float vol, float attenuation, vector pos, float pitchmod, float flags) CSQC_Event_Sound =
{
	if (sound_prints < 3)
	{
		sound_prints = sound_prints + 1;
		print(strcat("^3[full] CSQC_Event_Sound: ", soundname, " ent=", ftos(entnum)));
		print(strcat(" chan=", ftos(channel), " vol=", ftos(vol), " pos=", vtos(pos), "\n"));
	}
};

//====================================================================
// CSQC_Parse_TempEntity — svc_temp_entity, before the engine parses it.
// The message is read with the same read* builtins the entity stream
// uses, and returning FALSE means "not mine": the engine puts the read
// cursor back where this function found it and parses the effect itself.
// This one deliberately reads NOTHING and always returns FALSE, so it
// tests the rewind — correct behavior is that every explosion, spike hit
// and lightning bolt still appears, and nothing after a temp entity in
// the same server message is corrupted. Full tier only.
//====================================================================
float tent_prints;

float() CSQC_Parse_TempEntity =
{
	if (tent_prints < 3)
	{
		tent_prints = tent_prints + 1;
		print("^3[full] CSQC_Parse_TempEntity: declining, engine should parse it\n");
	}
	return FALSE;
};

//====================================================================
// GameCommand — DarkPlaces' pre-CSQC_ConsoleCommand entry point, reached
// through the engine's "cl_cmd <text>" console command. Correct behavior:
// typing `cl_cmd hello world` prints the line below with "hello world".
//====================================================================
void(string cmdtext) GameCommand =
{
	print(strcat("^5[full] GameCommand: ", cmdtext, "\n"));
};
