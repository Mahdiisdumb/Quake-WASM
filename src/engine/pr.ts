import * as con from './console'
import * as sys from './sys'
import * as host from './host'
import * as sv from './sv'
import * as cmd from './cmd'
import * as com from './com'
import * as ed from './ed'
import * as cvar from './cvar'
import * as q from './q'
import * as crc from './crc'
import { connected } from 'process'
import { CVars } from './cvar'
import { Edict } from './types/Edict'
import type { Model } from './types/Model'
import { FileMode } from './interfaces/store/IAssetStore'
import * as def from './def'

const version = 6
const progheader_crc = 5927;

// Known non-NQ progdefs CRCs, named before the fatal load error (QSS pr_edict.c:1333-1360).
const foreign_crcs: Record<number, string> = {
  22390: 'original csqc defs',
  52195: 'DarkPlaces csqc defs',
  54730: 'quakeworld gamecode',
  26940: 'prerelease gamecode',
  32401: 'tenebrae gamecode',
  38488: 'hexen2 gamecode',
  26905: 'hexen2 gamecode',
  14046: 'hexen2 gamecode',
  62643: 'Extraction gamecode (fte defs)'
};

const localstack_size = 2048;

export const cvr: CVars = {
}

export type OpenFileHandle = {
  position: number,
  file: string | ArrayBuffer
  mode: FileMode
  content?: string[]
}

export type PRFile = {
  name: string,
  position: number,
}

export type Definition = {
  type: number;
  ofs: number;
  name: number;
}
export type Statement = {
  op: number;
  a: number;
  b: number;
  c: number;
}

export type QCToken = {
  token: string
  start: number
  end: number
}

export type Function = {
  first_statement: number;
  parm_start: number;
  locals: number;
  profile: number;
  name: number;
  file: number;
  numparms: number;
  parm_size: [number, number, number, number, number, number, number, number]
}


// Fixed NQ entity field offsets, copied per VM; loadProgs patches the VM's copy with whichever
// optional fields the progs declares.
const entvars_base: Record<string, number> = {
  modelindex: 0, // float
  absmin: 1, // vec3
  absmin1: 2,
  absmin2: 3,
  absmax: 4, // vec3
  absmax1: 5,
  absmax2: 6,
  ltime: 7, // float
  movetype: 8, // float
  solid: 9, // float
  origin: 10, // vec3
  origin1: 11,
  origin2: 12,
  oldorigin: 13, // vec3
  oldorigin1: 14,
  oldorigin2: 15,
  velocity: 16, // vec3
  velocity1: 17,
  velocity2: 18,
  angles: 19, // vec3
  angles1: 20,
  angles2: 21,
  avelocity: 22, // vec3
  avelocity1: 23,
  avelocity2: 24,
  punchangle: 25, // vec3
  punchangle1: 26,
  punchangle2: 27,
  classname: 28, // string
  model: 29, // string
  frame: 30, // float
  skin: 31, // float
  effects: 32, // float
  mins: 33, // vec3
  mins1: 34,
  mins2: 35,
  maxs: 36, // vec3
  maxs1: 37,
  maxs2: 38,
  size: 39, // vec3
  size1: 40,
  size2: 41,
  touch: 42, // func
  use: 43, // func
  think: 44, // func
  blocked: 45, // func
  nextthink: 46, // float
  groundentity: 47, // edict
  health: 48, // float
  frags: 49, // float
  weapon: 50, // float
  weaponmodel: 51, // string
  weaponframe: 52, // float
  currentammo: 53, // float
  ammo_shells: 54, // float
  ammo_nails: 55, // float
  ammo_rockets: 56, // float
  ammo_cells: 57, // float
  items: 58, // float
  takedamage: 59, // float
  chain: 60, // edict
  deadflag: 61, // float
  view_ofs: 62, // vec3
  view_ofs1: 63,
  view_ofs2: 64,
  button0: 65, // float
  button1: 66, // float
  button2: 67, // float
  impulse: 68, // float
  fixangle: 69, // float
  v_angle: 70, // vec3
  v_angle1: 71,
  v_angle2: 72,
  fpitch: 73, // float
  netname: 74, // string
  enemy: 75, // edict
  flags: 76, // float
  colormap: 77, // float
  team: 78, // float
  max_health: 79, // float
  teleport_time: 80, // float
  armortype: 81, // float
  armorvalue: 82, // float
  waterlevel: 83, // float
  watertype: 84, // float
  ideal_yaw: 85, // float
  yaw_speed: 86, // float
  aiment: 87, // edict
  goalentity: 88, // edict
  spawnflags: 89, // float
  target: 90, // string
  targetname: 91, // string
  dmg_take: 92, // float
  dmg_save: 93, // float
  dmg_inflictor: 94, // edict
  owner: 95, // edict
  movedir: 96, // vec3
  movedir1: 97,
  movedir2: 98,
  message: 99, // string
  sounds: 100, // float
  noise: 101, // string
  noise1: 102, // string
  noise2: 103, // string
  noise3: 104 // string
};

// Fixed NQ system-global offsets, per VM like entvars; loadProgs rebinds the VM's copy by name
// for a foreign defs layout.
const globalvars_base: Record<string, number> = {
  self: 28, // edict
  other: 29, // edict
  world: 30, // edict
  time: 31, // float
  frametime: 32, // float
  force_retouch: 33, // float
  mapname: 34, // string
  deathmatch: 35, // float
  coop: 36, // float
  teamplay: 37, // float
  serverflags: 38, // float
  total_secrets: 39, // float
  total_monsters: 40, // float
  found_secrets: 41, // float
  killed_monsters: 42, // float
  parms: 43, // float[16]
  v_forward: 59, // vec3
  v_forward1: 60,
  v_forward2: 61,
  v_up: 62, // vec3
  v_up1: 63,
  v_up2: 64,
  v_right: 65, // vec3,
  v_right1: 66,
  v_right2: 67,
  trace_allsolid: 68, // float
  trace_startsolid: 69, // float
  trace_fraction: 70, // float
  trace_endpos: 71, // vec3
  trace_endpos1: 72,
  trace_endpos2: 73,
  trace_plane_normal: 74, // vec3
  trace_plane_normal1: 75,
  trace_plane_normal2: 76,
  trace_plane_dist: 77, // float
  trace_ent: 78, // edict
  trace_inopen: 79, // float
  trace_inwater: 80, // float
  msg_entity: 81, // edict
  main: 82, // func
  StartFrame: 83, // func
  PlayerPreThink: 84, // func
  PlayerPostThink: 85, // func
  ClientKill: 86, // func
  ClientConnect: 87, // func
  PutClientInServer: 88, // func
  ClientDisconnect: 89, // func
  SetNewParms: 90, // func
  SetChangeParms: 91 // func
};

// vec3 members of the two tables (components at base+1/+2). Listed explicitly: the 1/2 suffix
// alone can't tell a vector from the noise/noise1/noise2 trio of separate string fields.
const globalvars_vectors = new Set(['v_forward', 'v_up', 'v_right', 'trace_endpos', 'trace_plane_normal']);
const entvars_vectors = new Set(['absmin', 'absmax', 'origin', 'oldorigin', 'velocity', 'angles',
  'avelocity', 'punchangle', 'mins', 'maxs', 'size', 'view_ofs', 'v_angle', 'movedir']);

// QC calling convention: args in and results out through the pr globals, never JS args/return.
export type Builtin = () => void

// One extension (EBFS) builtin: defaultFnNbr 0 means remap-only, bound by name (the "= #0" set).
export type ExtBuiltin = { defaultFnNbr: number, name: string | null, fn: Builtin }

// Tag fn as a placeholder rather than a working builtin, for the gap report. The tag rides on the
// function object because stub factories mint a fresh closure per name and their modules sit in an
// import cycle with this one.
export function markStub<T extends Builtin>(fn: T, name?: string): T {
  (fn as unknown as { qcstub: string }).qcstub = name ?? '';
  return fn;
}

// A placeholder, or nothing at all - the OP.call dispatch treats the two the same way.
export function isStub(fn: Builtin | undefined): boolean {
  return (fn == null) || ((fn as unknown as { qcstub?: string }).qcstub !== undefined);
}

// Registered by each table's owner (pf, pfcl) so pr_scanprogs can resolve names without pr
// importing either module.
export const extTables: { vm: string, ext: ExtBuiltin[] }[] = [];

export function registerExtTable(vm: string, ext: ExtBuiltin[]) {
  const i = extTables.findIndex(t => t.vm === vm);
  if (i < 0)
    extTables.push({ vm: vm, ext: ext });
  else
    extTables[i].ext = ext;
}

