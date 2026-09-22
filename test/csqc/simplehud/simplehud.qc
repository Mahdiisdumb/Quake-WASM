/*
simplehud.qc — WP1.5 fixture: "simple CSQC" tier only (CSQC_DrawHud /
CSQC_DrawScores). No CSQC_UpdateView, no entity stream, no input hooks —
this is the QSS "no protocol extensions, no trust needed" tier described in
docs/csqc-plan.md section 1. Ground truth: load this csprogs.dat in QSS
itself and compare against our engine once WP1.4 lands the sbar integration.

Each drawn element below is a single-builtin exercise; see the comment above
each block for exactly what correct output should look like.
*/

void(float apilevel, string enginename, float engineversion) CSQC_Init =
{
	// Recognizable banner — grep the console log for this exact string to
	// confirm CSQC_Init actually ran (and ran only once per csprogs load).
	print("^2[simplehud] CSQC_Init: banner ok, apilevel/enginename/engineversion received\n");

	// Exercises #317 precache_pic: forces the face pic to load so
	// CSQC_DrawHud's drawpic call below is guaranteed to hit a cached pic
	// rather than the engine's not-found placeholder. "gfx/face1" is the
	// DP wad-lump convention (gfx/ prefix, no extension -> gfx.wad lump
	// FACE1, the vanilla sbar face) - there is NO gfx/sb_face1.lmp file
	// in id1, QSS draws nothing for that name too.
	precache_pic("gfx/face1");
};

void() CSQC_Shutdown =
{
	print("^2[simplehud] CSQC_Shutdown\n");
};

void(vector virtsize, float showscores) CSQC_DrawHud =
{
	local float health, ammo;
	local vector pos, sz, barsize;
	local float barw;

	// (a) getstatf x2: STAT_HEALTH and STAT_AMMO drawn as plain numbers.
	// getstatf, NOT getstati_punf: vanilla stats are engine-encoded ints, so the
	// pun-cast would reinterpret int bits as float garbage — punf is only for
	// custom stats a mod registered as EV_FLOAT (clientstat). Correct output: two
	// strings in the top-left reading e.g. "HP:100" and "AMMO:25" that track the
	// player's live health/ammo (compare visually against the engine sbar).
	health = getstatf(STAT_HEALTH);
	ammo = getstatf(STAT_AMMO);
	drawstring('8 8 0', strcat("HP:", ftos(health)), '8 8 0', '1 1 1', 1, 0);
	drawstring('8 20 0', strcat("AMMO:", ftos(ammo)), '8 8 0', '1 1 1', 1, 0);

	// (b) drawfill: a health bar whose width is proportional to health/100,
	// clamped to [0,100] so overheal/negative health don't invert the box.
	// Correct output: a green bar starting at x=8 that visibly shortens as
	// health drops, drawn over a full-width dim-red background bar so the
	// "missing health" portion is visible too.
	barw = health;
	if (barw < 0) barw = 0;
	if (barw > 100) barw = 100;
	pos = '8 36 0';
	barsize_x = barw;
	barsize_y = 8;
	barsize_z = 0;
	drawfill(pos, '100 8 0', '0.3 0 0', 1, 0);			// full-width backdrop
	drawfill(pos, barsize, '0 0.8 0', 1, 0);			// live portion

	// (c) drawstring: a plain label, independent of any stat, so a text
	// rendering regression is visible even with no gameplay stats changing.
	drawstring('8 48 0', "simplehud fixture", '8 8 0', '1 1 0', 1, 0);

	// (d) drawpic: stock face pic, precached in CSQC_Init. Correct output:
	// the vanilla sbar face icon appears at the given position, unscaled
	// distortion aside, same as the engine's own sbar face draw.
	drawpic('8 60 0', "gfx/face1", '24 24 0', '1 1 1', 1, 0);

	// (e) drawsetcliparea / drawresetcliparea: deliberately draw a fill
	// LARGER than the clip rect so the clip is unambiguous in a screenshot.
	// Correct output: only a 40x10 orange rectangle at (8,96) is visible —
	// the requested fill is 200x10, so if clipping is broken you'll see the
	// full 200px-wide bar instead of the clipped 40px one.
	drawsetcliparea(8, 96, 40, 10);
	drawfill('8 96 0', '200 10 0', '1 0.5 0', 1, 0);
	drawresetcliparea();
	// Sentinel drawn AFTER the reset, to the right of the clip test: if
	// drawresetcliparea failed to restore full-screen clipping, this string
	// would itself be clipped away.
	drawstring('56 96 0', "clip-ok", '8 8 0', '1 1 1', 1, 0);

	// (f) virtsize-driven layout: right-aligned marker using the HUD's
	// virtual canvas size (see docs/csqc-plan.md design decision 7 — this
	// is CANVAS_CSQC space, not raw pixels). Correct output: "V" sits near
	// the top-right corner of the HUD at every window size / scr_sbarscale
	// value; if virtsize is wrong (e.g. raw pixel size leaking through
	// unscaled, or stale), the marker drifts off-screen or away from the
	// corner as the window is resized.
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

	// Minimal scoreboard placeholder. Correct output: this single line
	// appears centered-ish near the top of the screen only while the
	// scoreboard key (+showscores) is held, and disappears when released.
	pos_x = virtsize_x * 0.5 - 40;
	pos_y = 4;
	pos_z = 0;
	drawstring(pos, "SCOREBOARD PLACEHOLDER", '8 8 0', '1 1 1', 1, 0);
};
