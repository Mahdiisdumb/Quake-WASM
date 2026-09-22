/*
ssqc.qc — the WP3.2 server-side fixture mod (docs/csqc-plan.md Phase 3).

A minimal but playable progs.dat whose only interesting content is one
`csqc_echo` entity networked through .SendEntity, two custom stats (WP3.4) and
the CSEv_test_f event handler that answers the client's sendevent with a
cgamepacket (WP3.5). Everything else is the smallest set of engine entry
points a progs.dat must provide.

Wire format written by csqc_echo_send — MUST stay identical to what
test/csqc/full/full.qc's CSQC_Ent_Update reads (full.qc:222-250):

    byte   modelindex
    short  drawmask
    coord  origin_x
    coord  origin_y
    coord  origin_z

Correct behaviour once WP3.3 lands the client parse:
  - joining a server running this mod, the client's CSQC_Ent_Update fires once
    with isnew TRUE, then roughly once a second with isnew FALSE as the echo
    entity slides along +X and re-flags .SendFlags;
  - the echo entity never appears in the ordinary entity stream (the engine
    claims it for csqc), so with test/csqc/full/csprogs.dat loaded it is drawn
    only by the addentities(MASK_NORMAL) pass;
  - remove()ing it (or leaving its pvs) produces a CSQC_Ent_Remove.

Usage: build with fteqcc (see ../README.md), drop the resulting progs.dat into
a game dir together with test/csqc/full/csprogs.dat, and start any map.
*/

//====================================================================
// The csqc echo entity.
//====================================================================
entity csqc_echo;

// .SendEntity — run by the server once per client per datagram, for as long as
// the engine has changed-bits pending for this entity. `changedflags` carries
// the accumulated .SendFlags (all 24 usable bits on the first update, so a new
// client always gets a complete state). Returning FALSE tells the engine not to
// send this entity to this client at all.
float(entity to, float changedflags) csqc_echo_send =
{
	WriteByte(MSG_ENTITY, self.modelindex);
	WriteShort(MSG_ENTITY, self.drawmask);
	WriteCoord(MSG_ENTITY, self.origin_x);
	WriteCoord(MSG_ENTITY, self.origin_y);
	WriteCoord(MSG_ENTITY, self.origin_z);
	return TRUE;
};

// Move once a second and flag the change, so updates keep flowing. Setting
// .SendFlags is the only thing that makes the engine re-run SendEntity — the
// engine zeroes it again after every client's datagram has been built.
void() csqc_echo_think =
{
	self.origin_x = self.origin_x + 16;
	if (self.origin_x > 512)
		self.origin_x = -512;
	self.SendFlags = 1;			// bit 0 == "origin changed", by this mod's convention
	self.nextthink = time + 1;
};

void() csqc_echo_spawn =
{
	csqc_echo = spawn();
	csqc_echo.classname = "csqc_echo";
	csqc_echo.movetype = MOVETYPE_NONE;
	csqc_echo.solid = SOLID_NOT;
	// A real modelindex, so the fixture also proves the engine SKIPS this entity in
	// the ordinary entity write rather than merely tolerating a model-less one.
	setmodel(csqc_echo, "progs/armor.mdl");
	setorigin(csqc_echo, '0 0 64');
	csqc_echo.drawmask = MASK_NORMAL;
	// Stay networked wherever the player stands — this fixture is about the stream, not
	// about pvs culling. IGNOREPVS skips the visibility test, NOREMOVE stops the engine
	// flagging a remove if it ever does drop out. Clear this field to exercise the
	// out-of-pvs remove path instead.
	csqc_echo.pvsflags = PVSF_IGNOREPVS | PVSF_NOREMOVE;
	csqc_echo.SendEntity = csqc_echo_send;
	csqc_echo.SendFlags = 1;
	csqc_echo.think = csqc_echo_think;
	csqc_echo.nextthink = time + 1;
};

//====================================================================
// WP3.4 custom stats.
//
// Two registrations, both on player-edict fields so each client is sent its own
// value. Correct behaviour once the client half is in:
//   - getstatf(100) counts up by 0.25 per player frame. The quarter step is
//     deliberate: on integral values the engine picks the compact byte encoding
//     (svcdp_updatestatbyte), on the three fractional quarters it has to fall
//     back to svcfte_updatestatfloat, so one fixture exercises both. It also
//     shows the wire is delta-driven — nothing is sent on a frame where the
//     value happens not to move.
//   - getstats(101) reads back "hello-csqc", sent exactly once per connection
//     (a string stat only goes out when its content actually changes).
// Both stat numbers are >= 32, so neither reaches a client that did not
// negotiate PEXT1_CSQC.
//====================================================================
void() csqc_stats_register =
{
	clientstat(STAT_FIXTURE_COUNTER, EV_FLOAT, csqc_counter);
	clientstat(STAT_FIXTURE_LABEL, EV_STRING, csqc_label);
};