export type PrState = {
  // Progs
  crc: number;
  // Identity of the loaded file, matched against the csprogs advertisement (QSS qcvm_t
  // progshash/progssize, progs.h:389).
  progshash: number;
  progssize: number;
  alpha_supported: boolean;
  scale_supported: boolean;
  rerelease: boolean;
  functions: Function[];
  statements: Statement[];
  globaldefs: Definition[];
  fielddefs: Definition[];
  strings: number[];
  entityfields: number;

  // Machine
  globals: ArrayBuffer;
  globals_int: Int32Array;
  globals_float: Float32Array;
  depth: number;
  stack: [number, Function][];
  localstack: number[];
  localstack_used: number;
  xstatement: number;
  xfunction?: Function;
  string_temp: number;
  // Temp-string ring, allocated on first use (QSS PR_GetTempString): one buffer per string
  // argument of a call, since string_temp's single buffer would have them overwrite each other.
  string_temps: number[];
  // Per-slot capacity: a slot regrows when a string outsizes it (FTE's AllocTempString is
  // dynamically sized).
  string_temp_caps: number[];
  string_temp_slot: number;
  netnames: number;
  openfiles: Record<number, OpenFileHandle>;
  qctoken: QCToken[];
  // DP_QC_STRINGBUFFERS storage (FTE strbuflist[], pr_bgcmd.c:5126). Null slots are free and get
  // reused; QC handles are index+1 (FTE BUFSTRBASE), so handle 0 is never valid.
  strbufs: (string | null)[][];
  // DP_QC_FS_SEARCH handles (FTE pr_searches, pr_bgcmd.c:3603). Null after search_end; reused.
  searches: (string[] | null)[];
  // FTE_MEMALLOC arena (PF_memalloc, pr_bgcmd.c:2037). A QC "pointer" is a byte offset here
  // biased by MEMPTR_BASE, so 0 stays null. NOT the addressable space FTE aliases it onto.
  memarena: { mem: Uint8Array, used: number, blocks: Record<number, number> };
  numbuiltins: number;
  trace: boolean;
  argc: null | number;
  edict_size: number;
  entvars: Record<string, number>;
  globalvars: Record<string, number>;
  // Non-NQ defs layout: entvars/globalvars came from the progs' own defs (resolveForeignDefs).
  // Backends with the NQ offsets baked in - the wasm sim - must refuse it; see host.serverFrame.
  foreigndefs: boolean;

  // The VM's own builtin table (QSS memcpy into qcvm->builtins, pr_edict.c:1420).
  builtins: Builtin[];
  // Builtin number -> ext entry. Per-VM: the ext table is shared, but two VMs may number an
  // entry differently.
  extbuiltins: Record<number, ExtBuiltin>;

  // Array object is shared with its owner (sv.state.server.edicts for ssqc) - one array, two names.
  edicts: Edict[];
  num_edicts: number;
  reserved_edicts: number; // world + client slots, never handed out by ed.alloc
  max_edicts: number;

  // QSS qcvm_t worldmodel/areanodes. The model is shared with its owner (sv.state.server for
  // ssqc); the areanode tree is the VM's own, built by sv.clearWorld.
  worldmodel: Model;
  areanodes: sv.AreaNode[];
  // modelindex -> model for THIS VM's edicts (QSS qcvm_t GetModel, progs.h:437), needed by
  // collision for SOLID_BSP edicts.
  getModel: (index: number) => Model;

  // The VM's own clock (QSS qcvm_t time/frametime); shadows sv.state.server.time for ssqc.
  // Everything running under a VM (thinks, freetime, touch) reads this, not the server's.
  time: number;
  frametime: number;

  // name -> def/index maps for ed.findField/findGlobal/findFunction, rebuilt when the source
  // array changes; per-VM so a switch can't return another VM's defs.
  getEvCache: Record<string, Definition>;
  fieldCache: { src: Definition[] | null, map: Map<string, Definition> };
  globalCache: { src: Definition[] | null, map: Map<string, Definition> };
  functionCache: { src: Function[] | null, map: Map<string, number> };
}

const initState = (): PrState => {
  return {
    strings: [],
    globals: new ArrayBuffer(0),
    globals_int: new Int32Array(),
    globals_float: new Float32Array(),
    depth: 0,
    functions: [],
    statements: [],
    globaldefs: [],
    fielddefs: [],
    localstack: [],
    localstack_used: 0,
    xstatement: 0,
    entityfields: 0,
    argc: 0,
    edict_size: 0,
    trace: false,
    alpha_supported: false,
    scale_supported: false,
    rerelease: false,
    openfiles: [],
    numbuiltins: 0,
    qctoken: [],
    strbufs: [],
    searches: [],
    memarena: { mem: new Uint8Array(0), used: 0, blocks: {} },

    crc: 0,
    progshash: 0,
    progssize: 0,
    stack: [],
    string_temp: 0,
    string_temps: [],
    string_temp_caps: [],
    string_temp_slot: 0,
    netnames: 0,
    entvars: { ...entvars_base },
    globalvars: { ...globalvars_base },
    foreigndefs: false,
    builtins: [],
    extbuiltins: {},

    edicts: [],
    num_edicts: 0,
    reserved_edicts: 0,
    max_edicts: def.max_edicts,

    worldmodel: null,
    areanodes: [],
    getModel: null,

    time: 0,
    frametime: 0,

    getEvCache: {},
    fieldCache: { src: null, map: new Map() },
    globalCache: { src: null, map: new Map() },
    functionCache: { src: null, map: new Map() }
  }
}

// Identities are stable for the process, so consumers may pin a reference.
export const vms = { ssqc: initState(), csqc: initState() }

// Drop a VM back to its unloaded state (QSS PR_ClearProgs, pr_edict.c:1188).
export const resetVM = function (vm: PrState) {
  Object.assign(vm, initState());
  if (vm === state) {
    // keep the active-VM bindings pointing at the live maps
    entvars = vm.entvars;
    globalvars = vm.globalvars;
  }
};

// Drop a half-unwound QC stack (QSS unwinds the same state through its longjmp). A host error
// thrown out of executeProgram leaves depth > 0, tripping switchVM's guard forever after.
export const clearStack = function (vm: PrState) {
  vm.depth = 0;
  vm.localstack_used = 0;
  tempRelease(0, vm);	// the marks that would have released these went with the stack
};

// The active VM. Delta from QSS's qcvm pointer: never null, it falls back to the server VM.
export let state: PrState = vms.ssqc

// Field/global offsets of the active VM, bindings of their own because every edict access reads them.
export let entvars: Record<string, number> = state.entvars

export let globalvars: Record<string, number> = state.globalvars

// QSS PR_SwitchQCVM (pr_edict.c:1173).
export const switchVM = function (vm: PrState) {
  if ((vm !== state) && (state.depth > 0))
    sys.error('PR.SwitchQCVM: switching VM with a program on the stack');
  state = vm;
  entvars = vm.entvars;
  globalvars = vm.globalvars;
};

// First synthesized number for the rerelease "= #0" builtins loadProgs binds by name.
// Above every real builtin number; mirrored by wasm-sim/assembly/host.ts.
export const EXT_BUILTIN_BASE = 900;

export const ETYPE = {
  ev_void: 0,
  ev_string: 1,
  ev_float: 2,
  ev_vector: 3,
  ev_entity: 4,
  ev_field: 5,
  ev_function: 6,
  ev_pointer: 7,
  // FTE's wider types (QSS pr_comp.h:57-61); reachable only through sendevent's per-argument
  // etype tags, never held by a vanilla-NQ progs.
  ev_ext_integer: 8,
  ev_ext_uint32: 9,
  ev_ext_sint64: 10,
  ev_ext_uint64: 11,
  ev_ext_double: 12
};

const OP = {
  done: 0,
  mul_f: 1, mul_v: 2, mul_fv: 3, mul_vf: 4,
  div_f: 5,
  add_f: 6, add_v: 7,
  sub_f: 8, sub_v: 9,
  eq_f: 10, eq_v: 11, eq_s: 12, eq_e: 13, eq_fnc: 14,
  ne_f: 15, ne_v: 16, ne_s: 17, ne_e: 18, ne_fnc: 19,
  le: 20, ge: 21, lt: 22, gt: 23,
  load_f: 24, load_v: 25, load_s: 26, load_ent: 27, load_fld: 28, load_fnc: 29,
  address: 30,
  store_f: 31, store_v: 32, store_s: 33, store_ent: 34, store_fld: 35, store_fnc: 36,
  storep_f: 37, storep_v: 38, storep_s: 39, storep_ent: 40, storep_fld: 41, storep_fnc: 42,
  ret: 43,
  not_f: 44, not_v: 45, not_s: 46, not_ent: 47, not_fnc: 48,
  jnz: 49, jz: 50,
  call0: 51, call1: 52, call2: 53, call3: 54, call4: 55, call5: 56, call6: 57, call7: 58, call8: 59,
  state: 60,
  jump: 61,
  and: 62, or: 63,
  bitand: 64, bitor: 65
};

