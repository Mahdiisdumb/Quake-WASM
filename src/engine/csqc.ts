// CSQC VM lifecycle: loads csprogs.dat into pr.vms.csqc at prespawn, resolves the entry
// points/globals/fields by name, runs CSQC_Init / CSQC_Shutdown. Mirrors QSS CL_LoadCSProgs
// (host.c:768) and its shutdown hooks (cl_main.c:113, host.c:190).
import * as cl from './cl'
import * as cmd from './cmd'
import * as com from './com'
import * as con from './console'
import * as cvar from './cvar'
import * as def from './def'
import * as draw from './draw'
import * as ed from './ed'
import * as host from './host'
import * as key from './key'
import * as msg from './msg'
import * as protocol from './protocol'
import * as q from './q'
import * as pfcl from './pfcl'
import * as pfcl_scene from './pfcl_scene'
import * as pr from './pr'
import * as r from './r'
import * as scr from './scr'
import * as sv from './sv'
import * as vid from './vid'
import { CVars } from './cvar'
import { Edict, V3 } from './types'

const PARM0 = 4
const PARM1 = 7
const PARM2 = 10
const PARM3 = 13
const PARM4 = 16
const PARM5 = 19
const PARM6 = 22
const PARM7 = 25
const RETURN = 1

// CSQC_InputEvent event types (QSS progs.h:360). The joystick/accelerometer/gyro ones have no
// browser equivalent.
const CSIE = {
  keydown: 0,
  keyup: 1,
  mousedelta: 2,
  mouseabs: 3
};

// Passed to CSQC_Init. Not a QuakeSpasm version number - mods branch on the engine NAME first.
const engine_version = 1
const engine_name = 'netquake.io'

// GAME_COOP/GAME_DEATHMATCH: what svc_serverinfo's gametype byte carries.
const GAME_COOP = 0

// Entry points resolved by name after each load (QSS QCEXTFUNCS_CS + the shared COMMON/GAME
// pair). Values are function numbers; 0 means absent, as QSS's func_t does.
const func_names = [
  'CSQC_Init',
  'CSQC_Shutdown',
  'CSQC_DrawHud',
  'CSQC_DrawScores',
  'CSQC_InputEvent',
  'CSQC_ConsoleCommand',
  'CSQC_Parse_Event',
  'CSQC_Parse_Damage',
  'CSQC_UpdateView',
  'CSQC_UpdateViewLoading',
  'CSQC_Input_Frame',
  'CSQC_Parse_CenterPrint',
  'CSQC_Parse_Print',
  'CSQC_Ent_Update',
  'CSQC_Ent_Remove',
  'CSQC_Event_Sound',
  'CSQC_Parse_TempEntity',
  'CSQC_Parse_StuffCmd',
  // Resolved but never called: no renderer-restart seam here, the GL context lives as long as the page.
  'CSQC_RendererRestarted',
  'GameCommand',
  'EndFrame'
] as const;
type FuncName = typeof func_names[number]

// Globals the engine publishes to / reads from csqc, by global offset (null = not declared).
// The fixed NQ sysdef globals (time, self, mapname, ...) are covered by pr.globalvars instead.
const global_names = [
  'cltime',
  'clframetime',
  'maxclients',
  'intermission',
  'intermission_time',
  'player_localnum',
  'player_localentnum',
  'view_angles',
  'clientcommandframe',
  'servercommandframe',
  'physics_mode',
  // The move CSQC_Input_Frame gets to rewrite (QSS QCEXTGLOBALS_INPUTS, progs.h:234). Delta from
  // QSS: input_weapon and input_cursor_* omitted, as they only reach a server over
  // PEXT2_PRYDONCURSOR, which we never negotiate.
  'input_sequence',
  'input_servertime',
  'input_timelength',
  'input_angles',
  'input_movevalues',
  'input_buttons',
  'input_impulse'
] as const;
type GlobalName = typeof global_names[number]
// The rest are floats; a mismatched type means "not declared".
const vector_globals: Set<string> = new Set(['view_angles', 'input_angles', 'input_movevalues'])

// Entity fields the engine reads off csqc edicts, by field offset (null = not declared).
// origin/angles/frame/skin are fixed NQ offsets, in pr.entvars.
const field_names = [
  'alpha', 'scale', 'colormod', 'tag_entity', 'tag_index', 'modelflags',
  'frame2', 'lerpfrac', 'frame1time', 'frame2time', 'renderflags',
  'entnum', 'drawmask', 'predraw'
] as const;
type FieldName = typeof field_names[number]

export const cvr: CVars = {
}

const emptyFuncs = function (): Record<FuncName, number> {
  const funcs = {} as Record<FuncName, number>;
  for (const name of func_names)
    funcs[name] = 0;
  return funcs;
};

const emptyGlobals = function (): Record<GlobalName, number | null> {
  const globals = {} as Record<GlobalName, number | null>;
  for (const name of global_names)
    globals[name] = null;
  return globals;
};

const emptyFields = function (): Record<FieldName, number | null> {
  const fields = {} as Record<FieldName, number | null>;
  for (const name of field_names)
    fields[name] = null;
  return fields;
};

