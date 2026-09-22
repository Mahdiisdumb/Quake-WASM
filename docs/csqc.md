# CSQC (client-side QuakeC)

The engine runs a mod's `csprogs.dat` in a second QC VM alongside the server progs: custom HUDs and
scoreboards, full control of the view and render loop, client-side entities fed by a server-side
`.SendEntity` stream, client→server events, and interception of prints, centerprints, damage,
sounds, temp entities and input.

Reference implementation is **QSS** (QuakeSpasm-Spiked); FTE is the secondary reference where QSS
has no answer. `docs/csqc-plan.md` is the historical implementation plan and records why each
architectural choice was made. Test fixtures with QC sources live in `test/csqc/`.

**FTE-native mods**: everything on this page describes the QSS-compatible CSQC surface, which is
what a mod built against NQ sysdefs gets. A mod whose progs are compiled against FTE's own defs
layout runs through foreign-defs mode and adds a further surface — the FTE builtin tier, polygons
and `shaderforname`, `.glb` models, `SV_ParseClientCommand`, autocvars, delayed precache — plus its
own set of things that are deliberately absent. That is `docs/fte-support.md`, which also documents
`pr_scanprogs` and the load-time gap report for checking any mod against this engine.

## Tiers

| | simple CSQC | full CSQC |
|---|---|---|
| entry points | `CSQC_DrawHud` / `CSQC_DrawScores` (+ the print/damage/input/console hooks) | everything |
| requires | nothing — works against any server on protocol 15/666/999 | `PEXT1_CSQC` negotiated, plus the trust check below |
| owns | the status bar and scoreboard; the 3D view goes fullscreen behind it | the whole screen, via `CSQC_UpdateView` |
| entity stream | no | yes (`enablecsqc` is sent on load) |

The tier is decided per map load, in `csqc.load` (`src/engine/csqc.ts`).

### Trust model

Full tier if **any** of:

- the server advertised a csprogs identity (`csqc_progcrc` / `csqc_progsize` stufftexts) and the
  local file's md4-fold hash **and** byte size both match, or
- demo playback, or
- a local listen server (engine addition — the listen server's csprogs *is* the local file, and a
  player who suppressed pext with `cl_nopext 1` would otherwise be denied a tier they own).

Otherwise simple tier. A simple-tier progs must expose `CSQC_DrawHud` or it is rejected outright,
and `nogameaccess` is set, which means:

- **zeroed at load**: `CSQC_Input_Frame`, `CSQC_UpdateView`, `CSQC_Ent_Update`, `CSQC_Ent_Remove`,
  `CSQC_Parse_StuffCmd`, and the `clientcommandframe` / `servercommandframe` globals.
- **refused at the call site**: `CSQC_Event_Sound`, `CSQC_Parse_TempEntity`, `getproperty` of
  `VF_ORIGIN*` / `VF_ANGLES*` / `VF_CL_VIEWANGLES*`, and `#504 getentity`.

Everything else is fair game for a HUD progs: the draw entry points, all stats, the
print/centerprint/damage hooks, `CSQC_InputEvent`, `CSQC_ConsoleCommand`, `CSQC_Parse_Event`, and
the cursor/sensitivity builtins.

## Entry points

Resolved by name after every load; an absent one is simply not called.

| function | notes |
|---|---|
| `CSQC_Init(isfull, enginename, engineversion)` | `enginename` is `"netquake.io"`, `engineversion` is `1` |
| `CSQC_Shutdown` | on map change, disconnect and clear-state; skipped on the host-error path |
| `CSQC_DrawHud(virtsize, showscores)` | replaces the engine sbar; the 3D view becomes fullscreen |
| `CSQC_DrawScores(virtsize, showscores)` | scoreboard and intermission overlay |
| `CSQC_UpdateView(vwidth, vheight, notmenu)` | full tier; owns the frame |
| `CSQC_UpdateViewLoading` | used instead of `UpdateView` before the signon completes |
| `CSQC_InputEvent(evtype, a, b, devid)` | key down/up (0/1), mouse delta (2), absolute mouse (3); nonzero return swallows |
| `CSQC_Input_Frame` | full tier; rewrites the move about to be sent |
| `CSQC_Ent_Update(isnew)` / `CSQC_Ent_Remove` | full tier; the server entity stream |
| `CSQC_Parse_Event` | `svcfte_cgamepacket` payload; missing function is a fatal error |
| `CSQC_Parse_CenterPrint(msg)` | nonzero return suppresses the engine centerprint |
| `CSQC_Parse_Print(msg, printlvl)` | void; having it at all suppresses the engine print. Called once per completed line; level is guessed from a leading `\x01` (3 = chat, else 2) |
| `CSQC_Parse_StuffCmd(text)` | full tier; only lines the engine's own server-command table did not claim |
| `CSQC_Parse_Damage(save, take, dir)` | nonzero suppresses the engine blend and view kick |
| `CSQC_Event_Sound(...)` | nonzero suppresses the sound; blocked at simple tier |
| `CSQC_Parse_TempEntity` | zero return rewinds the read cursor and the engine parses it; blocked at simple tier |
| `CSQC_ConsoleCommand(text)` | nonzero return means the progs handled the command |
| `GameCommand(text)` | DarkPlaces compatibility, reached through the `cl_cmd` console command |
| `EndFrame` | only under `physics_mode 2` |