// cmds

export const checkEmptyString = function (s: string) {
  var c = s.charCodeAt(0);
  if ((q.isNaN(c) === true) || (c <= 32))
    runError('Bad string');
};

// edict

export const valueString = function (type: number, val: ArrayBuffer, ofs: number) {
  var val_float = new Float32Array(val);
  var val_int = new Int32Array(val);
  type &= 0x7fff;
  switch (type) {
    case ETYPE.ev_string:
      return getString(val_int[ofs]);
    case ETYPE.ev_entity:
      return 'entity ' + val_int[ofs];
    case ETYPE.ev_function:
      return getString(state.functions[val_int[ofs]].name) + '()';
    case ETYPE.ev_field:
      var def = ed.fieldAtOfs(val_int[ofs]);
      if (def != null)
        return '.' + getString(def.name);
      return '.';
    case ETYPE.ev_void:
      return 'void';
    case ETYPE.ev_float:
      return val_float[ofs].toFixed(1);
    case ETYPE.ev_vector:
      return '\'' + val_float[ofs].toFixed(1) +
        ' ' + val_float[ofs + 1].toFixed(1) +
        ' ' + val_float[ofs + 2].toFixed(1) + '\'';
    case ETYPE.ev_pointer:
      return 'pointer';
  }
  return 'bad type ' + type;
};

export const uglyValueString = function (type: number, val: ArrayBuffer, ofs: number) {
  var val_float = new Float32Array(val);
  var val_int = new Int32Array(val);
  type &= 0x7fff;
  switch (type) {
    case ETYPE.ev_string:
      return getString(val_int[ofs]);
    case ETYPE.ev_entity:
      return val_int[ofs].toString();
    case ETYPE.ev_function:
      return getString(state.functions[val_int[ofs]].name);
    case ETYPE.ev_field:
      var def = ed.fieldAtOfs(val_int[ofs]);
      if (def != null)
        return getString(def.name);
      return '';
    case ETYPE.ev_void:
      return 'void';
    case ETYPE.ev_float:
      return val_float[ofs].toFixed(6);
    case ETYPE.ev_vector:
      return val_float[ofs].toFixed(6) +
        ' ' + val_float[ofs + 1].toFixed(6) +
        ' ' + val_float[ofs + 2].toFixed(6);
  }
  return 'bad type ' + type;
};

export const globalString = function (ofs: number) {
  var def = ed.globalAtOfs(ofs), line;
  if (def != null)
    line = ofs + '(' + getString(def.name) + ')' + valueString(def.type, state.globals, ofs);
  else
    line = ofs + '(???)';
  for (; line.length <= 20;)
    line += ' ';
  return line;
};

export const globalStringNoContents = function (ofs: number) {
  var def = ed.globalAtOfs(ofs), line;
  if (def != null)
    line = ofs + '(' + getString(def.name) + ')';
  else
    line = ofs + '(???)';
  for (; line.length <= 20;)
    line += ' ';
  return line;
};

// Resolve one system table against the loaded progs' own defs, filling `out` and returning the
// names it never declared. `parms` resolves to parm1 (FTE-compiled progs name the slots
// individually rather than declaring the array). Active VM.
const resolveTable = function (base: Record<string, number>, vectors: Set<string>,
  find: (name: string) => Definition | undefined, out: Record<string, number>): string[] {
  const missing: string[] = [];
  for (const name of Object.keys(base)) {
    const stem = name.substring(0, name.length - 1);
    if (vectors.has(stem) && ((name.endsWith('1')) || (name.endsWith('2'))))
      continue;   // written with its vector below
    const d = find(name) ?? ((name === 'parms') ? find('parm1') : undefined);
    // A vec3 redeclared as something narrower can't lend its +1/+2 - those slots belong to another
    // symbol - so it counts as undeclared and goes to scratch whole.
    if ((d === undefined) || (vectors.has(name) && ((d.type & 0x7fff) !== ETYPE.ev_vector))) {
      missing.push(name);
      continue;
    }
    out[name] = d.ofs;
    if (vectors.has(name)) {
      out[name + '1'] = d.ofs + 1;
      out[name + '2'] = d.ofs + 2;
    }
  }
  return missing;
};

// Slots a system-table name occupies: vec3 three, spawn parms sixteen.
const tableSlots = function (name: string, vectors: Set<string>): number {
  return vectors.has(name) ? 3 : ((name === 'parms') ? 16 : 1);
};

// Bind globalvars/entvars by name from the progs' own defs, assuming nothing about the NQ offsets
// (FTE's own system-symbol resolution). Undeclared names point at scratch - globals past
// numglobals, fields past entityfields - so the engine's unguarded writes land somewhere harmless
// and read back 0. Active VM, after defs/strings/globals are parsed and BEFORE edict_size is
// derived: the field scratch grows entityfields.
const resolveForeignDefs = function () {
  const missingGlobals = resolveTable(globalvars_base, globalvars_vectors, ed.findGlobal, state.globalvars);
  const missingFields = resolveTable(entvars_base, entvars_vectors, ed.findField, state.entvars);

  // The parm block has to be contiguous for `globalvars.parms + i` to walk it.
  const parm16 = ed.findGlobal('parm16');
  if ((state.globalvars.parms != null) && (parm16 !== undefined) && (parm16.ofs !== state.globalvars.parms + 15))
    con.print('PR.LoadProgs: parm1..parm16 are not contiguous - spawn parms will be wrong\n');

  var scratch = state.globals_float.length;
  var extra = 0;
  for (const name of missingGlobals)
    extra += tableSlots(name, globalvars_vectors);
  if (extra !== 0) {
    const grown = new ArrayBuffer((scratch + extra) << 2);
    new Int32Array(grown).set(state.globals_int);
    state.globals = grown;
    state.globals_int = new Int32Array(grown);
    state.globals_float = new Float32Array(grown);
    for (const name of missingGlobals) {
      state.globalvars[name] = scratch;
      if (globalvars_vectors.has(name)) {
        state.globalvars[name + '1'] = scratch + 1;
        state.globalvars[name + '2'] = scratch + 2;
      }
      scratch += tableSlots(name, globalvars_vectors);
    }
  }

  scratch = state.entityfields;
  for (const name of missingFields) {
    state.entvars[name] = scratch;
    if (entvars_vectors.has(name)) {
      state.entvars[name + '1'] = scratch + 1;
      state.entvars[name + '2'] = scratch + 2;
    }
    scratch += tableSlots(name, entvars_vectors);
  }
  state.entityfields = scratch;

  if ((missingGlobals.length !== 0) || (missingFields.length !== 0))
    con.dPrint('PR.LoadProgs: undeclared, mapped to scratch:'
      + missingGlobals.map(n => ' $' + n).join('') + missingFields.map(n => ' .' + n).join('') + '\n');
};

// The compiled-in value of an autocvar_ global, as the cvar's default string (QSS
// PR_EnableExtensions, pr_ext.c:8740). Active VM.
const autoCvarDefault = function (gd: Definition): string {
  switch (gd.type & 0x7fff) {
    case ETYPE.ev_float:
      return String(state.globals_float[gd.ofs]);
    case ETYPE.ev_vector:
      return state.globals_float[gd.ofs] + ' ' + state.globals_float[gd.ofs + 1]
        + ' ' + state.globals_float[gd.ofs + 2];
    case ETYPE.ev_string:
      return getString(state.globals_int[gd.ofs]);
  }
  return String(state.globals_float[gd.ofs]);
};

// Cvar names already wired to their autocvar_ globals; the handler re-resolves the def per call,
// so a progs reload needs no re-registration.
const autoCvarHooked = new Set<string>();

// Feed a cvar change back into every VM's autocvar_ global (QSS PR_AutoCvarChanged,
// pr_ext.c:8561). Delta from QSS: numeric types only, written without a VM switch - this fires
// from the cvar_set builtin, i.e. with QC on the stack, which switchVM refuses. A string autocvar
// keeps the value it loaded with.
const hookAutoCvar = function (name: string) {
  if (autoCvarHooked.has(name))
    return;
  autoCvarHooked.add(name);
  cvar.registerChangedEvent(name, (value: string) => {
    for (const vm of [vms.ssqc, vms.csqc]) {
      const gd = vm.globaldefs.find(g => getString(g.name, vm) === 'autocvar_' + name);
      if (gd == null)
        continue;
      const type = gd.type & 0x7fff;
      if (type === ETYPE.ev_float)
        vm.globals_float[gd.ofs] = q.atof(value);
      else if (type === ETYPE.ev_vector) {
        const parts = value.split(' ');
        vm.globals_float[gd.ofs] = q.atof(parts[0]);
        vm.globals_float[gd.ofs + 1] = q.atof(parts[1]);
        vm.globals_float[gd.ofs + 2] = q.atof(parts[2]);
      }
    }
  });
};