export let state = {
  // A csprogs is loaded and CSQC_Init has run.
  active: false,
  // Full csqc (the client progs is trusted): UpdateView, entity stream and input hooks are
  // live. Otherwise "simple csqc" - HUD/scoreboard drawing only.
  fullcsqc: false,
  // Simple-tier progs must not learn anything the player couldn't see (QSS qcvm->nogameaccess).
  // Enforced two ways: entry points and frame globals zeroed at load (QSS host.c:817), and
  // position-revealing callsites (sound/temp-entity hooks, getproperty VF_ORIGIN/VF_ANGLES,
  // getentity) refusing on this flag.
  nogameaccess: false,
  extfuncs: emptyFuncs(),
  extglobals: emptyGlobals(),
  extfields: emptyFields(),
  // setcursormode (QSS qcvm->cursorforced, progs.h:396). Browser-side this means running WITHOUT
  // pointer lock - see input.applyCursorMode.
  cursorforced: false,
  // setsensitivityscaler (QSS cl.csqc_sensitivity, client.h:317); 1 = the sensitivity cvar alone.
  sensitivity: 1,
  // Partial svc_print / svc_stufftext lines (QSS cl.printbuffer / cl.stuffcmdbuf, client.h:291):
  // the hooks are line-at-a-time, the wire is not.
  printbuffer: '',
  stuffbuffer: '',
  // Keys the progs was told went down, so it can't be handed an up event it never saw a down for
  // (FTE csqckeysdown[], pr_csqc.c:9001).
  keysdown: new Uint8Array(256),
  // The csprogs the server says it is running (csqc_progname/crc/size stufftexts). Must NOT be
  // cleared by clearState: those stufftexts run one frame BEFORE load(), which begins by clearing
  // state. clearAdvertisement resets it per connection instead. Empty name = no full tier.
  advertised: { name: '', crc: 0, size: 0 }
};

// Resolve an ext global to its offset, requiring the type the engine will read it as
// (QSS PR_FindExtGlobal, pr_ext.c:8553). Active VM.
const findGlobalOfs = function (name: string, type: number): number | null {
  const d = ed.findGlobal(name);
  if (d == null || (d.type & 0x7fff) !== type || d.ofs >= pr.state.globals_float.length)
    return null;
  return d.ofs;
};

const resolveExt = function () {
  for (const name of func_names)
    state.extfuncs[name] = ed.findFunction(name) ?? 0;
  for (const name of global_names)
    state.extglobals[name] = findGlobalOfs(name, vector_globals.has(name) ? pr.ETYPE.ev_vector : pr.ETYPE.ev_float);
  for (const name of field_names) {
    const d = ed.findField(name);
    state.extfields[name] = (d != null) ? d.ofs : null;
  }
};

// Write a float extglobal, if the progs declared it.
const setGlobal = function (name: GlobalName, value: number) {
  const ofs = state.extglobals[name];
  if (ofs != null)
    pr.state.globals_float[ofs] = value;
};

// Run a csqc entry point with the csqc VM switched in. `setup` must run after the switch - what it
// publishes belongs to the csqc VM's global block.
export const callFunction = function (fnum: number, setup?: () => void) {
  pr.switchVM(pr.vms.csqc);
  try {
    if (setup != null)
      setup();
    pr.executeProgram(fnum);
  } finally {
    // A host error thrown out of QC leaves the stack half-unwound; drop it so switching away
    // doesn't trip the on-the-stack guard.
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
    // A clip rect the QC set (or died holding) must not clip what the engine draws next (QSS
    // sbar.c:1024).
    draw.resetClip();
  }
};

// Whether engine drawing code may call csqc entry point `fnum`. QSS tests `!qcvm` (sbar.c:989) to
// mean "not a re-entry from inside QC"; pr.state is never null here, so depth === 0 is the
// equivalent - renderscene reaches the sbar from inside CSQC_UpdateView with depth > 0.
export const canDraw = function (fnum: number): boolean {
  return state.active && (fnum !== 0) && (pr.state.depth === 0);
};

// csqc owns the hud, so the 3D view is fullscreen (QSS gl_screen.c:395).
export const drawsHud = function (): boolean {
  return state.active && ((state.extfuncs.CSQC_DrawHud !== 0) || (state.extfuncs.CSQC_UpdateView !== 0));
};

// CSQC_UpdateView owns the whole screen this frame: no engine 3D pass, sbar or crosshair (QSS
// gl_screen.c:1141). The nodes check stands in for QSS's NULL cl.worldmodel: on a `map` command
// mod.clearAll guts the old worldmodel IN PLACE while csqc is still active, leaving the reference
// non-null.
export const ownsView = function (): boolean {
  const world = cl.clState.worldmodel;
  return canDraw(state.extfuncs.CSQC_UpdateView)
    && (world != null) && ((world as any).nodes != null) && (pr.vms.csqc.worldmodel != null);
};

// Persistent so the setup hooks stay plain function references, not per-frame closures.
const drawArgs = { showscores: false, intermission: false };

// Client-state globals every csqc draw entry point is entered with (QSS sbar.c:999,
// gl_screen.c:1149). Runs with the csqc VM switched in.
const setClientGlobals = function () {
  const globals_float = pr.state.globals_float;

  globals_float[pr.globalvars.time] = pr.state.time;
  globals_float[pr.globalvars.frametime] = pr.state.frametime;
  setGlobal('cltime', host.state.realtime);
  setGlobal('clframetime', host.state.frametime);
  setGlobal('player_localentnum', cl.clState.viewentity);
};

// QSS sbar.c:999 / 1448.
const setDrawGlobals = function () {
  const globals_float = pr.state.globals_float;

  setClientGlobals();
  if (drawArgs.intermission) {
    setGlobal('intermission', cl.clState.intermission);
    setGlobal('intermission_time', cl.clState.completed_time);
  }

  // PARM0 = virtual canvas (pfcl's draw builtins scale by the same factor), PARM1 = +showscores.
  const s = pfcl.vmScale();
  globals_float[PARM0] = vid.state.width / s;
  globals_float[PARM0 + 1] = vid.state.height / s;
  globals_float[PARM0 + 2] = 0;
  globals_float[PARM1] = drawArgs.showscores ? 1 : 0;
};

