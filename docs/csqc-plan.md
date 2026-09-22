# CSQC (Client-Side QuakeC) Implementation Plan

Status: **IMPLEMENTED** — see [docs/csqc.md](csqc.md); this document is the historical plan.
Implemented on branch `csqc` (off master).
Reference implementation: **QSS** (QuakeSpasm-Spiked, local checkout `C:\source\QSS`), with FTE (`C:\source\fteqw`) as a secondary reference. Ironwail does not implement CSQC.

## 1. Context and goals

CSQC lets a mod ship a `csprogs.dat` that runs inside the client: custom HUDs, scoreboards, full control of the view/render loop, client-side entities networked via `SendEntity`/`SendFlags`, client→server events, and interception of prints/centerprints/input. It is the missing half of modern Quake mod support (the 2021 re-release, Alkaline-era mods, and most FTE/QSS-targeting mods use at least the "simple CSQC" HUD interface).

QSS defines two tiers, and we implement both:

- **Simple CSQC** — `CSQC_DrawHud`/`CSQC_DrawScores` only. Works with *any* server on protocol 15/666/999, no protocol extensions, no trust needed (dangerous entry points disabled, `nogameaccess` set). This is the highest-value tier and lands first.
- **Full CSQC** — `CSQC_UpdateView` owns the screen, client-side edicts, `CSQC_Ent_Update` entity streams, `sendevent`, input hooks. Requires the client's csprogs to byte-match what the server advertises (or demo playback), plus protocol extension plumbing.

## 2. Architecture summary (what QSS did, what we mirror)

QSS converted its single QC VM into a `qcvm_t` context struct (`QSS/Quake/progs.h:369-453`) holding: the progs image, globals, per-VM builtin table (`builtin_t builtins[1024]`), execution stack, string heap + known-string zone, edict array (`edicts`, `num_edicts`, `max_edicts`, `reserved_edicts`), `time`/`frametime`, worldmodel + its **own areanode tree** (client collision/links), and three name-resolved reflection caches: `extfuncs` (entry points), `extglobals`, `extfields`. A module-global pointer `qcvm` plus `PR_SwitchQCVM(vm)` (`pr_edict.c:1173`) selects the active VM; switching to a non-NULL VM while one is active is a hard error (the NULL sandwich is load-bearing — e.g. `Sbar_Draw` uses `qcvm == NULL` to detect "called from engine, not from inside renderscene").

We mirror this shape directly. It maps cleanly onto our conventions: `pr.state` stays the *active-VM pointer*, and everything currently module-global-but-per-progs moves into `PrState`.

### Key design decisions (made now, so agents don't re-litigate)