// Loads filename into the ACTIVE VM (QSS PR_LoadProgs). opts.builtins is the base table copied
// into the VM, opts.ext the shared extension table resolved into it; maxclients allocates the
// netname block, for VMs that host clients. opts.optional downgrades a missing/foreign/wrong-
// version file from fatal to a printed diagnostic and a false return.
export const loadProgs = async function (filename: string,
  opts: { builtins: Builtin[], ext: ExtBuiltin[], maxclients?: number, optional?: boolean }): Promise<boolean> {
  const ext = opts.ext;
  // Leaves the VM as it was.
  const fail = function (message: string): false {
    if (!opts.optional)
      sys.error(message); // throws
    con.print(message + '\n');
    return false;
  };
  // Number resolved for each ext entry by THIS load, parallel to opts.ext - the ext table is
  // shared between VMs, so the numbering can't live on its records.
  const extnbr = new Array<number>(ext.length).fill(0);

  var progs = await com.loadFile(filename);
  if (progs == null) {
    if (opts.optional)
      return false; // silent, as QSS is
    sys.error('PR.LoadProgs: couldn\'t load ' + filename);
  }
  con.dPrint('Programs occupy ' + (progs.byteLength >> 10) + 'K.\n');
  var view = new DataView(progs);

  var i = view.getUint32(0, true);
  if (i !== version)
    return fail(filename + ' has wrong version number (' + i + ' should be ' + version + ')');
  const hcrc = view.getUint32(4, true);
  const foreigndefs = (hcrc !== progheader_crc);
  // Any v6 progs resolves its system tables from its own defs whatever its sysdef CRC: every FTE
  // mod hashes a different defs text, so an accept-list would mean an engine edit per mod.
  // pr_foreigndefs 0 is the vanilla-only switch, refusing anything but 5927.
  if (foreigndefs && !cvr.pr_foreigndefs.value) {
    // Delta from QSS: it names the foreign layout only on its non-fatal path (pr_edict.c:1331),
    // so its crash dialog is as cryptic as vanilla's; we identify it in the fatal message too.
    const known = foreign_crcs[hcrc];
    return fail(filename + ' is compiled against ' +
      (known !== undefined ? known : 'a non-vanilla defs layout') +
      ' (sysdef crc ' + hcrc + ', this engine needs ' + progheader_crc +
      ') - it requires the engine it was built for');
  }
  state.foreigndefs = foreigndefs;
  // Fresh tables per load: the previous progs may have been a foreign layout, or have patched in
  // optional fields this one doesn't declare.
  entvars = state.entvars = { ...entvars_base };
  globalvars = state.globalvars = { ...globalvars_base };

  state.crc = crc.block(new Uint8Array(progs));
  // QSS PR_LoadProgs, pr_edict.c:1312.
  state.progshash = crc.blockChecksum(new Uint8Array(progs));
  state.progssize = progs.byteLength;
  state.alpha_supported = false
  state.scale_supported = false
  state.stack = [];
  state.depth = 0;

  state.localstack = [];
  for (i = 0; i < localstack_size; ++i)
    state.localstack[i] = 0;
  state.localstack_used = 0;

  var ofs, num;

  ofs = view.getUint32(8, true);
  num = view.getUint32(12, true);
  state.statements = [];
  for (i = 0; i < num; ++i) {
    state.statements[i] = {
      op: view.getUint16(ofs, true),
      a: view.getUint16(ofs + 2, true),
      b: view.getUint16(ofs + 4, true),
      c: view.getUint16(ofs + 6, true)
    };
    ofs += 8;
  }

  ofs = view.getUint32(16, true);
  num = view.getUint32(20, true);
  state.globaldefs = [];
  for (i = 0; i < num; ++i) {
    state.globaldefs[i] = {
      type: view.getUint16(ofs, true),
      ofs: view.getUint16(ofs + 2, true),
      name: view.getUint32(ofs + 4, true)
    };
    ofs += 8;
  }

  ofs = view.getUint32(24, true);
  num = view.getUint32(28, true);
  state.fielddefs = [];
  for (i = 0; i < num; ++i) {
    state.fielddefs[i] = {
      type: view.getUint16(ofs, true),
      ofs: view.getUint16(ofs + 2, true),
      name: view.getUint32(ofs + 4, true)
    };
    //johnfitz
    ofs += 8;
  }

  // With pr_builtin_remap the progs' own numbers win, resolved by name in the function loop below,
  // so extnbr must stay cleared here.
  if (!cvr.pr_builtin_remap.value) {
    for (i = 1; i < ext.length; i++) {
      extnbr[i] = ext[i].defaultFnNbr;
      // determine highest builtin number (when NOT remapped)
      if (extnbr[i] > state.numbuiltins) {
        state.numbuiltins = extnbr[i];
      }
    }
  }

  ofs = view.getUint32(32, true);
  num = view.getUint32(36, true);
  state.functions = [];
  for (i = 0; i < num; ++i) {
    state.functions[i] = {
      first_statement: view.getInt32(ofs, true),
      parm_start: view.getUint32(ofs + 4, true),
      locals: view.getUint32(ofs + 8, true),
      profile: view.getUint32(ofs + 12, true),
      name: view.getUint32(ofs + 16, true),
      file: view.getUint32(ofs + 20, true),
      numparms: view.getUint32(ofs + 24, true),
      parm_size: [
        view.getUint8(ofs + 28), view.getUint8(ofs + 29),
        view.getUint8(ofs + 30), view.getUint8(ofs + 31),
        view.getUint8(ofs + 32), view.getUint8(ofs + 33),
        view.getUint8(ofs + 34), view.getUint8(ofs + 35)
      ]
    };

    if (cvr.pr_builtin_remap.value) { // 2001-09-14 Enhanced BuiltIn Function System (EBFS) by Maddes/Firestorm  end	
      if (state.functions[i].first_statement < 0)	// builtin function
      {
        var funcno = -state.functions[i].first_statement
        var funcname = getString(state.functions[i].name)
        var j = 1
        // search function name
        for (j = 1; j < ext.length; j++) {
          if (funcname.toLowerCase() === ext[j].name.toLowerCase())
            break;
        }

        if (j < ext.length)	// found
        {
          extnbr[j] = funcno;
        }
        else {
          con.dPrint(`Can not assign builtin number #${funcno} to ${funcname} - function unknown\n`);
        }
      }
    }

    ofs += 36;
  }

  if (cvr.pr_builtin_remap.value) {
    // check for unassigned functions and try to assign their default function number
    for (i = 1; i < ext.length; i++) {
      if ((!extnbr[i]) && (ext[i].defaultFnNbr))	// unassigned and has a default number
      {
        var j = 1
        // check if default number is already assigned to another function
        for (j = 1; j < ext.length; j++) {
          if (extnbr[j] == ext[i].defaultFnNbr) {
            break;	// number already assigned to another builtin function
          }
        }

        if (j < ext.length)	// already assigned
        {
          con.dPrint(`"Can not assign default builtin number 
            #${ext[i].defaultFnNbr} to ${extnbr[i]} 
            - number is already assigned to ${ext[j].name}\n`);
        }
        else {
          extnbr[i] = ext[i].defaultFnNbr;
        }
      }
      // determine highest builtin number (when remapped)

      if (extnbr[i] > state.numbuiltins) {
        state.numbuiltins = extnbr[i];
      }
    }
  }

  state.numbuiltins++;

  // the VM owns its table (QSS memcpys the passed builtins into qcvm->builtins).
  state.builtins = opts.builtins.slice();

  // clear them out.
  for (i = 0; i < state.numbuiltins; i++) {
    state.builtins[i] = ext[0].fn;
  }

  // create builtin list for execution time and set cvars accordingly
 //  Cvar_Set("pr_builtin_find", "0");

  for (i = 1; i < ext.length; i++) {
    if (extnbr[i])	// only put assigned functions into builtin list
    {
      state.builtins[extnbr[i]] = ext[i].fn;
    }

    // if (ext[j].defaultFnNbr == 100) {
    //   Cvar_SetValue("pr_builtin_find", extnbr[j]);
    // }
  }

  ofs = view.getUint32(40, true);
  num = view.getUint32(44, true);
  state.strings = [];
  for (i = 0; i < num; ++i)
    state.strings[i] = view.getUint8(ofs + i);
  state.string_temp = newString('', 128);
  state.string_temps = [];
  state.string_temp_caps = [];
  state.string_temp_slot = 0;
  // netname block only for VMs that host clients.
  state.netnames = (opts.maxclients != null) ? newString('', opts.maxclients << 5) : 0;

  state.openfiles = {}
  state.qctoken = []
  // A progs load owns its buffers and arena outright, as openfiles does (FTE PR_Common_Shutdown,
  // pr_bgcmd.c:5230).
  state.strbufs = []
  state.searches = []
  state.memarena = { mem: new Uint8Array(0), used: 0, blocks: {} }

  ofs = view.getUint32(48, true);
  num = view.getUint32(52, true);
  state.globals = new ArrayBuffer(num << 2);
  state.globals_float = new Float32Array(state.globals);
  state.globals_int = new Int32Array(state.globals);
  for (i = 0; i < num; ++i)
    state.globals_int[i] = view.getInt32(ofs + (i << 2), true);

  for (i = 0; i < state.fielddefs.length; i++) {
    //johnfitz -- detect alpha support in progs.dat
    const fname = getString(state.fielddefs[i].name);
    if (fname === "alpha")
      state.alpha_supported = true;
    else if (fname === "scale")
      state.scale_supported = true;
  }

  // 2021 rerelease (Kex) QC detection - mirrors QSS-M PR_EnableExtensions (pr_ext.c ~9590-9592):
  // an ex_centerprint builtin with no classic centerprint means remaster-specific progs; an
  // unprefixed finaleFinished catches earlier remaster builds. Function-name presence only -
  // no CRC check.
  state.rerelease = (ed.findFunction('ex_centerprint') !== undefined && ed.findFunction('centerprint') === undefined)
    || ed.findFunction('finaleFinished') !== undefined;

  if (cvr.pr_checkextension.value) {
    // A "= #0" declaration leaves first_statement at 0 for the engine to resolve by name (QSS
    // pr_ext.c ~9668). Ungated, as QSS's remap loop is: fteqcc emits these per-declaration, not
    // only in the rerelease set. Vanilla progs are unaffected - their one first_statement==0
    // function is the null function, whose s_name is 0. Growing state.builtins is enough to bind:
    // the OP.call dispatch guards on builtins.length, not numbuiltins.
    let nextExtNbr = EXT_BUILTIN_BASE;
    for (i = 0; i < state.functions.length; i++) {
      const fn = state.functions[i];
      if (fn.first_statement === 0 && fn.name && fn.parm_start === 0 && fn.locals === 0) {
        const fname = getString(fn.name);
        const j = ext.findIndex(b => b.name && b.name.toLowerCase() === fname.toLowerCase());
        if (j < 0) {
          con.dPrint(`QC builtin ${fname} is not known\n`);
          continue;
        }
        if (!extnbr[j]) {
          for (let k = state.builtins.length; k <= nextExtNbr; k++)
            state.builtins[k] = ext[0].fn; // ext[0] is the "unimplemented" stub
          extnbr[j] = nextExtNbr++;
        }
        fn.first_statement = -extnbr[j];
        state.builtins[extnbr[j]] = ext[j].fn;
      }
    }
  }

  // autocvar_<name>: create the cvar from the global's compiled-in default, then push the cvar's
  // live value back into the global (QSS PR_EnableExtensions, pr_ext.c:8735).
  for (i = 0; i < state.globaldefs.length; i++) {
    const gd = state.globaldefs[i];
    const gname = getString(gd.name);
    if (!gname.startsWith('autocvar_'))
      continue;
    const v = cvar.create(gname.substring(9), autoCvarDefault(gd));
    if (v == null)
      continue;	// the name is a command
    if (ed.parseEpair(state.globals, gd, v.string) !== true)
      con.print(`EXT: Unable to configure ${gname}\n`);
    hookAutoCvar(v.name);
  }

  // Number -> ext entry, for post-load lookups by builtin number. First entry wins.
  state.extbuiltins = {};
  for (i = 1; i < ext.length; i++) {
    if (extnbr[i] && state.extbuiltins[extnbr[i]] === undefined)
      state.extbuiltins[extnbr[i]] = ext[i];
  }

  state.entityfields = view.getUint32(56, true);
  // Must run BEFORE edict_size is derived: the scratch fields it adds have to be real per-edict slots.
  if (foreigndefs)
    resolveForeignDefs();
  state.edict_size = 96 + (state.entityfields << 2);

  var fields = [
    'ammo_shells1',
    'ammo_nails1',
    'ammo_lava_nails',
    'ammo_rockets1',
    'ammo_multi_rockets',
    'ammo_cells1',
    'ammo_plasma',
    'gravity',
    'items2',
    // QSS extfields, sv_phys.c:1592
    'customphysics'
  ], field, def;
  for (i = 0; i < fields.length; ++i) {
    field = fields[i];
    def = ed.findField(field);
    state.entvars[field] = (def != null) ? def.ofs : null;
  }
  reportBuiltinGaps(filename);
  return true;
};