// QSS gl_screen.c:1149. Unlike the hud entry points this one always carries the intermission pair,
// view angles and command frames, and takes the virtual canvas as two scalars, not a vector.
const setViewGlobals = function () {
  const globals_float = pr.state.globals_float;

  setClientGlobals();
  setGlobal('intermission', cl.clState.intermission);
  setGlobal('intermission_time', cl.clState.completed_time);
  const ofs = state.extglobals.view_angles;
  if (ofs != null) {
    const ang = cl.clState.viewangles;
    globals_float[ofs] = ang[0];
    globals_float[ofs + 1] = ang[1];
    globals_float[ofs + 2] = ang[2];
  }
  setGlobal('clientcommandframe', cl.clState.movemessages);
  // Delta from QSS, which publishes cl.ackedmovemessages: we have no move acks.
  setGlobal('servercommandframe', 0);

  const s = pfcl.vmScale();
  globals_float[PARM0] = vid.state.width / s;
  globals_float[PARM1] = vid.state.height / s;
  globals_float[PARM2] = 1;   // notmenu: this is csqc, not menuqc
};

// CSQC_UpdateView(vwidth, vheight, notmenu) - the mod draws the whole frame, 3D included. Before
// the signon completes it goes to CSQC_UpdateViewLoading instead (QSS gl_screen.c:1172).
export const updateView = function () {
  const fn = ((cl.cls.signon === 4) || (state.extfuncs.CSQC_UpdateViewLoading === 0))
    ? state.extfuncs.CSQC_UpdateView : state.extfuncs.CSQC_UpdateViewLoading;
  callFunction(fn, setViewGlobals);
};

// CSQC_DrawHud(virtsize, showscores) - the mod's status bar, in place of the engine's.
export const drawHud = function (showscores: boolean) {
  drawArgs.showscores = showscores;
  drawArgs.intermission = false;
  callFunction(state.extfuncs.CSQC_DrawHud, setDrawGlobals);
};

// CSQC_DrawScores(virtsize, showscores) - the mod's scoreboard, in place of the engine's
// deathmatch/intermission overlays.
export const drawScores = function (showscores: boolean, intermission: boolean) {
  drawArgs.showscores = showscores;
  drawArgs.intermission = intermission;
  callFunction(state.extfuncs.CSQC_DrawScores, setDrawGlobals);
};

// ---- the csqc entity stream ----

// Persistent: the parse loop runs once per entity per datagram.
const entArgs = { isnew: false };

// The csqc edict a server entity streams into, allocated on first sight (QSS
// CSQC_UpdateCsEdictForSSQC, cl_parse.c:788). Active VM must be csqc.
const edictForSSQC = function (entnum: number): Edict {
  var map = cl.clState.ssqc_to_csqc;
  if (entnum >= map.length) {
    // Grow-only and in blocks, as QSS's realloc is (cl_parse.c:793).
    if (entnum >= def.max_edicts)
      host.throwEndGame('CSQC: entnum > MAX_EDICTS\n');
    const grown = new Int32Array(Math.min(def.max_edicts, entnum + 64));
    grown.set(map);
    cl.clState.ssqc_to_csqc = map = grown;
  }

  const known = (map[entnum] !== 0) ? pr.state.edicts[map[entnum]] : null;
  // Delta from QSS: the free check. Our map holds edict NUMBERS and ed.alloc recycles freed
  // edicts, so a stale slot could name an unrelated entity; QSS's pointers cannot.
  if ((known != null) && (known.free !== true)) {
    entArgs.isnew = false;
    return known;
  }
  const fresh = ed.alloc();
  map[entnum] = fresh.num;
  const ofs = state.extfields.entnum;
  if (ofs != null)
    fresh.v_float[ofs] = entnum;
  entArgs.isnew = true;
  return fresh;
};