Globals published to the progs: `cltime`, `clframetime`, `maxclients`, `intermission`,
`intermission_time`, `player_localnum`, `player_localentnum`, `view_angles`, `clientcommandframe`,
`servercommandframe`, `physics_mode`, and the `input_*` set (`input_sequence`, `input_servertime`,
`input_timelength`, `input_angles`, `input_movevalues`, `input_buttons`, `input_impulse`).
`input_weapon` and the `input_cursor_*` trio are not published — they only reach a server over
`PEXT2_PRYDONCURSOR`, which is not negotiated.

Fields resolved by name on csqc edicts: `.alpha`, `.scale`, `.colormod`, `.tag_entity`,
`.tag_index`, `.modelflags`, `.frame2`, `.lerpfrac`, `.frame1time`, `.frame2time`, `.renderflags`,
`.entnum`, `.drawmask`, `.predraw`, on top of the fixed NQ set (origin, angles, frame, skin, …).
The ones the renderer actually consumes are `.alpha`, `.scale`, `.modelflags`, `.entnum`,
`.drawmask` and `.predraw`; see "Not implemented" for the rest.

## Builtins

Numbers are the standard DP/FTE extension numbers; everything also binds by name through the `#0`
mechanism. The authoritative tables are `src/engine/pfcl.ts` (classic slots, drawing, stats, message
reads, events) and `src/engine/pfcl_scene.ts` (scene/view and queries).