// What a builtin-gap scan reads; satisfied structurally by both a loaded VM and a standalone parse.
type ProgsTables = {
  functions: Function[];
  statements: Statement[];
  globals_int: Int32Array;
  strings: number[];
}

// One imported builtin. nbr 0 means a "= #0" import the name remap never resolved - its call
// sites jump to statement 0.
export type BuiltinImport = { name: string, nbr: number }

// Imports named by a literal OP_CALL* operand. A floor, not a ceiling: a builtin reached only
// through a .func field or function-pointer global has no literal operand and is invisible here.
const calledImports = function (p: ProgsTables): BuiltinImport[] {
  const called = new Set<number>();
  for (let i = 0; i < p.statements.length; i++) {
    const st = p.statements[i];
    if ((st.op < OP.call0) || (st.op > OP.call8))
      continue;
    const fnum = p.globals_int[st.a];
    if ((fnum > 0) && (fnum < p.functions.length))
      called.add(fnum);
  }
  const out: BuiltinImport[] = [], seen = new Set<string>();
  for (const fnum of called) {
    const f = p.functions[fnum];
    if (f.first_statement > 0)
      continue;   // real QC code, not an import
    const name = stringAt(p.strings, f.name);
    if (seen.has(name))
      continue;
    seen.add(name);
    out.push({ name: name, nbr: -f.first_statement });
  }
  out.sort((a, b) => (a.name < b.name) ? -1 : ((a.name > b.name) ? 1 : 0));
  return out;
};

// One line naming every builtin the loaded progs calls that nothing working backs. Foreign-defs
// progs always get it, vanilla-CRC ones only under `developer`. Active VM, after the builtin
// table is bound.
const reportBuiltinGaps = function (filename: string) {
  const missing = calledImports(state)
    .filter(im => (im.nbr === 0) || isStub(state.builtins[im.nbr]));
  if (missing.length === 0)
    return;
  if (!state.foreigndefs && (host.cvr.developer.value === 0))
    return;
  con.print('PR.LoadProgs: ' + filename + ' calls ' + missing.length + ' unimplemented builtin'
    + ((missing.length === 1) ? '' : 's') + ':'
    + missing.map(im => ' ' + im.name + '#' + im.nbr).join('') + '\n');
};

// Parse a v6 progs standalone; no VM is touched. Offsets are the dprograms_t ones loadProgs reads.
const parseTables = function (view: DataView): ProgsTables {
  const p: ProgsTables = {
    functions: [], statements: [], globals_int: new Int32Array(0), strings: []
  };
  var ofs = view.getUint32(8, true), num = view.getUint32(12, true), i;
  for (i = 0; i < num; ++i, ofs += 8) {
    p.statements[i] = {
      op: view.getUint16(ofs, true),
      a: view.getUint16(ofs + 2, true),
      b: view.getUint16(ofs + 4, true),
      c: view.getUint16(ofs + 6, true)
    };
  }
  ofs = view.getUint32(32, true);
  num = view.getUint32(36, true);
  for (i = 0; i < num; ++i, ofs += 36) {
    p.functions[i] = {
      first_statement: view.getInt32(ofs, true),
      parm_start: view.getUint32(ofs + 4, true),
      locals: view.getUint32(ofs + 8, true),
      profile: view.getUint32(ofs + 12, true),
      name: view.getUint32(ofs + 16, true),
      file: view.getUint32(ofs + 20, true),
      numparms: view.getUint32(ofs + 24, true),
      parm_size: [
        view.getUint8(ofs + 28), view.getUint8(ofs + 29),
        view.getUint8(ofs + 30), view.getUint8(ofs + 31),
        view.getUint8(ofs + 32), view.getUint8(ofs + 33),
        view.getUint8(ofs + 34), view.getUint8(ofs + 35)
      ]
    };
  }
  ofs = view.getUint32(40, true);
  num = view.getUint32(44, true);
  for (i = 0; i < num; ++i)
    p.strings[i] = view.getUint8(ofs + i);
  ofs = view.getUint32(48, true);
  num = view.getUint32(52, true);
  p.globals_int = new Int32Array(num);
  for (i = 0; i < num; ++i)
    p.globals_int[i] = view.getInt32(ofs + (i << 2), true);
  return p;
};