// CSQC_Ent_Update(isnew) for one server entity, self bound to its csqc edict; returns whether the
// update created it. Not callFunction: that resets the clip rect, a renderer flush with no
// business running per entity per datagram.
export const entUpdate = function (entnum: number): boolean {
  pr.switchVM(pr.vms.csqc);
  try {
    const e = edictForSSQC(entnum);
    pr.state.globals_float[PARM0] = entArgs.isnew ? 1 : 0;
    pr.state.globals_int[pr.globalvars.self] = e.num;
    pr.executeProgram(state.extfuncs.CSQC_Ent_Update);
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
  return entArgs.isnew;
};

// CSQC_Ent_Remove for a server entity that left the stream; the engine frees the edict itself when
// the progs has none (QSS CSQC_ClearCsEdictForSSQC, cl_parse.c:769).
export const entRemove = function (entnum: number) {
  const map = cl.clState.ssqc_to_csqc;
  if (entnum >= map.length)
    return;
  const num = map[entnum];
  if (num === 0)
    return;
  map[entnum] = 0;

  pr.switchVM(pr.vms.csqc);
  try {
    const e = pr.state.edicts[num];
    if ((e == null) || (e.free === true))
      return;
    pr.state.globals_int[pr.globalvars.self] = num;
    if (state.extfuncs.CSQC_Ent_Remove !== 0)
      pr.executeProgram(state.extfuncs.CSQC_Ent_Remove);
    else
      ed.free(e);
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// ---- ssqc -> csqc events ----

// svcfte_cgamepacket (QSS cl_parse.c:2918). A missing entry point is fatal, as it is there: the
// payload carries no length, so there is nothing to skip past.
export const parseEvent = function () {
  if (state.extfuncs.CSQC_Parse_Event === 0)
    host.throwError('CSQC_Parse_Event: Missing or incompatible CSQC\n');
  pr.switchVM(pr.vms.csqc);
  try {
    pr.executeProgram(state.extfuncs.CSQC_Parse_Event);
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// ---- input ----

// CSQC_InputEvent(evtype, a, b, devid) -> "I handled it". Not callFunction: its clip-rect reset is
// a renderer flush with no business running per key press and mouse move.
const inputEvent = function (evtype: number, a: number, b: number): boolean {
  pr.switchVM(pr.vms.csqc);
  try {
    const g = pr.state.globals_float;
    g[PARM0] = evtype;
    // QSS writes each parm as a whole vector with the next scalar duplicated into .y
    // (keys.c:1331); the QC reads them as floats either way.
    g[PARM1] = a; g[PARM1 + 1] = b; g[PARM1 + 2] = 0;
    g[PARM2] = b; g[PARM2 + 1] = 0; g[PARM2 + 2] = 0;
    // devid: we have the one mouse/keyboard, as QSS does.
    g[PARM3] = 0; g[PARM3 + 1] = 0; g[PARM3 + 2] = 0;
    pr.executeProgram(state.extfuncs.CSQC_InputEvent);
    return pr.state.globals_float[RETURN] !== 0;
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// Whether an input event may reach the progs. The depth test is canDraw's reentry guard: switching
// VMs with a program on the stack is a hard error. Deliberately NOT gated on nogameaccess - QSS
// leaves CSQC_InputEvent live for simple csqc (host.c:817 zeroes the others, not this one).
const canInput = function (): boolean {
  return state.active && (state.extfuncs.CSQC_InputEvent !== 0) && (pr.state.depth === 0);
};

// QSS drops mouse motion outright in any other key_dest (in_sdl.c:537).
const inputDest = function (): boolean {
  return (key.state.dest === key.KEY_DEST.game) || (key.state.dest === key.KEY_DEST.message);
};

// CSQC_HandleKeyEvent (QSS keys.c:1325). csqc sees key-downs only while the game owns the keyboard
// but every key-up, so a key released into the console still ends what it started; and may only
// SWALLOW an event in game dest. Delta from QSS, which passes 0 for unicode and so makes csqc text
// entry impossible: we pass the real character, as FTE does (pr_csqc.c:9014).
export const keyEvent = function (keynum: number, down: boolean, unicode: number): boolean {
  const game = key.state.dest === key.KEY_DEST.game;
  if (!canInput() || !(game || !down))
    return false;
  // Down-key bookkeeping from FTE (pr_csqc.c:9032): our focus handler releases all 256 keys on
  // window focus, which would otherwise be 256 phantom key-ups into the progs.
  if (down)
    state.keysdown[keynum] = 1;
  else if (state.keysdown[keynum] === 0)
    return false;
  else
    state.keysdown[keynum] = 0;
  const inhibit = inputEvent(down ? CSIE.keydown : CSIE.keyup, key.nativeToQC(keynum), unicode);
  return game && inhibit;
};

// A pointer-locked mouse movement (QSS IN_MouseMotion's relative branch, in_sdl.c:556); returns
// whether the engine should drop it instead of turning the view.
export const mouseDelta = function (dx: number, dy: number): boolean {
  if (!canInput() || !inputDest())
    return false;
  return inputEvent(CSIE.mousedelta, dx, dy);
};

// A cursor-mode mouse position (QSS IN_MouseMotion's absolute branch, in_sdl.c:544), divided by
// the same scale the draw builtins multiply by, since the progs draws its cursor in the virtual
// canvas.
export const mouseAbs = function (x: number, y: number) {
  if (!canInput() || !inputDest())
    return;
  const s = pfcl.vmScale();
  inputEvent(CSIE.mouseabs, x / s, y / s);
};

// QSS's gamecodecursor term (in_sdl.c:305): only while the game owns the input, as the console and
// menu run their own cursor.
export const cursorActive = function (): boolean {
  return state.active && state.cursorforced && (key.state.dest === key.KEY_DEST.game);
};

// ---- the input frame ----

// Publish the move being composed into the input_* globals (set half of QSS PR_GetSetInputs,
// pr_ext.c:1825). An undeclared global is skipped on both halves, leaving the engine's own value
// alone. Active VM must be csqc.
export const publishInputs = function () {
  const clState = cl.clState;
  const c = clState.cmd;
  const globals_float = pr.state.globals_float;

  // The sequence this move will be sent as (QSS CL_FinishMove, cl_input.c:463).
  setGlobal('input_sequence', clState.movemessages);
  setGlobal('input_servertime', clState.time);
  setGlobal('input_timelength', clState.time - clState.lastcmdtime);
  const ang = state.extglobals.input_angles;
  if (ang != null) {
    const va = clState.viewangles;
    globals_float[ang] = va[0];
    globals_float[ang + 1] = va[1];
    globals_float[ang + 2] = va[2];
  }
  const mv = state.extglobals.input_movevalues;
  if (mv != null) {
    globals_float[mv] = c.forwardmove;
    globals_float[mv + 1] = c.sidemove;
    globals_float[mv + 2] = c.upmove;
  }
  setGlobal('input_buttons', c.buttons);
  setGlobal('input_impulse', c.impulse);
};

// Read the input_* globals back into the move (get half of PR_GetSetInputs, pr_ext.c:1858).
// Delta from QSS: the angles the progs writes are the SENT angles, matching FTE (pr_csqc.c:3980);
// on QSS the write-back reaches prediction only. input_sequence/servertime/timelength are
// deliberately not read back - we send no sequence and don't predict. Active VM must be csqc.
const readInputs = function () {
  const clState = cl.clState;
  const c = clState.cmd;
  const globals_float = pr.state.globals_float;

  const ang = state.extglobals.input_angles;
  if (ang != null) {
    const va = clState.viewangles;
    va[0] = globals_float[ang];
    va[1] = globals_float[ang + 1];
    va[2] = globals_float[ang + 2];
  }
  const mv = state.extglobals.input_movevalues;
  if (mv != null) {
    c.forwardmove = globals_float[mv];
    c.sidemove = globals_float[mv + 1];
    c.upmove = globals_float[mv + 2];
  }
  const buttons = state.extglobals.input_buttons;
  if (buttons != null)
    c.buttons = globals_float[buttons] >> 0;
  const impulse = state.extglobals.input_impulse;
  if (impulse != null)
    c.impulse = globals_float[impulse] >> 0;
};

// CSQC_Input_Frame: the progs rewrites the move about to be sent (QSS CL_SendCmd,
// cl_main.c:1338). The nogameaccess term repeats the load-time zeroing, as QSS does at
// cl_main.c:1340; the depth test is canDraw's reentry guard.
export const inputFrame = function () {
  if (!state.active || (state.extfuncs.CSQC_Input_Frame === 0) || state.nogameaccess
    || (pr.state.depth !== 0))
    return;
  pr.switchVM(pr.vms.csqc);
  try {
    // Delta from QSS, which publishes the command frames only before CSQC_UpdateView: FTE
    // publishes clientcommandframe here too (pr_csqc.c:9429), and a progs reading it as "the
    // frame I am building" needs that.
    setGlobal('clientcommandframe', cl.clState.movemessages);
    setGlobal('servercommandframe', 0);
    publishInputs();
    pr.executeProgram(state.extfuncs.CSQC_Input_Frame);
    readInputs();
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// ---- parse hooks and console commands ----

// Whether a parse hook may run; the depth term is canDraw's reentry guard. None of the hooks go
// through callFunction: its clip-rect reset is a renderer flush with no business running per svc.
const canParse = function (fnum: number): boolean {
  return state.active && (fnum !== 0) && (pr.state.depth === 0);
};

// Run a parse hook taking a string (and optionally a float). Callers of the void-returning hooks
// must ignore the return: it is whatever the last call left.
const callWithString = function (fnum: number, text: string, parm1?: number): number {
  pr.switchVM(pr.vms.csqc);
  const mark = pr.tempMark(pr.vms.csqc);
  try {
    // pr.tempString, not a fixed slot: the hook's own tempstrings allocate from the current mark,
    // so an argument parked in slot 0 is the first thing they overwrite.
    pr.state.globals_int[PARM0] = pr.tempString(text);
    if (parm1 !== undefined)
      pr.state.globals_float[PARM1] = parm1;
    pr.executeProgram(fnum);
    return pr.state.globals_float[RETURN];
  } finally {
    pr.tempRelease(mark, pr.vms.csqc);
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// CSQC_Parse_CenterPrint(msg) -> the engine's own centerprint is suppressed (QSS
// CL_ParseCenterPrint, cl_parse.c:2461). Live for simple csqc. Delta from QSS, which ignores the
// return and always suppresses: we honour the declared float return, as FTE does (pr_csqc.c:9397),
// so a progs can hand a centerprint back to the engine.
export const parseCenterPrint = function (text: string): boolean {
  const fn = state.extfuncs.CSQC_Parse_CenterPrint;
  if (!canParse(fn))
    return false;
  return callWithString(fn, text) !== 0;
};

// CSQC_Parse_Print(msg, printlvl), and the engine print when the progs has no hook (QSS
// CL_ParsePrint, cl_parse.c:2418). svc_print fragments do not arrive a line at a time, so they
// accumulate and the hook runs once per completed line, terminator included. The hook is void:
// having it at all suppresses the engine print. Live for simple csqc.
export const parsePrint = function (text: string) {
  const fn = state.extfuncs.CSQC_Parse_Print;
  if (!canParse(fn)) {
    flushPrintBuffer();
    con.print(text);
    return;
  }

  state.printbuffer += text;
  for (; ;) {
    const buf = state.printbuffer;
    if (buf.length === 0)
      return;
    var end = -1;
    const cap = (buf.length < pr.STRINGTEMP_LENGTH - 1) ? buf.length : pr.STRINGTEMP_LENGTH - 1;
    for (var i = 0; i < cap; ++i) {
      const c = buf.charCodeAt(i);
      if ((c === 13) || (c === 10)) {
        end = i + 1;
        break;
      }
    }
    if (end < 0) {
      // No terminator: wait, unless the line no longer fits a tempstring - QSS's scan gives up at
      // the same point and dispatches what it has.
      if (buf.length < pr.STRINGTEMP_LENGTH - 1)
        return;
      end = pr.STRINGTEMP_LENGTH - 1;
    }
    state.printbuffer = buf.substring(end);
    // NQ has no print levels on the wire; guess from the leading \x01 chat prefix, as QSS does
    // (cl_parse.c:2445).
    callWithString(fn, buf.substring(0, end), (buf.charCodeAt(0) === 1) ? 3 : 2);
  }
};

// So a partial line isn't lost when the progs stops answering for prints (QSS cl_parse.c:2452).
const flushPrintBuffer = function () {
  if (state.printbuffer.length === 0)
    return;
  const held = state.printbuffer;
  state.printbuffer = '';
  con.print(held);
};

// Stufftext split into lines and offered to CSQC_Parse_StuffCmd (QSS CL_ParseStuffText,
// cl_parse.c:2293); false means the caller buffers it as always. The split follows QSS: only
// commands the engine registered as src_server (never an alias, never a cvar) stay with the
// engine, everything else goes to the progs. Delta from QSS: the engine's share still goes
// through the command buffer rather than executing at parse time, keeping it in buffer order.
export const parseStuffText = function (text: string): boolean {
  const fn = state.extfuncs.CSQC_Parse_StuffCmd;
  if (!canParse(fn))
    return false;

  state.stuffbuffer += text;
  for (; ;) {
    const buf = state.stuffbuffer;
    const nl = buf.indexOf('\n');
    if (nl < 0)
      return true;
    const line = buf.substring(0, nl);
    state.stuffbuffer = buf.substring(nl + 1);
    if (cmd.isServerCommand(firstToken(line)))
      cmd.state.text += line + '\n';
    else
      callWithString(fn, line + '\n');   // the terminator goes back on, for lazy localcmds
  }
};

// What Cmd_TokenizeString would put in argv[0].
const firstToken = function (line: string): string {
  var i = 0;
  while ((i < line.length) && (line.charCodeAt(i) <= 32))
    ++i;
  var end = i;
  while ((end < line.length) && (line.charCodeAt(end) > 32))
    ++end;
  return line.substring(i, end);
};

// A stufftext that never got its newline: QSS pushes one in at the end of a server message
// (cl_parse.c:2526).
export const flushStuffText = function () {
  if (state.stuffbuffer.length !== 0)
    parseStuffText('\n');
};

// CSQC_Parse_Damage(save, take, dir) -> the engine's blend and view kick are suppressed (QSS
// V_ParseDamage, view.c:284). `from` is the raw origin off the wire, not the normalized delta from
// the view entity - that fixup happens after this returns, there too. Live for simple csqc.
export const parseDamage = function (armor: number, blood: number, from: V3): boolean {
  const fn = state.extfuncs.CSQC_Parse_Damage;
  if (!canParse(fn))
    return false;
  pr.switchVM(pr.vms.csqc);
  try {
    const g = pr.state.globals_float;
    g[pr.globalvars.time] = cl.clState.time;
    g[PARM0] = armor;
    g[PARM1] = blood;
    g[PARM2] = from[0]; g[PARM2 + 1] = from[1]; g[PARM2 + 2] = from[2];
    pr.executeProgram(fn);
    return g[RETURN] !== 0;
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// CSQC_Event_Sound(entnum, channel, soundname, vol, attenuation, pos, pitchmod, flags) -> the
// engine does not start the sound (QSS CL_ParseStartSoundPacket, cl_parse.c:1224). Blocked for
// simple csqc: it would give away entity positions. Volume is the raw 0-255 wire byte, as in QSS.
export const eventSound = function (entnum: number, channel: number, name: string, volume: number,
  attenuation: number, pos: V3, flags: number): boolean {
  const fn = state.extfuncs.CSQC_Event_Sound;
  if (!canParse(fn) || state.nogameaccess)
    return false;
  pr.switchVM(pr.vms.csqc);
  const mark = pr.tempMark(pr.vms.csqc);
  try {
    const g = pr.state.globals_float;
    setGlobal('player_localentnum', cl.clState.viewentity);
    g[PARM0] = entnum;
    g[PARM1] = channel;
    pr.state.globals_int[PARM2] = pr.tempString(name);	// past the mark, as callWithString does
    g[PARM3] = volume;
    g[PARM4] = attenuation;
    g[PARM5] = pos[0]; g[PARM5 + 1] = pos[1]; g[PARM5 + 2] = pos[2];
    g[PARM6] = 100;   // pitchmod: no pitch shifting on the wire, so 100%, as in QSS
    g[PARM7] = flags;
    pr.executeProgram(fn);
    return g[RETURN] !== 0;
  } finally {
    pr.tempRelease(mark, pr.vms.csqc);
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// CSQC_Parse_TempEntity() -> the progs consumed the svc_temp_entity payload (QSS CL_ParseTEnt,
// cl_tent.c:152). A zero return must restore the read cursor, including the type byte the QC read
// to decide. Blocked for simple csqc, as Event_Sound is.
export const parseTempEntity = function (): boolean {
  const fn = state.extfuncs.CSQC_Parse_TempEntity;
  if (!canParse(fn) || state.nogameaccess)
    return false;
  const start = msg.state.readcount;
  pr.switchVM(pr.vms.csqc);
  try {
    pr.executeProgram(fn);
    if (pr.state.globals_float[RETURN] !== 0)
      return true;
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
  msg.state.readcount = start;
  return false;
};

// CSQC_ConsoleCommand(cmdstr) -> the progs handled the command, so the engine doesn't (QSS
// Cmd_ExecuteString, cmd.c:874). Must return with the csqc VM switched OUT: the engine handler
// that runs on false is not written to survive a foreign VM being active. Live for simple csqc.
export const consoleCommand = function (text: string): boolean {
  const fn = state.extfuncs.CSQC_ConsoleCommand;
  if (!canParse(fn))
    return false;
  return callWithString(fn, text) !== 0;
};

// GameCommand(cmdtext) - DarkPlaces' pre-CSQC_ConsoleCommand way in, for mods that only have that
// one. QSS wires it up for menuqc only; the csqc half is FTE's `cl_cmd` (pr_csqc.c:9158).
const cl_cmd_f = function () {
  const fn = state.extfuncs.GameCommand;
  if (!canParse(fn)) {
    con.print('cl_cmd: no csqc GameCommand function available\n');
    return;
  }
  // cmd.state.args is only rewritten when a command HAS arguments; a bare `cl_cmd` would otherwise
  // hand the progs the previous command's tail.
  callWithString(fn, (cmd.state.argv.length > 1) ? cmd.state.args : '');
};

const clearState = function () {
  pfcl_scene.reset();
  // The poly batch dies with the client state (FTE reaches CL_ClearEntityLists from CL_ClearState too).
  r.clearScenePolygons();
  pfcl.polyReset();
  // A print the progs never got a terminator for belongs on the console, not in the bin.
  flushPrintBuffer();
  state.stuffbuffer = '';
  // Every csqc edict the stream was tracking dies with the VM (QSS CL_FreeState, cl_main.c:103).
  // Null when csqc.init calls this before cl.init.
  if (cl.clState != null)
    cl.clState.ssqc_to_csqc.fill(0);
  state.active = false;
  state.fullcsqc = false;
  state.nogameaccess = false;
  state.extfuncs = emptyFuncs();
  state.extglobals = emptyGlobals();
  state.extfields = emptyFields();
  // QSS clears both with the VM/client state (CL_ClearState, cl_main.c:143). Pointer lock needs no
  // undoing: dropping cursorforced lets the next canvas click re-acquire it.
  state.cursorforced = false;
  state.sensitivity = 1;
  state.keysdown.fill(0);
};

// The client VM gets a world whether or not a csprogs loaded (QSS host.c:874), so shared
// link/trace code can run on it either way. Active VM is csqc.
const giveWorld = function () {
  pr.state.worldmodel = cl.clState.worldmodel;
  pr.state.getModel = cl.modelForIndex;
  sv.clearWorld();
};

// Give up on the load: drop the progs and leave csqc inactive. The active VM must be csqc.
const unload = function () {
  clearState();
  pr.resetVM(pr.vms.csqc);
  giveWorld();
};

// The globals and worldspawn edict a csprogs expects at CSQC_Init (QSS host.c:832). Active VM is csqc.
const seedVM = function () {
  const clState = cl.clState;
  const globals_float = pr.state.globals_float;
  const globals_int = pr.state.globals_int;

  setGlobal('maxclients', clState.maxclients);
  pr.state.time = clState.time;
  globals_float[pr.globalvars.time] = clState.time;
  globals_int[pr.globalvars.mapname] = newString(mapNameOf(clState.worldmodel.name));
  globals_float[pr.globalvars.total_monsters] = clState.stats[def.STAT.totalmonsters];
  globals_float[pr.globalvars.total_secrets] = clState.stats[def.STAT.totalsecrets];
  globals_float[pr.globalvars.deathmatch] = clState.gametype;
  globals_float[pr.globalvars.coop] = ((clState.gametype === GAME_COOP) && (clState.maxclients !== 1)) ? 1 : 0;
  // A guess, as in QSS, but scoreboards depend on it.
  setGlobal('player_localnum', clState.viewentity - 1);

  const world = pr.state.edicts[0];
  const model = clState.worldmodel;
  world.v_float[pr.entvars.solid] = sv.SOLID.bsp;
  world.v_float[pr.entvars.movetype] = sv.MOVE_TYPE.push;
  world.v_float[pr.entvars.modelindex] = 1;
  world.v_int[pr.entvars.model] = newString(model.name);
  ed.setVector(world, pr.entvars.mins, model.mins);
  ed.setVector(world, pr.entvars.maxs, model.maxs);
  world.v_int[pr.entvars.message] = newString(clState.levelname);
};

const newString = function (s: string): number {
  return pr.newString(s, s.length + 1);
};

// "maps/e1m1.bsp" -> "e1m1", as QSS derives cl.mapname (cl_parse.c:1525).
const mapNameOf = function (path: string): string {
  const slash = path.lastIndexOf('/');
  return com.removeExtension((slash >= 0) ? path.substring(slash + 1) : path);
};

// Find and load the csprogs for this server (QSS CL_LoadCSProgs, host.c:793): the hashed version
// from the download cache, then the name it gave, then the plain one. Delta from QSS: no progs.dat
// fallback, which would run the server progs client-side. Active VM is csqc.
const loadChain = async function (): Promise<string | null> {
  const adv = state.advertised;
  const candidates: string[] = [];
  if (adv.crc !== 0)
    candidates.push('csprogsvers/' + adv.crc.toString(16) + '.dat'); // QSS's "%x" cache name
  if ((adv.name !== '') && (adv.name !== 'csprogs.dat'))
    candidates.push(adv.name);
  candidates.push('csprogs.dat');

  for (const name of candidates) {
    if (!await pr.loadProgs(name, {
      builtins: pfcl.state.builtin, ext: pfcl.state.ebfs_builtins, optional: true
    }))
      continue;
    resolveExt();
    // A file the server pointed us at must own the screen or the hud to be worth running; a
    // scoreboard-only progs is accepted under the plain name alone (QSS host.c:795).
    if (state.extfuncs.CSQC_DrawHud || state.extfuncs.CSQC_UpdateView
      || ((name === 'csprogs.dat') && state.extfuncs.CSQC_DrawScores))
      return name;
    con.print(name + ' has no CSQC entry points - ignored\n');
    unload();
  }
  return null;
};

// Load csprogs.dat for the map that just precached. Must run after cl.checkDownloads() resolves
// (worldmodel and precaches up) and before the prespawn stringcmd goes out, where QSS runs
// CL_LoadCSProgs.
export const load = async function () {
  pr.resetVM(pr.vms.csqc);
  clearState();
  if (cl.clState.worldmodel == null)
    return;

  pr.switchVM(pr.vms.csqc);
  try {
    giveWorld();
    // QSS only tries csqc when the extension system is on at all.
    if (!pr.cvr.pr_checkextension.value || cvr.cl_nocsqc.value)
      return;

    const loaded = await loadChain();
    if (loaded == null)
      return;

    // Full csqc trusts the client progs with game state, so it needs an advertised identity the
    // local file matches, or demo playback (QSS host.c:806 - the tier reads those two only, never
    // the pext masks; PEXT1_CSQC gates the entity stream separately). Delta from QSS: the
    // isLocalServer term, since the advertisement only goes to clients that negotiated
    // PEXT1_CSQC and a listen-server player with cl_nopext would otherwise lose the tier.
    const adv = state.advertised;
    state.fullcsqc = ((adv.name !== '') && (pr.state.progshash === adv.crc) && (pr.state.progssize === adv.size))
      || cl.cls.demoplayback || cl.cls.isLocalServer;
    if (!state.fullcsqc) {
      if (!state.extfuncs.CSQC_DrawHud) {
        con.print('csprogs.dat needs CSQC_DrawHud for the simple csqc interface - ignored\n');
        unload();
        return;
      }
      state.nogameaccess = true;
      state.extfuncs.CSQC_Input_Frame = 0;    // no reading/writing input frames (no wallhacks please)
      state.extfuncs.CSQC_UpdateView = 0;     // would bug out without the entity stream
      state.extfuncs.CSQC_Ent_Update = 0;     // don't let the progs know where entities are
      state.extfuncs.CSQC_Ent_Remove = 0;
      state.extfuncs.CSQC_Parse_StuffCmd = 0; // don't allow blocking stuffcmds
      state.extglobals.clientcommandframe = null; // input frames are blocked; don't connect these
      state.extglobals.servercommandframe = null;
    }

    // The client VM's own edict array, capped as the server's is. ed.alloc grows it through
    // sv.ensureEdict, which allocates against the ACTIVE VM.
    pr.state.max_edicts = def.max_edicts;
    pr.state.edicts = [sv.makeEdict(0)];
    pr.state.num_edicts = pr.state.reserved_edicts = 1;
    seedVM();

    if (state.extfuncs.CSQC_Init) {
      pr.state.globals_float[PARM0] = state.fullcsqc ? 1 : 0;
      pr.state.globals_int[PARM1] = newString(engine_name);
      pr.state.globals_float[PARM2] = engine_version;
      pr.executeProgram(state.extfuncs.CSQC_Init);
    }
    con.dPrint('csqc: loaded ' + loaded + ', ' + pr.state.progssize + ' bytes, '
      + (state.fullcsqc ? 'full' : 'simple') + ' tier\n');
    state.active = true;
    if (state.fullcsqc) {
      // Ask the server for the entity stream (QSS host.c:876). It rides the same client message as
      // the `prespawn` sent the moment this returns, so the server has csqcactive set before the
      // first post-spawn datagram.
      msg.writeByte(cl.cls.message, protocol.CLC.stringcmd);
      msg.writeString(cl.cls.message, 'enablecsqc');
    }
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
    // Every exit from here can change whether csqc owns the hud, refusals included. QSS recalcs at
    // the same point (host.c:939).
    scr.state.recalc_refdef = true;
  }
};

// QSS sv_phys.c:1529 - 0: advance the clock only (the csqc default), 1: run due thinks, 2: full
// movetype physics. Active VM is csqc.
const physicsMode = function (): number {
  const ofs = state.extglobals.physics_mode;
  return (ofs != null) ? (pr.state.globals_float[ofs] >> 0) : 0;
};

// The client VM's per-frame upkeep. Must run where QSS runs it (host.c:973): after the server
// frame, before the client's messages are parsed.
export const physicsFrame = function () {
  if (!state.active)
    return;
  // Same map-change window as ownsView: the worldmodel is gutted in place until shutdown fires on
  // the new serverinfo, and a think that traced it would walk freed hulls.
  const world = pr.vms.csqc.worldmodel;
  if ((world == null) || ((world as any).nodes == null))
    return;
  pr.switchVM(pr.vms.csqc);
  try {
    sv.runPhysicsFrame(cl.clState.time - pr.state.time, physicsMode(), state.extfuncs.EndFrame || 0);
    pr.state.globals_float[pr.globalvars.time] = cl.clState.time;
  } finally {
    pr.clearStack(pr.vms.csqc);
    pr.switchVM(pr.vms.ssqc);
  }
};

// CSQC_Shutdown + drop the progs (QSS CL_ClearState, cl_main.c:113). Safe when no csprogs ever
// loaded, and idempotent: the entry point is zeroed as it runs.
export const shutdown = function () {
  const fn = state.extfuncs.CSQC_Shutdown;
  if (state.active && fn) {
    state.extfuncs.CSQC_Shutdown = 0;
    callFunction(fn);
  }
  clearState();
  pr.resetVM(pr.vms.csqc);
  scr.state.recalc_refdef = true;	// the engine sbar is back, so the view is no longer fullscreen
};

// Host error hardening (QSS host.c:190). The dying VM must not intercept anything on the error
// path - above all not CSQC_Shutdown, a common source of recursive errors - so the whole VM goes
// where QSS zeroes two entry points. The clip reset is its glDisable(GL_SCISSOR_TEST): a clip rect
// the dead QC set would otherwise clip the error message away.
export const hostError = function () {
  clearState();
  pr.resetVM(pr.vms.csqc);
  draw.resetClip();
  scr.state.recalc_refdef = true;
};

// The DarkPlaces csprogs advertisement stufftexts. QSS registers and ignores these
// (cl_main.c:1728), carrying the identity in serverinfo; we have no serverinfo transport, so these
// carry it. They run before load() reads them.
const csqc_progname_f = function () {
  state.advertised.name = (cmd.state.argv.length > 1) ? cmd.state.argv[1] : '';
};

const csqc_progcrc_f = function () {
  state.advertised.crc = q.atoi(cmd.state.argv[1]) >>> 0;
};

const csqc_progsize_f = function () {
  state.advertised.size = q.atoi(cmd.state.argv[1]);
};

// Called from cl.clearState, i.e. on every serverinfo - parsed before that message's buffered
// stufftexts are executed.
export const clearAdvertisement = function () {
  state.advertised.name = '';
  state.advertised.crc = 0;
  state.advertised.size = 0;
};

export const init = function () {
  // A fresh GameInit must not inherit a dead session's active flag/extfuncs. No QC call.
  clearState();
  pfcl.init();
  // The csqc VM's sound sink for the physics pass (QSS World_StartSound's client branch,
  // sv_phys.c:66); wired from here so sv.ts stays clean of the sound system.
  sv.state.csqcStartSound = pfcl.worldStartSound;
  cvr.cl_nocsqc = cvar.registerVariable('cl_nocsqc', '0');
  // Server-sent, so they are the engine's share of the stufftext stream, not the progs'.
  cmd.addCommand('csqc_progname', csqc_progname_f, { fromServer: true });
  cmd.addCommand('csqc_progcrc', csqc_progcrc_f, { fromServer: true });
  cmd.addCommand('csqc_progsize', csqc_progsize_f, { fromServer: true });
  cmd.addCommand('cl_cmd', cl_cmd_f);
};