1. **Active-VM pointer, QSS-style — with one deliberate deviation.** `pr.state` becomes a reference to the active `PrState`; `pr.vms = { ssqc, csqc }`; `pr.switchVM(vm)` swaps it. Unlike QSS, `pr.state` is **never null** — it defaults to the ssqc VM when no switch is active. Rationale: we have `pr.state` readers that legitimately run outside any VM context (`r.ts` alpha decode, `save.ts`, `src/server/` net modules) and a null-when-idle sentinel would crash them; QSS only uses its NULL state for one thing (detecting `Sbar_Draw` reentry from inside `renderscene`), which we replace with an explicit `pr.inVM`-style reentry flag set around `executeProgram` entry (added in WP1.4 where first needed). Readers that specifically mean "the *server* progs" regardless of what's active (wasm bridge, `r.ts` feature flags, save/load) must be pinned to `pr.vms.ssqc` explicitly during WP0.1's consumer audit.
2. **csprogs must be built against NQ sysdefs.** QSS requires the NQ `PROGHEADER_CRC` (5927) for csprogs (`pr_edict.c:1329-1365` rejects DP's 52195 and FTE's 22390 with friendly errors). Same globalvars layout as server progs ⇒ our fixed-offset `pr.globalvars` table stays valid for both VMs. Port the friendly CRC diagnostics.
3. **Protocol extension negotiation = QSS's `cmd pext` mechanism** (server stuffs `cmd pext`, client replies `pext FTE1 <bits> FTE2 <bits>`, server echoes agreed masks as two leading longs in `svc_serverinfo` — `QSS/Quake/cmd.c:965-973`, `sv_main.c:2047-2056`, `cl_parse.c:1361-1375`). We advertise **`PEXT1_CSQC` (0x40000000) only** and gate the CSQC entity stream, extended stats, and `clcfte_qcrequest` on it. QSS gates csqc ents on `PEXT2_REPLACEMENTDELTAS`, but only because its NQ csqc-ents ride the replacement-delta frame/ack machinery; FTE's own gate for CSQC is `PEXT1_CSQC` (precedent), and implementing replacement deltas is an unrelated multi-month project. Our transport (WebSocket) is reliable/ordered, so the loss-resend half of that machinery (`SENDFLAG_REMOVE` resends, `resendstatsnum[]`, frame-ack re-OR) is dead code for us — we keep the `SENDFLAG_PRESENT` bookkeeping (needed for "entity stopped being csqc ⇒ send remove") and skip loss recovery. Document this delta from QSS in code comments at the negotiation site.
4. **csprogs identification via DP stufftext keys**, not serverinfo. QSS advertises `*csprogs` (md4-fold hash) + `*csprogssize` in serverinfo (`sv_main.c:3742-3755`); we don't have serverinfo transport. DarkPlaces' `csqc_progname`/`csqc_progcrc`/`csqc_progsize` stufftext commands are the precedented alternative (QSS has the emit code present-but-commented at `sv_main.c:2029-2037`, and registers `csqc_progname` client-side). We emit and consume the DP stufftext triple.
5. **Full-vs-simple decision copied verbatim from QSS** (`host.c:806-827`): full CSQC iff (server advertised a hash AND local csprogs hash+size match) OR demo playback; otherwise require `CSQC_DrawHud`, null out `CSQC_Input_Frame`/`UpdateView`/`Ent_Update`/`Ent_Remove`/`Parse_StuffCmd` + the command-frame globals, and set `nogameaccess`.
6. **WASM sim rule:** the wasm bridge (`src/app/game/net/wasmServer.ts`) pins the **ssqc** VM reference at load and never reads the active pointer. The server frame (JS or wasm path) runs with ssqc switched in; client-side CSQC code runs with csqc switched in. CSQC itself never touches the wasm sim — it is pure client JS. The one crossover is `SendEntity` execution at datagram-build time in wasm mode (see WP3.6).
7. **2D virtual canvas:** CSQC draws in QSS's `CANVAS_CSQC` coordinate space — virtual size `(pixelWidth/s, pixelHeight/s)` where `s = clamp(1, scr_sbarscale, pixelWidth/320)` (`gl_draw.c:958-962`, `pr_ext.c:30-41`). Our `draw.*` API is raw-pixel; the CSQC draw builtins multiply by `s` at the callsite (do NOT introduce a global canvas mode into `draw.ts`). We add a `scr_sbarscale` cvar (sbar currently hardcodes `scale: 2` in `sbar.ts:59`) — keep default behavior pixel-identical.
8. **Non-goals:** MenuQC (we have a native Vue/engine menu), FTE skeletal builtins, `R_BeginPolygon` family (stub as unimplemented like QSS's `PF_Fixme`), replacement deltas, csqc-side prediction (`runstandardplayerphysics` stubbed; revisit later), rerelease `csprogs` quirks.

## 3. Current-engine gap analysis (from exploration, 2026-08-13)

- `pr.state` is a module singleton (`pr.ts:131`); `executeProgram` reads `sv.state.server.edicts` inline in 6 opcodes (`pr.ts:996-1070`); `loadProgs` hardcodes `'progs.dat'`, validates server CRC, and reads `sv.state.svs.maxclients` (`pr.ts:421-680`).
- `pf.builtin[]` + `pf.ebfs_builtins` are module-global and mutated per-load (`pf.ts:1742`, `1937+`); all builtins are server-semantic.
- `pr.entvars`/`pr.globalvars` shared mutable maps; `ed.state` caches key off `pr.state.*` array identity.
- Edicts live in `sv.state.server.edicts` (per-edict ArrayBuffers); areanodes/world links are server-owned; `sv.rebindEdictStorage` exists (wasm zero-copy).
- Client parse switch treats unknown svc as **fatal** with hex dump (`cl.ts:2555`); `svc_updatestat` discards stat indices ≥ 32 (`cl.ts:2446-2453`); stats array is 32 ints, no `statsf`/`statss`.
- No PEXT negotiation anywhere (`pf.ts:1615`, `sv.ts:3455` say so explicitly); infokey `*csqcactive` returns "0" (`pf.ts:1421`).
- Existing seams to reuse: `r.renderScene()` is the single "render scene from `r.state.refdef`" function and is proven re-entrant (skyroom double-render, `r.ts:1077-1093`); 2D overlay pass is `scr.updateScreen` between `begin2D()` and `endFrame()` (`scr.ts:439-477`); input seams `key.event` (`key.ts:395`), `cl.accumulateCmd`/`cl.sendCmd` (`cl.ts:927/1513`); console fall-through `cmd.executeString` (`cmd.ts:193-202`); download extension + DP particle svcs are precedent for unconditional protocol extensions; `pscript.ts` already implements the effectinfo particle system that `particleeffectnum`/`pointparticles`/`trailparticles` resolve against.
- QC download allowlist excludes `.dat` (`cl.ts:1774-1900`) — extend for `csprogsvers/` if server-pushed csprogs downloads are wanted (Phase 5).

## 4. Phases and work packages

Each WP is sized for one opus/sonnet agent. Every WP ends with the standard gate (§6) plus its own acceptance criteria. Do them in order within a phase; phases 1 and later depend on Phase 0. Phase 3 can start after Phase 1 (it only needs the VM + loader), in parallel with Phase 2.

### Phase 0 — Multi-VM refactor (the prerequisite; zero behavior change)

**WP0.1 — `PrState` becomes a VM context; `pr.switchVM`.**
- Move into `PrState`: everything already there, plus `edicts: Edict[]`, `num_edicts`, `max_edicts`, `reserved_edicts`, `time`, `frametime`, `worldmodel`, `areanodes`/`numareanodes` (see WP0.2), per-VM builtin table (see WP0.3), `entvars` (currently `pr.entvars`), `extfuncs`/`extglobals`/`extfields` (empty for now, filled in WP1.1), and the `ed.state` lookup caches (per-VM so switching doesn't thrash).
- `pr.vms.ssqc` is constructed by `pr.init()`; `pr.state` starts as `null`; `pr.switchVM(vm)` mirrors QSS (`pr_edict.c:1173-1186`): error if switching non-null→non-null.
- `host._frame` wraps the server frame (`serverFrame()` call at `host.ts:384`) and every other SSQC entry (`sv.spawnServer`, save/load, client-connect paths, `net_dgrm`-equivalents in `src/server/`) in `switchVM(ssqc)`/`switchVM(null)`. Grep discipline: every `pr.executeProgram` callsite must be inside a switch sandwich.
- `sv.state.server.edicts` remains the canonical *reference holder* but points at the same array as `vms.ssqc.edicts` (one array, two names) — do not churn sv.ts call sites in this WP.
- Acceptance: id1 SP + a listen server run identically; `npx vue-tsc -p tsconfig.app.json --noEmit` clean; wasm parity untouched (see WP0.4).

**WP0.2 — World/areanodes parameterized on the active VM.**
- The areanode tree, `clearWorld`, `linkEdict`/`unlinkEdict`, `findTouchedLeafs`, and the trace/move entry points in sv.ts currently assume server state. Follow QSS: areanodes moved into `qcvm_t`, `SV_ClearWorld()` operates on the active VM (`host.c:876-884` even initializes cl.qcvm's world with no csprogs so prediction/link code can run).
- Mechanically: world functions read `pr.state.areanodes` / `pr.state.worldmodel` instead of server fields. Server behavior unchanged (ssqc VM is the only VM that exists yet).
- Acceptance: physics/trace behavior identical (run a demo comparison on id1 + one AD map); no per-frame allocation regressions (areanode links are persistent objects).

**WP0.3 — Per-VM builtins and parameterized `loadProgs`.**
- `loadProgs(vm, filename, opts)` — filename parameter, `{ needcrc, builtins }`; copies the passed base builtin table into `vm.builtins` (QSS `pr_edict.c:1420`); `ebfs_builtins` number assignment becomes per-load into the VM's table (no more mutation of the shared record's `fnNbr` — store resolved numbers per VM); `netnames` allocation only when `opts.maxclients` provided.
- Interpreter builtin dispatch (`pr.ts:1055`) reads `pr.state.builtins`.
- Port QSS's friendly foreign-CRC diagnostics (`pr_edict.c:1329-1365`).
- Acceptance: identical server behavior; `pr_builtin_remap`/rerelease `#0` binding still works (mg1 smoke test).

**WP0.4 — WASM bridge pinning + parity gate.**
- `wasmServer.ts` (and `serverWorker.ts` path) hold `const ssqc = pr.vms.ssqc` and replace every `pr.state.` read with `ssqc.` — the bridge must be correct even when csqc is the active VM on the main thread. `host_extbuiltin` asserts the active VM is ssqc when invoked.
- Acceptance: wasm-vs-JS parity run (existing shadow-verify tooling on `spike/sim-shadow` recipes), id1 SP + ad_tears smoke, `-nowasm` and default modes both pass.

### Phase 1 — csprogs loading + simple CSQC (HUD tier)

**WP1.1 — Loader, lifecycle, reflection.**
- `cl.loadCSProgs()` mirroring QSS `CL_LoadCSProgs` (`host.c:768-886`), called from the `cls.sendprespawn` path in `host._frame` (`host.ts:350-362`) after `checkDownloads()` resolves, before sending `prespawn`. Gate on new cvar `cl_nocsqc` and existing `pr_checkextension`.
- Load fallback chain: `csprogsvers/<hash>.dat` → server-named → `csprogs.dat` (skip the `progs.dat` fallback QSS has — footgun). Each attempt must expose `CSQC_DrawHud` or `CSQC_UpdateView` (or `CSQC_DrawScores` for plain `csprogs.dat`) or be rejected.
- Full/simple decision per design decision 5. Hash = md4-fold (`Com_BlockChecksum`); we already have crc.ts — add the md4 block-checksum (QSS `Com_BlockChecksum`) if absent.
- `extfuncs` resolution by name via `ed.findFunction` — the full QSS list from `progs.h:176-225` (CSQC set: `CSQC_Init, CSQC_Shutdown, CSQC_DrawHud, CSQC_DrawScores, CSQC_InputEvent, CSQC_ConsoleCommand, CSQC_Parse_Event, CSQC_Parse_Damage, CSQC_UpdateView, CSQC_UpdateViewLoading, CSQC_Input_Frame, CSQC_Parse_CenterPrint, CSQC_Parse_Print, CSQC_Ent_Update, CSQC_Ent_Remove, CSQC_Event_Sound, CSQC_Parse_TempEntity, CSQC_Parse_StuffCmd`, plus shared `GameCommand`/`EndFrame`). `extglobals`: `cltime, clframetime, maxclients, intermission, intermission_time, player_localnum, player_localentnum, view_angles, clientcommandframe, servercommandframe`, plus `time, frametime`. `extfields`: `alpha, scale, colormod, tag_entity, tag_index, modelflags, origin, angles, frame, skin, frame2, lerpfrac, frame1time, frame2time, renderflags, entnum, drawmask, predraw`.
- Seed worldspawn edict 0 + globals exactly as `host.c:832-850`; call `CSQC_Init(fullcsqc, "netquake.io", version)`; send `enablecsqc` stringcmd when full.
- Shutdown: `CSQC_Shutdown` + clear in `cl.clearState` and host-error path; on host error also zero `CSQC_UpdateView`/`CSQC_Shutdown` before rethrow (QSS `host.c:190-196`) and reset any csqc clip rect.
- Acceptance: with no csprogs present, zero behavior change; with a fixture csprogs, `CSQC_Init`/`Shutdown` fire at the right times across map changes, disconnects, and host errors.

**WP1.2 — CSQC builtin tables + 2D drawing builtins.**
- New module `src/engine/pfcl.ts` (client builtins), following `pf.ts` conventions. Base #1-90 table = QSS `pr_csqcbuiltins` (`pr_cmds.c:2160-2250`): shared entity/math/string builtins operate on `pr.state.edicts` so they're automatically client-side after Phase 0; client substitutions `cl_setmodel`(#3), `cl_sound`(#8), `cl_precache_sound`(#19/#74), `cl_precache_model`(#20), `cl_lightstyle`(#35), `cl_particle`(#48), `cl_makestatic`(#69), `cl_ambientsound`(#73); server-only slots get a `NoCSQC` error stub.
- Extension numbers (EXT_CSQC block, from `pr_ext.c:7892-7906`): `#316 iscachedpic, #317 precache_pic, #318 drawgetimagesize, #320 drawcharacter, #321 drawrawstring, #322 drawpic, #323 drawfill, #324 drawsetcliparea, #325 drawresetcliparea, #326 drawstring, #327 stringwidth, #328 drawsubpic`, plus `#338 cprint, #339 print, #177 localsound`. Drawing maps onto `draw.*`/`IRenderer` with the `s` scale per design decision 7; `drawsetcliparea` needs a scissor entry on `IRenderer` (implement in both WebGL and WebGPU backends; WebGPU render passes already track viewport state — use `setScissorRect`). `drawfill` takes an RGB vector + alpha (not palette index) — extend `IRenderer.drawFill` or add `drawFillRGBA`.
- `#0`-function name binding for extension builtins: reuse the existing `EXT_BUILTIN_BASE` name-matching mechanism (`pr.ts:135`), now per-VM.
- Acceptance: fixture csprogs draws pics/strings/fills/clip rects correctly at multiple window sizes and `scr_sbarscale` values, both render backends.

**WP1.3 — Extended stats storage + getstat builtins.**
- Grow client stats to `MAX_CL_STATS = 256`: `clState.stats` (int), new `clState.statsf` (float), `clState.statss` (string map) — mirror QSS `client.h:178-180`. `parseClientdata` writes both int and float views where QSS does.
- Builtins `#330 getstati, #331 getstatf (+bitfield form), #332 getstats` (`pr_ext.c:5328-5361`).
- Fix `svc_updatestat` to accept indices < 256 instead of discarding ≥ 32.
- Acceptance: fixture HUD reads health/ammo/items via getstati and matches engine sbar values.

**WP1.4 — HUD/scoreboard integration.**
- `sbar.drawSbar()` early-out: when `csqc.extfuncs.CSQC_DrawHud` set and no VM active → set globals (`sbar.c:989-1020` list), sort frags, call `CSQC_DrawHud(virtsize, sb_showscores)` (+`CSQC_DrawScores` unless menu open), return.
- `scr.calcRefdef`: `sbar.state.lines = 0` when csqc hud present (`gl_screen.c:395-400`) so the 3D view is fullscreen.
- `sbar.intermissionOverlay` → `CSQC_DrawScores` (`sbar.c:1440-1464`); engine scoreboard fallback when `DrawScores` absent.
- Suppress engine crosshair when full CSQC later owns the view (flag now, used in WP2.3).
- Acceptance: fixture simple-CSQC HUD replaces the engine sbar in SP and MP scoreboard cases; disabling via `cl_nocsqc 1` restores vanilla.

**WP1.5 — Test fixture csprogs.**
- Build `test/csqc/` with QC sources + compiled `csprogs.dat` fixtures: (a) minimal simple-hud csprogs (draws health/ammo/a pic/clip-rect test pattern), (b) full-csqc fixture used by Phases 2-4 (UpdateView + renderscene + an Ent_Update echo entity + sendevent round-trip + input logging). Compile with fteqcc (available via `C:\source\fteqw`; check in the compiled .dat + sources + a build note). Generate the authoritative API reference by running QSS's `pr_dumpplatform` → check in the emitted `qsextensions.qc` under `test/csqc/` for agents to compile against.
- Acceptance: both fixtures compile and load in QSS itself (ground truth) and behave identically there vs our engine as later phases land.

### Phase 2 — Full CSQC: client world, scene control, UpdateView

**WP2.1 — Client edict world + per-frame VM upkeep.**
- Allocate csqc edicts at load (`num_edicts = reserved_edicts = 1`, growable to `max_edicts` cvar); `qcvm.worldmodel = cl worldmodel`; `clearWorld()` on the csqc VM (works after WP0.2).
- Per-frame: run the QSS physics pass for csqc (`host.c:973-979` → `SV_Physics` with `physics_mode` default **0** for csqc = advance time only, honor `physics_mode` extglobal for 1/2; `sv_phys.c:1529-1555`), and `EndFrame` when mode 2. Also initialize the csqc VM worldmodel even when no csprogs loads (QSS does, for shared link code).
- Switch sandwich around `relinkEntities()`/`updateTEnts()` in `cl.readFromServer` like QSS `cl_main.c:1255-1258` (harmless now, needed once csqc areanodes exist).
- Acceptance: fixture spawns a thinking csqc entity under `physics_mode 1`, traces work via `#16 traceline` against the world.

**WP2.2 — Scene builtins.**
- `viewprops` state on the csqc VM (`pr_ext.c:6775-6787`): `rect_pos, rect_size, afov/fov_x/fov_y, origin, angles, drawsbar, drawcrosshair`.
- `#300 clearscene` (reset viewprops, reset visedict count, seed origin/angles from engine view via `v.calcRefdef` outputs, `drawworld = true`), `#302 addentity`, `#301 addentities(mask)` (MASK_ENGINE = run/append `relinkEntities` output + statics + temp ents; MASK_NORMAL = csqc edicts with `.drawmask`, honoring `.predraw` returning PREDRAW_AUTOADD/NEXT semantics per QSS `PF_cs_addentities` `pr_ext.c:6693`), `#303 setproperty`/`#309 getproperty` (the VF_* set QSS implements: min/size/fov/origin/angles/drawworld/enginesbar/crosshair/screenvsize/screenpsize; `nogameaccess` guard on VF_ORIGIN/ANGLES reads), `#304 renderscene` (`pr_ext.c:7201-7226`: viewprops → `r.state.refdef`, call `r.renderScene()`, poly-blend if drawworld, then optional engine sbar/crosshair, restore 2D state), `#305 dynamiclight_add`, `#310 unproject`/`#311 project`, `#351 SetListener`, `#333 setmodelindex`, `#334 modelnameforindex`, `#504 getentity` (renderentity query, `nogameaccess`-gated), `#340-342` key builtins, `#349 isdemo`, `#350 isserver`, `#354 serverkey`, `#348 getplayerkeyvalue`, `#92 getlight`, `#240 checkpvs`, `#279 touchtriggers`, `#355 getentitytoken`.
- Particles: `#335/336/337` route to the existing `pscript` registry (client-native — no server round trip).
- **Hot-path allocation rule applies**: addentity converts a csqc edict to a render `Entity` — maintain a persistent pool on the csqc VM (like `temp_entities`), never allocate per frame.
- CSQC entities render through the existing `cl.state.visedicts` list so both backends work unchanged.
- Acceptance: fixture full-csqc renders the world from a custom camera, adds an engine-entity pass + its own model entity, projects a 3D point to a 2D label.

**WP2.3 — CSQC_UpdateView owns the screen.**
- In `scr.updateScreen` (`scr.ts:388-487`): when connected, worldmodel present, and `extfuncs.CSQC_UpdateView` — take the QSS branch (`gl_screen.c:1141-1176`): set globals (`cltime=realtime, clframetime, player_localentnum, intermission, intermission_time, view_angles, clientcommandframe=movemessages, servercommandframe`), begin2D-equivalent canvas, call `CSQC_UpdateView(vwidth, vheight, true)` (or `CSQC_UpdateViewLoading` pre-signon), skipping `v.renderView`, sbar, and crosshair; common tail (console, menu, centerprints, debug overlays) still draws on top. Fallback path untouched when the func is absent.
- Interaction with our renderer frame structure: `renderscene` must be callable mid-2D — coordinate `beginFrame/begin2D/endFrame` so a 3D scene pass can be opened from the CSQC branch (the skyroom re-entrancy plus `r.state.dowarp` handling are the references; WebGPU backend needs the same care as its `beginScene` path).
- Acceptance: fixture UpdateView reproduces the vanilla view pixel-comparably (same refdef → same scene), then demonstrates a custom viewport rect + fov; console/menu still overlay; `cl_nocsqc 1` and missing-func fallbacks intact; both backends.

### Phase 3 — Networking (can run parallel to Phase 2 after Phase 1)

**WP3.1 — PEXT negotiation.**
- Constants in `protocol.ts`: `PROTOCOL_FTE_PEXT1/2` ('FTE1'/'FTE2'), `PEXT1_CSQC = 0x40000000`. Server: stuff `cmd pext` at new-client signon (QSS `sv_main.c` SV_SendServerinfo-era), accept `pext` stringcmd storing per-client masks, then emit agreed masks as leading `('F','T','E','1')+long` pairs in `svc_serverinfo`; client: reply to `cmd pext` (suppress via `cl_nopext`), parse the leading pairs in `parseServerInfo` (`cl_parse.c:1361-1375` format), store `clState.protocol_pext1`.
- Both our JS server and the wasm-mode server path share `sv.sendServerinfo` — one implementation. `src/server/` node dedicated server inherits it too.
- Acceptance: old client ↔ new server and new client ↔ old server both still connect clean (the `cmd pext` stufftext is ignored by old clients as an unknown command — verify, since unknown *commands* print but don't kill; unknown *svcs* would kill).

**WP3.2 — Server-side CSQC entities.**
- SSQC reflection: resolve `SendEntity`/`SendFlags`/`pvsflags` extfields on the ssqc VM (already have the extfields plumbing from WP1.1 — QSS `QCEXTFIELDS_SS`).
- Per-client `pendingcsqcentities_bits: Uint32Array` with `SENDFLAG_PRESENT/REMOVE/USABLE` semantics (`server.h:190-194`, 24 usable bits); candidate scan inside `sv.writeEntitiesToClient`: entity with SendEntity function + `client.csqcactive` is claimed by the csqc stream and skipped from the regular entity write (`sv_main.c:1195-1306`, incl. PVS `SENDFLAG_REMOVE` unless `pvsflags & PVSF_NOREMOVE`).
- Writer mirroring `SVFTE_WriteCSQCEntitiesToClient` (`sv_main.c:991-1112`): per entity, clear the multicast scratch buffer, set `self`, PARM0 = client edict, PARM1 = changed-bits float vector, execute SendEntity, splice buffer on nonzero return; entnum encoding: update `short e` / `short 0x4000|(e&0x3fff) + byte e>>14`, remove `short 0x8000|e` / `0xc000` variant, terminator `short 0`; lazy `svcdp_csqcentities (58)` header; size rollback if over datagram budget (bits re-OR for next frame).
- New `MSG_MULTICAST`/`MSG_EXT_ENTITY` write dest → `sv.state.server.multicast` buffer; SSQC builtins: `#82 multicast(where,set)` with `requireext2`-style gating (`pr_ext.c:4701-4793`), Write* accepting dest 4/5.
- `enablecsqc`/`disablecsqc` client commands setting `client.csqcactive` + re-flagging present ents (`host_cmd.c:2614-2631`); DP stufftext advertisement of csprogs name/crc/size at serverinfo time (design decision 4) — hash computed once at `spawnServer` if `csprogs.dat` exists in the game dir.
- Acceptance: fixture SSQC mod (add a tiny progs.dat fixture with a SendEntity entity) streams create/update/remove to the client correctly across map restarts and `enablecsqc` timing.

**WP3.3 — Client-side entity stream + Ent_Update/Ent_Remove.**
- `case svcdp_csqcentities` in `parseServerMessage`, gated on `PEXT1_CSQC` (else fatal, matching QSS's Host_Error). Parse loop per `CLFTE_ParseCSQCEntitiesUpdate` (`cl_parse.c:828-883`) with the 22-bit encoding; `clState.ssqc_to_csqc` sparse map (grow-by-64) server-entnum → csqc edict; new edicts get `.entnum` set, `self` set, `CSQC_Ent_Update(isnew)`; removes call `CSQC_Ent_Remove` (engine `ed.free` fallback).
- Read builtins `#360-368`: `readbyte/readchar/readshort/readlong/readcoord/readangle/readstring/readfloat/readentitynum` reading from the *current server message* at the engine's read cursor (`msg.ts` global reader — the builtins simply call `msg.read*`; document that CSQC must consume exactly what SendEntity wrote or the whole message desyncs, QSS has the same property).
- `SVC_STRINGS` table entry + shownet coverage.
- Acceptance: fixture round-trip — SendEntity writes N typed fields, Ent_Update reads them, engine survives a deliberate under-read in a debug build with a clear diagnostic (we can afford a `sized`-style length guard QSS `#if 0`'d ONLY as a dev-mode console warning; wire format unchanged).

**WP3.4 — Extended stats.**
- Server: `SV_CalcStats`-equivalent (`sv_main.c:99-140`) + `sv.customstats` registry + SSQC builtins `#232 clientstat, #233 globalstat` (`pr_ext.c:5011-5060`); stat writer choosing narrowest encoding (`sv_main.c:719-814`): `svcdp_updatestatbyte (51)`, `svc_updatestat` long, `svcfte_updatestatfloat (79)`, `svcfte_updatestatstring (78)`; stats up to 256 when `PEXT1_CSQC` (our gate).
- Client: parse cases for 51/78/79 → `stats`/`statsf`/`statss` (`cl_parse.c:2269-2287`).
- Wire caution: our engine currently *reinterprets* svc 36/37/40/53 in FTE-NQ mode (`cl.ts:2502-2541`) — the new numbers 51/58/78/79/83 collide with nothing we emit today, but verify against the FTE-NQ mode table before assigning cases.
- Acceptance: fixture registers a custom float stat + string stat SSQC-side; getstatf/getstats read them; works in wasm mode (stats calc runs JS-side at datagram time — confirm placement in wasm frame, see WP3.6).

**WP3.5 — Client→server events + cgamepacket.**
- `#359 sendevent(name, argstring, ...)` writing `clcfte_qcrequest (81)`: typed args (`s/f/F/i/I/u/U/v/e` per `pr_ext.c:6081-6138`), terminator 0, then name; server parse (`sv_user.c:~630-738`) resolving `CSEv_<name>_<argtypes>` then `CSEv_<name>` via findFunction, `self` = client edict; unknown → client print.
- `case svcfte_cgamepacket (83)` → `CSQC_Parse_Event` (gated `PEXT1_CSQC`; missing func = host error, per QSS `cl_parse.c:2918-2928`). Server emit path is just SSQC `multicast` with the MULTICAST dest wrapped in the cgamepacket svc when `PEXT1_CSQC` — follow FTE semantics here since QSS never emits it.
- Acceptance: fixture button in CSQC HUD sendevents to SSQC, SSQC replies with a cgamepacket, CSQC parses it. Verify in both wasm and `-nowasm` server modes.

**WP3.6 — WASM-mode SendEntity/stats marshal.**
- Investigate where datagram building happens relative to the wasm sim frame; SendEntity/stat-calc QC calls run on the **JS interpreter** against wasm-rebound edict storage (same pattern as `ClientConnect`/`PutClientInServer` at `wasmServer.ts:809-818`). Globals sync-in before, string reads via the existing bidirectional heap bridge. Strings *written* by SendEntity (WriteString args) flow through JS pf — verify `syncStringsIn` covers strings the wasm-side QC created that frame.
- Acceptance: WP3.2-3.5 fixtures pass identically with default wasm backend and `-nowasm`; shadow-verify spot check if drift suspected.

### Phase 4 — Input and parse hooks

**WP4.1 — CSQC_InputEvent + cursor.**
- Hook in `key.event` (`key.ts:395`) after the connecting guard, before escape/binding handling: `CSQC_InputEvent(CSIE_KEYDOWN/KEYUP, qcKeyCode, unicode, 0)`; nonzero return swallows. Only when `key.state.dest === game` or key-up (QSS `keys.c:1325-1342`). Needs a native→QC keycode mapping table (`Key_NativeToQC` equivalent — FTE keycode space; port QSS's table).
- Mouse: in `input` layer — pointer-locked deltas → `CSIE_MOUSEDELTA`; `#343 setcursormode` sets `cursorforced`, **exits pointer lock**, and switches to absolute `CSIE_MOUSEABS` events divided by the canvas scale (browser-specific: absolute coords come from regular mousemove events when unlocked; re-request pointer lock when cursor mode cleared — requires a user gesture, so re-lock on next click, note this quirk in code). `getcursormode`. Mouse wheel → key events (existing path).
- `#346 setsensitivityscaler` → `clState.csqc_sensitivity` consumed in `input.mouseMove`.
- Acceptance: fixture logs key/mouse events; a csqc "menu" with cursor works; engine binds still fire when CSQC returns 0; escape still reaches the engine menu.

**WP4.2 — CSQC_Input_Frame.**
- In `cl.sendCmd` (`cl.ts:1513`) after `baseMove`/mouse fold, before `sendMove`: `PR_GetSetInputs` equivalent (`pr_ext.c:1823-1889`) — publish `input_angles/input_movevalues/input_buttons/input_impulse` (+sequence/timelength) to the csqc extglobals (with fallback storage when the QC didn't declare them), call `CSQC_Input_Frame` (blocked by `nogameaccess`), read them back into the pending cmd. `clientcommandframe = movemessages`, `servercommandframe` stays 0 until/unless we add move acks (document).
- `#345 getinputstate` returns current frame only (no history buffer without prediction — QSS-compatible degradation; return false for old frames).
- Acceptance: fixture inverts forwardmove via Input_Frame; observable in-game; simple-csqc correctly has this hook disabled.

**WP4.3 — Parse hooks + console command.**
- `CSQC_Parse_CenterPrint` (in centerprint handler; nonzero return suppresses engine centerprint), `CSQC_Parse_Print` (print buffering + line splitting per `cl_parse.c:2418-2459`, print-level guess from `\x01` prefix), `CSQC_Parse_StuffCmd` (full only; only lines the engine command parser didn't recognize — QSS runs `Cmd_ExecuteString` first, then hands unhandled lines to CSQC with trailing `\n` restored), `CSQC_Parse_Damage` in the damage parse in `v.ts` (nonzero suppresses engine blend/kick), `CSQC_Event_Sound` in `parseStartSoundPacket` (`nogameaccess`-gated; nonzero suppresses `s.startSound`), `CSQC_Parse_TempEntity` in `parseTEnt` with read-cursor save/rewind on zero return (`cl_tent.c:152-167`, `nogameaccess`-gated).
- `#352 registercommand` = `cmd.addCommand(name, null)`; `cmd.executeString` treats a null-handler command as "interceptable" → sets args, calls `CSQC_ConsoleCommand(fulltext)`, falls through to normal handling on zero (QSS `cmd.c:874-881`). Also the `sb_showscores` `+showscores` path calls `CSQC_ConsoleCommand` first (`sbar.c:76-88`).
- `GameCommand` support for DP-compat.
- Acceptance: fixture intercepts centerprints into a styled panel, defines a custom console command, receives damage events; `nogameaccess` matrix verified for simple csqc (Input_Frame, Event_Sound, Parse_TempEntity, VF_ORIGIN reads, getentity all blocked).

### Phase 5 — Compatibility, real-mod acceptance, polish

- **WP5.1** — Advertise: `checkextension` additions (`EXT_CSQC`, `EXT_CSQC_SHARED`-adjacent strings QSS reports — copy QSS's advertised set exactly, from its `qsextensions.qc` dump), infokey `*csqcactive` reflecting reality (`pf.ts:1421`), `pr_dumpplatform`-style doc note.
- **WP5.2** — csprogs download: extend the QC download allowlist (`cl.ts:1774+`) with `csprogsvers/` prefix + `.dat` extension so servers can push versioned csprogs; store via existing `saveDownloadedFile`.
- **WP5.3** — Real-mod acceptance: pick 1-2 shipping QSS-CSQC mods (candidates to evaluate: Alkaline's HUD csprogs, any recent jam mod shipping csprogs.dat targeting QSS "simple csqc"; verify in QSS first as ground truth) and run them end-to-end. Fix deltas found.
- **WP5.4** — Docs: `docs/csqc.md` (user-facing: what's supported, the PEXT1 gate, deltas from QSS), update CLAUDE.md notes if module conventions grew (e.g. `pfcl.ts`).
- **Deferred/stubbed (explicit)**: `R_*Polygon` (#306-308), skeletal (#263-283), `runstandardplayerphysics`/prediction, `deltalisten`, fonts (#356/357), `memalloc` family, menuqc. Stub with a warn-once like QSS `PF_Fixme`.

## 5. Files touched (primary)

- `src/engine/pr.ts` — VM context, switchVM, loadProgs params, dispatch. `src/engine/ed.ts` — per-VM caches, alloc against active VM. `src/engine/pf.ts` — table restructure only. **New** `src/engine/pfcl.ts` — client builtins. `src/engine/sv.ts` — world parameterization, csqc-ent writer, stats, pext. `src/engine/cl.ts` — loader, parse cases, stats, ssqc_to_csqc, input hooks. `src/engine/host.ts` — frame switch sandwiches, csqc physics pass. `src/engine/scr.ts` + `src/engine/sbar.ts` — UpdateView/DrawHud integration. `src/engine/key.ts`, `src/engine/input.ts`, `src/engine/cmd.ts` — input/console hooks. `src/engine/protocol.ts`, `src/engine/msg.ts` — svc/clc numbers, read/write helpers. `src/engine/draw.ts` + `src/engine/render/IRenderer.ts` + both backends — scissor, RGBA fill. `src/app/game/net/wasmServer.ts` — ssqc pinning, SendEntity marshal. `src/server/` — inherits sv.ts changes; verify dedicated build (`npm run build:justserver`).

## 6. Verification gates (every WP)

1. `npx vue-tsc -p tsconfig.app.json --noEmit` (NOT plain tsc) and `npm run build` (vite build catches esbuild parse quirks — the `<< out.` lesson).
2. No-csprogs regression run: id1 SP start map + one AD map, default (wasm) and `-nowasm`, both render backends where rendering was touched.
3. WP-specific fixture test from `test/csqc/` (run the same fixture in QSS as ground truth when behavior is in doubt).
4. Per-frame allocation audit on any hot-path code (relink/render/input): no literals, use pools/`vec.scratch()`.
5. Commit per WP on the `csqc` branch, terse commit messages, no Co-Authored-By.

## 7. Risks / open questions

- **Phase 0 blast radius**: sv.ts/pf.ts have hundreds of `sv.state.server.edicts` touchpoints; the "one array, two names" aliasing keeps the diff contained but demands the parity gates be taken seriously (demo-compare + wasm shadow-verify).
- **Renderer re-entrancy from 2D**: `renderscene` mid-2D is new for the WebGPU backend (render-pass management). The skyroom path proves scene re-entrancy but not 2D→3D→2D sandwiching; budget debugging time in WP2.3.
- **Browser cursor model**: `setcursormode` vs pointer lock has no desktop-engine precedent; the WP4.1 design (unlock + abs events + re-lock on click) is the minimal-surprise approach but needs UX validation.
- **`servercommandframe`/prediction**: without move-acks, mods relying on real prediction (`PEXT2_PREDINFO` semantics) degrade. Acceptable for v1; revisit if a target mod needs it.
- **Message-desync fragility**: mod-buggy SendEntity/Ent_Update pairs corrupt the whole server message (inherent to the format; QSS has the same). The dev-mode read-length warning in WP3.3 mitigates diagnosis.