// The registered entry that would back this import. The name must agree either way: a number
// landing on an entry of another name means the mod was built against a different builtin map.
const extEntry = function (ext: ExtBuiltin[], im: BuiltinImport): ExtBuiltin | undefined {
  const named = ext.find(b => (b.name != null) && (b.name.toLowerCase() === im.name.toLowerCase()));
  if (im.nbr === 0)
    return named;
  return ((named !== undefined) && (named.defaultFnNbr === im.nbr)) ? named : undefined;
};

// pr_scanprogs <file>: list the builtins a progs calls that this engine has nothing working
// behind, without loading it into a VM.
const scanProgs_f = async function () {
  if (cmd.state.argv.length !== 2) {
    con.print('pr_scanprogs <file> : list the builtins a progs file needs\n');
    return;
  }
  const filename = cmd.state.argv[1];
  const file = await com.loadFile(filename);
  if (file == null) {
    con.print('pr_scanprogs: couldn\'t load ' + filename + '\n');
    return;
  }
  const view = new DataView(file);
  const ver = view.getUint32(0, true);
  if (ver !== version) {
    con.print('pr_scanprogs: ' + filename + ' is progs version ' + ver + ', this engine runs '
      + version + ' only'
      + ((ver === 7) ? ' - fteqcc targeted FTE\'s extended format; recompile for v6' : '')
      + '\n');
    return;
  }
  const hcrc = view.getUint32(4, true);
  const p = parseTables(view);
  const imports = p.functions.filter(f => (f.first_statement <= 0) && (f.name !== 0)).length;
  const called = calledImports(p);
  const missing: string[] = [];
  const coverage = extTables.map(t => ({ vm: t.vm, n: 0 }));
  for (const im of called) {
    var backed = false;
    for (let i = 0; i < extTables.length; i++) {
      if (isStub(extEntry(extTables[i].ext, im)?.fn))
        continue;
      coverage[i].n++;
      backed = true;
    }
    if (backed)
      continue;
    // Known by name at another number: a differing builtin map, not an absent builtin.
    var elsewhere = '';
    for (const t of extTables) {
      const named = t.ext.find(b => (b.name != null) && (b.name.toLowerCase() === im.name.toLowerCase()));
      if ((named !== undefined) && !isStub(named.fn) && (named.defaultFnNbr !== im.nbr))
        elsewhere = ' (' + t.vm + ' has it at #' + named.defaultFnNbr + ')';
    }
    missing.push(im.name + '#' + im.nbr + elsewhere);
  }

  const known = foreign_crcs[hcrc];
  con.print('pr_scanprogs: ' + filename + ': progs version ' + ver + ', sysdef crc ' + hcrc
    + ' (' + ((hcrc === progheader_crc) ? 'vanilla' : (known !== undefined ? known : 'unknown, foreign defs')) + '), '
    + p.functions.length + ' functions, ' + imports + ' imports, ' + called.length + ' called\n');
  con.print('pr_scanprogs: covered of the ' + called.length + ' called: '
    + coverage.map(c => c.vm + ' ' + c.n).join(', ') + '\n');
  if (missing.length === 0)
    con.print('pr_scanprogs: ' + filename + ' calls no unimplemented builtins\n');
  else
    con.print('pr_scanprogs: ' + filename + ' calls ' + missing.length + ' unimplemented builtin'
      + ((missing.length === 1) ? '' : 's') + ': ' + missing.join(' ') + '\n');
};

export const init = function () {
  resetVM(vms.ssqc)
  resetVM(vms.csqc)
  switchVM(vms.ssqc)
  cmd.addCommand('edict', ed.printEdict_f);
  cmd.addCommand('edicts', ed.printEdicts);
  cmd.addCommand('edictcount', ed.count);
  cmd.addCommand('profile', profile_f);
  cmd.addCommand('pr_scanprogs', scanProgs_f);
  cvar.registerVariable('nomonsters', '0');
  cvar.registerVariable('gamecfg', '0');
  cvar.registerVariable('scratch1', '0');
  cvar.registerVariable('scratch2', '0');
  cvar.registerVariable('scratch3', '0');
  cvar.registerVariable('scratch4', '0');
  cvar.registerVariable('savedgamecfg', '0', true);
  cvar.registerVariable('saved1', '0', true);
  cvar.registerVariable('saved2', '0', true);
  cvar.registerVariable('saved3', '0', true);
  cvar.registerVariable('saved4', '0', true);
  cvr.pr_builtin_find = cvar.registerVariable('pr_builtin_find', '0');
  cvr.pr_builtin_remap = cvar.registerVariable('pr_builtin_remap', '0');
	cvr.pr_checkextension = cvar.registerVariable('pr_checkextension', '1', false, true); //"indicates to QuakeC that the standard quakec extensions system is available (if 0, quakec should not attempt to use extensions)"}
  // Run non-vanilla-CRC v6 progs via resolveForeignDefs; 0 refuses them by name instead.
  cvr.pr_foreigndefs = cvar.registerVariable('pr_foreigndefs', '1');
};

// exec

const opnames = [
  'DONE',
  'MUL_F', 'MUL_V', 'MUL_FV', 'MUL_VF',
  'DIV',
  'ADD_F', 'ADD_V',
  'SUB_F', 'SUB_V',
  'EQ_F', 'EQ_V', 'EQ_S', 'EQ_E', 'EQ_FNC',
  'NE_F', 'NE_V', 'NE_S', 'NE_E', 'NE_FNC',
  'LE', 'GE', 'LT', 'GT',
  'INDIRECT', 'INDIRECT', 'INDIRECT', 'INDIRECT', 'INDIRECT', 'INDIRECT',
  'ADDRESS',
  'STORE_F', 'STORE_V', 'STORE_S', 'STORE_ENT', 'STORE_FLD', 'STORE_FNC',
  'STOREP_F', 'STOREP_V', 'STOREP_S', 'STOREP_ENT', 'STOREP_FLD', 'STOREP_FNC',
  'RETURN',
  'NOT_F', 'NOT_V', 'NOT_S', 'NOT_ENT', 'NOT_FNC',
  'IF', 'IFNOT',
  'CALL0', 'CALL1', 'CALL2', 'CALL3', 'CALL4', 'CALL5', 'CALL6', 'CALL7', 'CALL8',
  'STATE',
  'GOTO',
  'AND', 'OR',
  'BITAND', 'BITOR'
];

export const printStatement = function (s: Statement) {
  var text = state.xstatement.toString().padEnd(7, ' ')

  if (s.op < opnames.length) {
    text += opnames[s.op] + ' ';
    for (; text.length <= 17;)
      text += ' ';
  }
  if ((s.op === OP.jnz) || (s.op === OP.jz))
    text += globalString(s.a) + 'branch ' + s.b;
  else if (s.op === OP.jump)
    text += 'branch ' + s.a;
  else if ((s.op >= OP.store_f) && (s.op <= OP.store_fnc))
    text += globalString(s.a) + globalStringNoContents(s.b);
  else {
    if (s.a !== 0)
      text += globalString(s.a);
    if (s.b !== 0)
      text += globalString(s.b);
    if (s.c !== 0)
      text += globalStringNoContents(s.c);
  }
  con.print(text + '\n');
};

export const stackTrace = function () {
  if (state.depth === 0) {
    con.print('<NO STACK>\n');
    return;
  }
  state.stack[state.depth] = [state.xstatement, state.xfunction];
  var f, file;
  for (; state.depth >= 0; --state.depth) {
    f = state.stack[state.depth][1];
    if (f == null) {
      con.print('<NO FUNCTION>\n');
      continue;
    }
    file = getString(f.file);
    for (; file.length <= 11;)
      file += ' ';
    con.print(file + ' : ' + getString(f.name) + '\n');
  }
  state.depth = 0;
};

export const profile_f = function () {
  if (sv.state.server.phase !== 'active')
    return;
  var num = 0, max, best, i, f, profile;
  for (; ;) {
    max = 0;
    best = null;
    for (i = 0; i < state.functions.length; ++i) {
      f = state.functions[i];
      if (f.profile > max) {
        max = f.profile;
        best = f;
      }
    }
    if (best == null)
      return;
    if (num < 10) {
      profile = best.profile.toString();
      for (; profile.length <= 6;)
        profile = ' ' + profile;
      con.print(profile + ' ' + getString(best.name) + '\n');
    }
    ++num;
    best.profile = 0;
  }
};