//====================================================================
// WP3.5 client->server event + cgamepacket reply.
//
// test/csqc/full/full.qc's CSQC_ConsoleCommand calls sendevent("test", "f", 1)
// when "csqc_test" is typed at the console. The engine mangles that into
// CSEv_test_f — the event name, then one letter per argument type — and calls
// it with `self` bound to the client that sent it.
//
// The reply goes back the other way as an svcfte_cgamepacket: the payload is
// staged in the MSG_MULTICAST buffer with SVC_CGAMEPACKET as its first byte,
// and multicast() then delivers it only to clients that negotiated PEXT1_CSQC
// (a client without csqc could not parse the svc at all). MULTICAST_ONE_R
// unicasts to whoever `msg_entity` names.
//
// Reply wire format, which full.qc's CSQC_Parse_Event must read exactly:
//     byte   7            fixture tag, so a mis-wired payload is obvious
//     coord  f            the float that came in, echoed back
// (a coord and not a float: vanilla NQ has no WriteFloat builtin — #58 is
// WriteString — and readcoord/WriteCoord is the matched pair.)
//====================================================================
void(float f) CSEv_test_f =
{
	sprint(self, "[ssqc] CSEv_test_f: f=");
	sprint(self, ftos(f));
	sprint(self, ", replying with a cgamepacket\n");

	msg_entity = self;
	WriteByte(MSG_MULTICAST, SVC_CGAMEPACKET);
	WriteByte(MSG_MULTICAST, 7);
	WriteCoord(MSG_MULTICAST, f);
	multicast('0 0 0', MULTICAST_ONE_R);
};

//====================================================================
// Engine entry points.
//====================================================================
void() worldspawn =
{
	precache_model("progs/player.mdl");
	precache_model("progs/armor.mdl");
	precache_sound("demon/dland2.wav");	// engine falls-back sound is not guaranteed; keep one

	lightstyle(0, "m");
	lightstyle(1, "mmnmmommommnonmmonqnmmo");
	lightstyle(2, "abcdefghijklmnopqrstuvwxyzyxwvutsrqponmlkjihgfedcba");
	lightstyle(3, "mmmmmaaaaammmmmaaaaaabcdefgabcdefg");
	lightstyle(63, "a");

	csqc_echo_spawn();
	csqc_stats_register();
};

// Map marker entities. Anything else in the .bsp gets "no spawn function" and is
// dropped by the engine, which is fine for a fixture.
void() info_player_start = { };
void() info_player_deathmatch = { };
void() light = { remove(self); };

void() main = { };

void() StartFrame = { };

void() PlayerPreThink =
{
	self.csqc_counter = self.csqc_counter + 0.25;
};

void() PlayerPostThink = { };

void() SetNewParms =
{
	parm1 = 0; parm2 = 0; parm3 = 0; parm4 = 0;
	parm5 = 0; parm6 = 0; parm7 = 0; parm8 = 0;
	parm9 = 0; parm10 = 0; parm11 = 0; parm12 = 0;
	parm13 = 0; parm14 = 0; parm15 = 0; parm16 = 0;
};

void() SetChangeParms = { SetNewParms(); };

void() ClientConnect =
{
	bprint(self.netname);
	bprint(" entered the game\n");
};

void() ClientDisconnect =
{
	bprint(self.netname);
	bprint(" left the game\n");
};

void() PutClientInServer =
{
	local entity spot;

	self.classname = "player";
	// The two WP3.4 custom stats' backing fields. Fresh per spawn, so the counter
	// restarts and the label is re-sent on every respawn.
	self.csqc_counter = 0;
	self.csqc_label = "hello-csqc";
	self.health = 100;
	self.max_health = 100;
	self.takedamage = 0;
	self.solid = SOLID_SLIDEBOX;
	self.movetype = MOVETYPE_WALK;
	self.flags = FL_CLIENT;
	self.deadflag = DEAD_NO;
	self.view_ofs = '0 0 22';
	self.velocity = '0 0 0';
	setmodel(self, "progs/player.mdl");
	setsize(self, '-16 -16 -24', '16 16 32');

	spot = find(world, classname, "info_player_start");
	if (spot != world)
	{
		setorigin(self, spot.origin + '0 0 1');
		self.angles = spot.angles;
	}
	else
		setorigin(self, '0 0 32');
	self.fixangle = TRUE;
};

void() ClientKill = { };