**Classic #1-78** — the VM-generic slots (math, strings, entity iteration, `find`/`findradius`,
`traceline`, `pointcontents`, `setorigin`/`setsize`, `walkmove`, `droptofloor`, `movetogoal`) run
against the csqc VM's own edicts and its own areanode tree. Client substitutions: `#3 setmodel`,
`#8 sound` (negated entity number so csqc channels can't stomp server ones), `#19/#76
precache_sound`, `#20/#75 precache_model`, `#35 lightstyle`, `#48 particle`, `#69 makestatic`,
`#74 ambientsound`. Server-only slots print a one-shot "not available to client progs" warning:
`checkclient`, `stuffcmd`, `bprint`, `sprint`, `aim`, `changelevel`, `centerprint` (use `#338
cprint`), `setspawnparms`, and the whole `Write*` block (`#52-59`).

**2D drawing** — `#316 iscachedpic`, `#317 precache_pic`, `#318 drawgetimagesize`,
`#320 drawcharacter`, `#321 drawrawstring`, `#322 drawpic`, `#323 drawfill`, `#324 drawsetcliparea`,
`#325 drawresetcliparea`, `#326 drawstring`, `#327 stringwidth`, `#328 drawsubpic`, `#338 cprint`,
`#339 print`, `#177 localsound`. Coordinates are in the CSQC virtual canvas (see below).
`drawstring` decodes `^`-markup (colour codes, `^x` RGB, `^h`/`^a`/`^m`/`^d`, the `^^` escape); the
`^U`/`^{` unicode escapes and the `^[` link syntax are not decoded and draw literally. The font is
fixed-width, so `stringwidth` is `fontsize_x × visible glyphs`. Pic loading is asynchronous: a pic
drawn on the frame it is first named silently no-ops and appears once the load lands.

**Stats** — `#330 getstati`, `#331 getstatf` (with the optional `firstbit`/`bitcount` bitfield
form), `#332 getstats`. 256 stats, in three parallel pools (int / float / string). Readable at both
tiers.

**Scene and view** — `#300 clearscene`, `#301 addentities(mask)`, `#302 addentity`,
`#303 setproperty`, `#304 renderscene`, `#305 dynamiclight_add`, `#309 getproperty`,
`#310 unproject`, `#311 project`, `#333 setmodelindex`, `#334 modelnameforindex`,
`#351 SetListener`, `#92 getlight`, `#240 checkpvs`, `#279 touchtriggers`, `#355 getentitytoken`,
`#504 getentity`. `clearscene` seeds the camera from the engine's own view, so a progs that only
calls `renderscene` gets the vanilla frame. `addentities` masks: `MASK_ENGINE` (1) appends the
relinked server entities and temp entities, `MASK_VIEWMODEL` (2) re-enables the viewmodel;
`MASK_NORMAL` (4) is not an engine constant — the whole argument is ANDed against each edict's
`.drawmask`, honouring `.predraw` (nonzero return = the QC drew it itself). Supported viewprops:
`VF_MIN*`, `VF_SIZE*`, `VF_VIEWPORT`, `VF_FOV*`, `VF_ORIGIN*`, `VF_ANGLES*`, `VF_DRAWWORLD`,
`VF_DRAWENGINESBAR`, `VF_DRAWCROSSHAIR`, `VF_MINDIST`/`VF_MAXDIST` (read-only: 4 and 65536),
`VF_CL_VIEWANGLES*`, `VF_AFOV`, `VF_SCREENVSIZE`, `VF_SCREENPSIZE`, `VF_ACTIVESEAT` (seat 0 only).
Anything else prints an unsupported-property line.

**Particles** — `#335 particleeffectnum`, `#336 trailparticles`, `#337 pointparticles`, resolved
against the engine's own `effectinfo` particle system. No server round trip.

**Entity stream reads** — `#360 readbyte`, `#361 readchar`, `#362 readshort`, `#363 readlong`,
`#364 readcoord`, `#365 readangle`, `#366 readstring`, `#367 readfloat`, `#368 readentitynum`.
These read the server message the engine is parsing right now, at its own cursor. **The wire
format carries no length prefix**: the progs must consume exactly the bytes its `.SendEntity` wrote,
or every svc after it in the same message is parsed as garbage. `cl_shownet 2` traces the byte count
each entity actually consumed, which is the only way to locate such a desync.

**Client→server events** — `#359 sendevent(name, argtypes, ...)`. Argument type letters `s f v e i
u`, up to six arguments; `e` sends the entity's `.entnum`, i.e. the *server's* number. Ignored with
a dprint when the server did not negotiate `PEXT1_CSQC`.

**Input, keys, cursor** — `#340 keynumtostring`, `#341 stringtokeynum`, `#342 getkeybind`,
`#343 setcursormode`, `getcursormode`, `#345 getinputstate`, `#346 setsensitivityscaler`. Key codes
in and out of the QC are the DP/FTE keycode space, not the engine's own numbering.

**Queries** — `#348 getplayerkeyvalue` (`name`, `frags`, `ping`, `entertime`, `topcolor`,
`bottomcolor`, `team`, `viewentity` — the keys the scoreboard actually holds; NQ carries no
per-player userinfo), `#349 isdemo`, `#350 isserver`, `#354 serverkey` (`constate` only, for the
same reason), `#352 registercommand`, `#99 checkextension`.

**Server-side (ssqc) additions** that a csqc mod's other half uses: `#82 multicast(org, dest)` with
`Write*` destinations 4 (`MSG_MULTICAST`) and 5 (`MSG_EXT_ENTITY`), `#232 clientstat`,
`#233 globalstat`, and the `.SendEntity` / `.SendFlags` / `.pvsflags` fields.

### Not implemented

These resolve to a stub that warns once and does nothing:

- `#306-308` `R_BeginPolygon` / `R_PolygonVertex` / `R_EndPolygon`.
- Skeletal objects (`#263-283`), fonts (`#356`/`#357`), `memalloc` family, `deltalisten`, MenuQC.
- `runstandardplayerphysics` and csqc-side prediction. There are no move acks, so
  `servercommandframe` is always 0 and `#345 getinputstate` answers only for the current command
  frame (QSS can answer for the last 64 from its prediction log).
- `#344 getmousepos` — menuqc-only in QSS too; use `CSQC_InputEvent`.
- `setcursormode` cursor **images**: the mode itself works, but there is no hardware-cursor
  plumbing. Draw the cursor with `drawpic` in `CSQC_UpdateView` — absolute mouse events arrive in
  the same virtual canvas units, so they line up.
- `physics_mode 2` movetype physics: degrades to running due thinks plus `EndFrame`, with a console
  warning. Mode 0 (default, advance the clock only) and mode 1 (thinks) are exact.
- On csqc render entities: explicit `.frame2`/`.lerpfrac` pose blending, `.renderflags` and
  `.colormod` are refused with a warn-once rather than silently dropped. `.tag_entity`/`.tag_index`
  attachments are resolved but not acted on.

### Extension strings

`checkextension` answers from one table for both VMs. The CSQC-era additions are `EXT_CSQC`,
`DP_CSQC_QUERYRENDERENTITY`, `FTE_QC_MULTICAST`, `FTE_QC_INFOKEY` and
`DP_QC_MULTIPLETEMPSTRINGS`; the full advertised set is the `extensions` table in
`src/engine/pf.ts`. The `csqcactive` / `*csqcactive` infokey reports whether that client took the
full tier and asked for the stream.

## Protocol

**Negotiation** is FTE's `pext` handshake, and `PEXT1_CSQC` (0x40000000) is the only bit
advertised in either direction. On a new connection the server stuffs `cmd pext` and defers the
serverinfo; the client replies `pext 0x58455446 0x40000000` (the PEXT1 magic spells `FTEX`; PEXT2 is
`0x32455446` and is never offered, since no PEXT2 bit is implemented). The agreed masks are written
as `(magic, mask)` long pairs **in front of** the protocol long in `svc_serverinfo`. A pre-pext
client forwards a bare `pext` — `cmd <unknown>` is forwarded verbatim by every NQ client — so the
server still gets its answer and negotiates nothing. `cl_nopext 1` opts the client out the same way.

**csprogs advertisement** rides the DarkPlaces stufftext triple `csqc_progname` / `csqc_progcrc` /
`csqc_progsize`, sent with the serverinfo to clients that negotiated `PEXT1_CSQC`. (QSS moved this
into serverinfo keys, for which this engine has no transport.) The server computes the hash and size
once per `spawnServer` from the `csprogs.dat` in the active game dir.

**Wire numbers used** — svc `51` `dp_updatestatbyte`, `58` `dp_csqcentities`, `78`
`fte_updatestatstring`, `79` `fte_updatestatfloat`, `83` `fte_cgamepacket`; clc `81`
`fte_qcrequest`. All of them are gated on `PEXT1_CSQC` and are a fatal parse error otherwise.

**Entity stream** — a run of entity numbers with flags (`0x8000` = remove, `0x4000` = a 22-bit
number continued in the next byte), terminated by a bare short 0. Each update's payload is whatever
`.SendEntity` wrote. Stats pick the narrowest encoding that survives: byte, `svc_updatestat` long,
float, or string; without `PEXT1_CSQC` only the first 32 stats are sent, as vanilla longs.

**Delta from QSS**: QSS gates csqc entities on `PEXT2_REPLACEMENTDELTAS` because its NQ csqc-ents
ride that frame/ack machinery; FTE's own gate is `PEXT1_CSQC`, which is what is used here. Because
the WebSocket transport is reliable and ordered, the loss-recovery half of that machinery
(`SENDFLAG_REMOVE` resends, `resendstatsnum[]`, frame-ack re-OR) is dead code and is not
implemented; the `SENDFLAG_PRESENT` bookkeeping is kept, since "entity stopped being csqc ⇒ send a
remove" still needs it.

## Engine-specific notes

**csprogs must be built against NQ sysdefs** — the compiled header must report `PROGHEADER_CRC`
**5927**, the same value vanilla `progs.dat` uses. DarkPlaces' 52195 and FTE's 22390 are rejected
with a named diagnostic under `pr_foreigndefs 0`; with the default `pr_foreigndefs 1` they load
instead through the name resolution described in `docs/fte-support.md`. Compile with `fteqcc -Tq1` and keep the system block (everything before
`end_sys_globals` / `end_sys_fields`) untouched; see `test/csqc/csqcdefs.qc` for a transcription
that already reports 5927, and `test/csqc/README.md` for how to verify the CRC of a built file.

**Pak precedence** — paks shadow loose files inside the same game dir, so a mod's `progs.dat`
cannot live loose in `id1` (`pak0.pak` already ships one and would silently win). Use a real
`-game <dir>` mod directory. A loose `csprogs.dat` in `id1` is fine — no id pak carries one.
`test/csqc/README.md` has the full recipe and the symptom to look for.

**`-game <dir>` in the browser** — route query parameters become engine command-line arguments, so
`/quake?-game=csqctest` runs that game dir.

**csprogs lookup order**, per load: `csprogsvers/<hash-in-hex>.dat` (the versioned download cache,
when the server advertised a crc) → the name the server advertised → `csprogs.dat`. There is
deliberately **no** `progs.dat` fallback (QSS has one; it would run the server progs client-side).
`csprogsvers/*.dat` is also the only downloadable gamecode path — the hash is in the name, so a
server cannot replace the csprogs a client runs for some other server.

**Virtual canvas** — the drawing builtins work in a canvas of `(width/s, height/s)` pixels, where
`s = clamp(1, scr_sbarscale, width/320)`. `scr_sbarscale` defaults to 2 (the value the engine sbar
was previously hardcoded to). `VF_SCREENVSIZE` and `VF_SCREENPSIZE` report the virtual and physical
sizes, and absolute mouse positions arrive in virtual units.

**Cursor model** — `setcursormode(TRUE)` releases browser pointer lock (there is no other way to
show a system cursor over the canvas), stops the mouse turning the view, and switches to absolute
`CSIE_MOUSEABS` events. `setcursormode(FALSE)` cannot re-acquire the lock on its own — browsers only
grant it from a user gesture — so the engine re-locks on the player's next click.

**Cvars** — `cl_nocsqc 1` disables csqc entirely (vanilla HUD and view come back); `cl_nopext 1`
suppresses the pext reply, which also drops the full tier on remote servers; `scr_sbarscale` sets
the virtual-canvas scale; `pr_checkextension 0` disables csqc too, since the loader is gated on it.
`cl_shownet 2` traces the csqc entity stream.

**Per-frame VM pass** — the csqc VM gets a worldmodel, an areanode tree and a modelindex lookup
whether or not a csprogs loaded, so trace/link builtins always work. Its clock advances once per
client frame; `physics_mode` decides whether thinks run.

## Deltas from QSS worth knowing as a mod author

- `getproperty(VF_ORIGIN/VF_ANGLES)` **returns** the value. QSS writes it into `OFS_PARM1`, so its
  callers only ever see a zeroed return; FTE returns it, and so does this engine.
- `sendevent` falls back to `CSEv_<name>` when `CSEv_<name>_<argtypes>` does not exist, so a mod can
  accept an event without spelling the argument types into the function name.
- `CSQC_Parse_CenterPrint`'s return value is honoured (QSS suppresses the engine centerprint
  whenever the hook merely exists). Return 0 to hand the centerprint back to the engine.
- `CSQC_InputEvent` receives the real typed character in its unicode parameter on key-down. QSS
  always passes 0 there, which makes csqc text entry impossible.
- `CSQC_Input_Frame`'s write-back to `input_angles` reaches the angles actually sent (FTE's
  behaviour). On QSS the NQ send path ignores them.
- `clientcommandframe` is also published before `CSQC_Input_Frame`, not only before
  `CSQC_UpdateView`.
- `CSQC_Ent_Update` will not dispatch onto an edict the progs freed behind the engine's back: our
  map holds edict numbers and freed edicts are recycled, so a stale slot is treated as gone.
- The engine's share of a stufftext still goes through the command buffer rather than executing at
  parse time, keeping it in order with the rest of the buffer.
- `serverkey` and `getplayerkeyvalue` answer only from real client state (no userinfo strings on NQ).

## Fixtures

`test/csqc/` holds compiled `csprogs.dat` fixtures plus sources for both tiers, a matching server
`progs.dat` (`SendEntity` echo entity, custom stats, a `CSEv_` handler), and `csqcdefs.qc` — a
curated transcription of the QSS extension declarations to compile against. `test/csqc/README.md`
documents the end-to-end round trips, the expected console output, and the CRC and pak-precedence
gotchas.