export const runError = function (error: string) {
  printStatement(state.statements[state.xstatement]);
  stackTrace();
  con.print(error + '\n');
  // Vanilla PR_RunError drops the whole QC stack before Host_Error; leaving it would trip
  // switchVM's on-the-stack guard every frame after.
  state.depth = 0;
  state.localstack_used = 0;
  host.throwError('Program error');
};

const enterFunction = function (f: Function) {
  // reuse the frame tuple at this depth (vanilla's pr_stack is a fixed struct array)
  var frame = state.stack[state.depth];
  if (frame === undefined)
    frame = state.stack[state.depth] = [0, null];
  frame[0] = state.xstatement;
  frame[1] = state.xfunction;
  ++state.depth;
  var c = f.locals;
  if ((state.localstack_used + c) > localstack_size)
    runError('PR.EnterFunction: locals stack overflow\n');
  var i;
  for (i = 0; i < c; ++i)
    state.localstack[state.localstack_used + i] = state.globals_int[f.parm_start + i];
  state.localstack_used += c;
  var o = f.parm_start, j;
  for (i = 0; i < f.numparms; ++i) {
    for (j = 0; j < f.parm_size[i]; ++j)
      state.globals_int[o++] = state.globals_int[4 + i * 3 + j];
  }
  state.xfunction = f;
  return f.first_statement - 1;
};

const leaveFunction = function () {
  if (state.depth <= 0)
    sys.error('prog stack underflow');
  var c = state.xfunction.locals;
  state.localstack_used -= c;
  if (state.localstack_used < 0)
    runError('PR.LeaveFunction: locals stack underflow\n');
  for (--c; c >= 0; --c)
    state.globals_int[state.xfunction.parm_start + c] = state.localstack[state.localstack_used + c];
  state.xfunction = state.stack[--state.depth][1];
  return state.stack[state.depth][0];
};

export const executeProgram = function (fnum: number) {
  if ((fnum === 0) || (fnum >= state.functions.length)) {
    if (state.globals_int[globalvars.self] !== 0)
      ed.print(state.edicts[state.globals_int[globalvars.self]]);
    host.throwError('PR.ExecuteProgram: NULL function');
  }
  // classic Quake used 100000, far too low for modern maps whose spawn/StartFrame
  // logic iterates thousands of entities in one call (Ironwail raised it to 0x1000000).
  var runaway = 0x1000000;
  var exitdepth = state.depth;
  // Tempstring mark, released on the way out (FTE pr_exec.c:1925/1934).
  var tempdepth = state.string_temp_slot;
  var s = enterFunction(state.functions[fnum]);
  var st: Statement, _ed: Edict, ptr, newf;

  for (; ;) {
    ++s;
    st = state.statements[s];
    if (--runaway === 0)
      runError('runaway loop error');
    ++state.xfunction.profile;
    state.xstatement = s;
    if (state.trace === true)
      printStatement(st);
    switch (st.op) {
      case OP.add_f:
        state.globals_float[st.c] = state.globals_float[st.a] + state.globals_float[st.b];
        continue;
      case OP.add_v:
        state.globals_float[st.c] = state.globals_float[st.a] + state.globals_float[st.b];
        state.globals_float[st.c + 1] = state.globals_float[st.a + 1] + state.globals_float[st.b + 1];
        state.globals_float[st.c + 2] = state.globals_float[st.a + 2] + state.globals_float[st.b + 2];
        continue;
      case OP.sub_f:
        state.globals_float[st.c] = state.globals_float[st.a] - state.globals_float[st.b];
        continue;
      case OP.sub_v:
        state.globals_float[st.c] = state.globals_float[st.a] - state.globals_float[st.b];
        state.globals_float[st.c + 1] = state.globals_float[st.a + 1] - state.globals_float[st.b + 1];
        state.globals_float[st.c + 2] = state.globals_float[st.a + 2] - state.globals_float[st.b + 2];
        continue;
      case OP.mul_f:
        state.globals_float[st.c] = state.globals_float[st.a] * state.globals_float[st.b];
        continue;
      case OP.mul_v:
        state.globals_float[st.c] = state.globals_float[st.a] * state.globals_float[st.b] +
          state.globals_float[st.a + 1] * state.globals_float[st.b + 1] +
          state.globals_float[st.a + 2] * state.globals_float[st.b + 2];
        continue;
      case OP.mul_fv:
        state.globals_float[st.c] = state.globals_float[st.a] * state.globals_float[st.b];
        state.globals_float[st.c + 1] = state.globals_float[st.a] * state.globals_float[st.b + 1];
        state.globals_float[st.c + 2] = state.globals_float[st.a] * state.globals_float[st.b + 2];
        continue;
      case OP.mul_vf:
        state.globals_float[st.c] = state.globals_float[st.b] * state.globals_float[st.a];
        state.globals_float[st.c + 1] = state.globals_float[st.b] * state.globals_float[st.a + 1];
        state.globals_float[st.c + 2] = state.globals_float[st.b] * state.globals_float[st.a + 2];
        continue;
      case OP.div_f:
        state.globals_float[st.c] = state.globals_float[st.a] / state.globals_float[st.b];
        continue;
      case OP.bitand:
        state.globals_float[st.c] = state.globals_float[st.a] & state.globals_float[st.b];
        continue;
      case OP.bitor:
        state.globals_float[st.c] = state.globals_float[st.a] | state.globals_float[st.b];
        continue;
      case OP.ge:
        state.globals_float[st.c] = (state.globals_float[st.a] >= state.globals_float[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.le:
        state.globals_float[st.c] = (state.globals_float[st.a] <= state.globals_float[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.gt:
        state.globals_float[st.c] = (state.globals_float[st.a] > state.globals_float[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.lt:
        state.globals_float[st.c] = (state.globals_float[st.a] < state.globals_float[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.and:
        state.globals_float[st.c] = ((state.globals_float[st.a] !== 0.0) && (state.globals_float[st.b] !== 0.0)) ? 1.0 : 0.0;
        continue;
      case OP.or:
        state.globals_float[st.c] = ((state.globals_float[st.a] !== 0.0) || (state.globals_float[st.b] !== 0.0)) ? 1.0 : 0.0;
        continue;
      case OP.not_f:
        state.globals_float[st.c] = (state.globals_float[st.a] === 0.0) ? 1.0 : 0.0;
        continue;
      case OP.not_v:
        state.globals_float[st.c] = ((state.globals_float[st.a] === 0.0) &&
          (state.globals_float[st.a + 1] === 0.0) &&
          (state.globals_float[st.a + 2] === 0.0)) ? 1.0 : 0.0;
        continue;
      case OP.not_s:
        if (state.globals_int[st.a] !== 0)
          state.globals_float[st.c] = (state.strings[state.globals_int[st.a]] === 0) ? 1.0 : 0.0;
        else
          state.globals_float[st.c] = 1.0;
        continue;
      case OP.not_fnc:
      case OP.not_ent:
        state.globals_float[st.c] = (state.globals_int[st.a] === 0) ? 1.0 : 0.0;
        continue;
      case OP.eq_f:
        state.globals_float[st.c] = (state.globals_float[st.a] === state.globals_float[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.eq_v:
        state.globals_float[st.c] = ((state.globals_float[st.a] === state.globals_float[st.b])
          && (state.globals_float[st.a + 1] === state.globals_float[st.b + 1])
          && (state.globals_float[st.a + 2] === state.globals_float[st.b + 2])) ? 1.0 : 0.0;
        continue;
      case OP.eq_s:
        state.globals_float[st.c] = compareStrings(state.globals_int[st.a], state.globals_int[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.eq_e:
      case OP.eq_fnc:
        state.globals_float[st.c] = (state.globals_int[st.a] === state.globals_int[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.ne_f:
        state.globals_float[st.c] = (state.globals_float[st.a] !== state.globals_float[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.ne_v:
        state.globals_float[st.c] = ((state.globals_float[st.a] !== state.globals_float[st.b])
          || (state.globals_float[st.a + 1] !== state.globals_float[st.b + 1])
          || (state.globals_float[st.a + 2] !== state.globals_float[st.b + 2])) ? 1.0 : 0.0;
        continue;
      case OP.ne_s:
        state.globals_float[st.c] = compareStrings(state.globals_int[st.a], state.globals_int[st.b]) ? 0.0 : 1.0;
        continue;
      case OP.ne_e:
      case OP.ne_fnc:
        state.globals_float[st.c] = (state.globals_int[st.a] !== state.globals_int[st.b]) ? 1.0 : 0.0;
        continue;
      case OP.store_f:
      case OP.store_ent:
      case OP.store_fld:
      case OP.store_s:
      case OP.store_fnc:
        state.globals_int[st.b] = state.globals_int[st.a];
        continue;
      case OP.store_v:
        state.globals_int[st.b] = state.globals_int[st.a];
        state.globals_int[st.b + 1] = state.globals_int[st.a + 1];
        state.globals_int[st.b + 2] = state.globals_int[st.a + 2];
        continue;
      case OP.storep_f:
      case OP.storep_ent:
      case OP.storep_fld:
      case OP.storep_s:
      case OP.storep_fnc:
        ptr = state.globals_int[st.b];
        state.edicts[Math.floor(ptr / state.edict_size)].v_int[((ptr % state.edict_size) - 96) >> 2] = state.globals_int[st.a];
        continue;
      case OP.storep_v:
        _ed = state.edicts[Math.floor(state.globals_int[st.b] / state.edict_size)];
        ptr = ((state.globals_int[st.b] % state.edict_size) - 96) >> 2;
        _ed.v_int[ptr] = state.globals_int[st.a];
        _ed.v_int[ptr + 1] = state.globals_int[st.a + 1];
        _ed.v_int[ptr + 2] = state.globals_int[st.a + 2];
        continue;
      case OP.address:
        const edictNum = state.globals_int[st.a];
        // world-write guard is server semantics: only spawnServer/loadFromFile may write edict 0
        if ((edictNum === 0) && (sv.state.server.phase !== 'loading'))
          runError('assignment to world entity');
        state.globals_int[st.c] = edictNum * state.edict_size + 96 + (state.globals_int[st.b] << 2);
        continue;
      case OP.load_f:
      case OP.load_fld:
      case OP.load_ent:
      case OP.load_s:
      case OP.load_fnc:
        state.globals_int[st.c] = state.edicts[state.globals_int[st.a]].v_int[state.globals_int[st.b]];
        continue;
      case OP.load_v:
        _ed = state.edicts[state.globals_int[st.a]];
        ptr = state.globals_int[st.b];
        state.globals_int[st.c] = _ed.v_int[ptr];
        state.globals_int[st.c + 1] = _ed.v_int[ptr + 1];
        state.globals_int[st.c + 2] = _ed.v_int[ptr + 2];
        continue;
      case OP.jz:
        if (state.globals_int[st.a] === 0)
          s += ((st.b << 16) >> 16) - 1;
        continue;
      case OP.jnz:
        if (state.globals_int[st.a] !== 0) 
          s += ((st.b << 16) >> 16) - 1;
        continue;
      case OP.jump:
        s += ((st.a << 16) >> 16) - 1;
        continue;
      case OP.call0:
      case OP.call1:
      case OP.call2:
      case OP.call3:
      case OP.call4:
      case OP.call5:
      case OP.call6:
      case OP.call7:
      case OP.call8:
        state.argc = st.op - OP.call0;
        if (state.globals_int[st.a] === 0)
          runError('NULL function');
        newf = state.functions[state.globals_int[st.a]];
        if (newf.first_statement < 0) {
          ptr = -newf.first_statement;
          if (ptr >= state.builtins.length) {
            con.dPrint('Unimplemented builtin: ' + ptr)
            continue;
          }
          state.builtins[ptr]();
          continue;
        }
        s = enterFunction(newf);
        continue;
      case OP.done:
      case OP.ret:
        state.globals_int[1] = state.globals_int[st.a];
        state.globals_int[2] = state.globals_int[st.a + 1];
        state.globals_int[3] = state.globals_int[st.a + 2];
        s = leaveFunction();
        if (state.depth === exitdepth) {
          tempRelease(tempdepth, state);
          return;
        }
        continue;
      case OP.state:
        _ed = state.edicts[state.globals_int[globalvars.self]];
        _ed.v_float[entvars.nextthink] = state.globals_float[globalvars.time] + 0.1;
        _ed.v_float[entvars.frame] = state.globals_float[st.a];
        _ed.v_int[entvars.think] = state.globals_int[st.b];
        continue;
    }
    runError('Bad opcode ' + st.op);
  }
};

// getString against a bare string heap, for tables that belong to no VM (pr_scanprogs' parse).
export const stringAt = function (strings: number[], num: number) {
  var string = [];
  for (; num < strings.length; ++num) {
    if (strings[num] === 0)
      break;
    string[string.length] = String.fromCharCode(strings[num]);
  }
  return string.join('');
};

// A string offset is only meaningful against the VM it came from; pass that VM when not the active one.
export const getString = function (num: number, vm: PrState = state) {
  return stringAt(vm.strings, num);
};

// strcmp directly on the string heap (vanilla PF_Find / OP_EQ_S) without materializing
// JS strings.
export const compareStrings = function (a: number, b: number) {
  if (a === b)
    return true;
  var s = state.strings, ca, cb;
  for (;;) {
    ca = s[a++] || 0;  // out-of-range (incl. bad offsets) reads as NUL, like getString
    cb = s[b++] || 0;
    if (ca !== cb)
      return false;
    if (ca === 0)
      return true;
  }
};

export const newString = function (s: string, length: number) {
  var ofs = state.strings.length;
  var i;
  if (s.length >= length) {
    for (i = 0; i < (length - 1); ++i)
      state.strings[state.strings.length] = s.charCodeAt(i);
    state.strings[state.strings.length] = 0;

    return ofs;
  }
  for (i = 0; i < s.length; ++i)
    state.strings[state.strings.length] = s.charCodeAt(i);
  length -= s.length;
  for (i = 0; i < length; ++i)
    state.strings[state.strings.length] = 0;
  return ofs;
};

// Two lifetime models, gated per VM like the physics deltas: native ssqc keeps the single fixed
// buffer (127-char cap), byte-identical to the wasm sim - a stored tempstring must carry the
// same string_t on both backends; csqc/foreign get a fresh buffer per builtin, freed when the
// entry point returns (FTE PR_AllocTempString / PR_FreeTemps, pr_exec.c:1925).
export const tempString = function (str: string): number {
  if (state === vms.ssqc && !state.foreigndefs) {
    if (str.length > 127)
      str = str.substring(0, 127);
    for (var i = 0; i < str.length; ++i)
      state.strings[state.string_temp + i] = str.charCodeAt(i);
    state.strings[state.string_temp + str.length] = 0;
    return state.string_temp;
  }
  const slot = state.string_temp_slot++;
  return state.string_temp = tempStringAt(slot, str);
};

// Engine code filling tempstring ARGUMENTS must allocate them with tempString (a fixed slot is
// where the QC's own first allocation lands, overwriting the argument as it is read) and hand the
// mark back with tempRelease, or repeated events walk the allocation point up forever.
export const tempMark = function (vm: PrState = state): number {
  return vm.string_temp_slot;
};

// Release every tempstring allocated since `mark`. Zeroing byte 0 is FTE's freed-tempstring tag
// (PR_FreeTemps, pr_exec.c:1925): QC holding a stale reference reads "" instead of garbage, and
// mods test for exactly that.
export const tempRelease = function (mark: number, vm: PrState = state) {
  for (var i = mark; i < vm.string_temp_slot; ++i) {
    const ofs = vm.string_temps[i];
    if (ofs != null)
      vm.strings[ofs] = 0;
  }
  vm.string_temp_slot = mark;
};

// QSS STRINGTEMP_LENGTH (progs.h:173). Also the length at which csqc.parsePrint gives up on
// finding a newline, since prints reach QC through these buffers.
export const STRINGTEMP_LENGTH = 1024

// PR_MakeTempString (QSS pr_ext.c:74) against buffer `slot`; buffers are allocated once per VM
// and reused.
export const tempStringAt = function (slot: number, str: string): number {
  var ofs = state.string_temps[slot];
  const needed = str.length + 1;
  if (ofs == null || needed > state.string_temp_caps[slot]) {
    // Regrow rather than truncate (whole files return through here); the abandoned buffer
    // stays in the heap, bounded by each slot's largest-ever string.
    const cap = needed > STRINGTEMP_LENGTH ? needed : STRINGTEMP_LENGTH;
    ofs = state.string_temps[slot] = newString('', cap);
    state.string_temp_caps[slot] = cap;
  }
  for (var i = 0; i < str.length; ++i)
    state.strings[ofs + i] = str.charCodeAt(i);
  state.strings[ofs + str.length] = 0;
  return ofs;
};

export const encodeAlpha = (val: number) => {
  const alpha = val <= 0 ? 0 : Math.round(val * 254 + 1);
  return alpha > 255 ? 255 : alpha
}

export const decodeAlpha = (val: number) => {
  return val === 0 ? 1 : ((val - 1) / 254)
}

// Ironwail/QSS ENTSCALE_ENCODE/DECODE (protocol.h): ENTSCALE_DEFAULT 16 == float 1.0.
// Byte-truncate like the C unsigned-char store so the wire value matches bit-for-bit.
export const encodeScale = (val: number) => {
  return (val ? val * 16 : 16) & 0xff
}

export const decodeScale = (val: number) => {
  return val / 16
}