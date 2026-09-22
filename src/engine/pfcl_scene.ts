// EXT_CSQC scene/view builtins (QSS pr_ext.c:6643-7560): clearscene/addentity/addentities/
// setproperty/renderscene, the projection helpers, the csqc-side model and particle registries, and
// the read-only queries. Registered into the client builtin table by pfcl.init().
import * as chase from './chase'
import * as cl from './cl'
import * as com from './com'
import * as con from './console'
import * as csqc from './csqc'
import * as ed from './ed'
import * as input from './input'
import * as key from './key'
import * as mod from './mod'
import * as pf from './pf'
import * as pfcl from './pfcl'
import * as pr from './pr'
import * as protocol from './protocol'
import * as pscript from './pscript'
import * as r from './r'
import * as render from './render'
import * as sbar from './sbar'
import * as scr from './scr'
import * as sv from './sv'
import * as v from './v'
import * as vec from './vec'
import * as vid from './vid'
import { Edict, Entity, LightCache, Model } from './types'

const PARM0 = 4
const PARM1 = 7
const PARM2 = 10
const PARM3 = 13
const RETURN = 1

// QSS MAX_MODELS / MAX_PARTICLETYPES: the caps the csqc-side precache lists share with the server's.
const MAX_MODELS = 2048
const MAX_PARTICLETYPES = 2048

// The planes r.state.perspective is built with; project/unproject rebuild the same matrix.
const NEARCLIP = 4
const FARCLIP = 65536

// setproperty/getproperty selectors (QSS pr_ext.c:6829-6900). Only the ones QSS itself implements
// are listed; everything else falls through to the unsupported-property warning.
const VF = {
  min: 1, min_x: 2, min_y: 3,
  size: 4, size_x: 5, size_y: 6,
  viewport: 7,
  fov: 8, fov_x: 9, fov_y: 10,
  origin: 11, origin_x: 12, origin_y: 13, origin_z: 14,
  angles: 15, angles_x: 16, angles_y: 17, angles_z: 18,
  drawworld: 19, drawenginesbar: 20, drawcrosshair: 21,
  mindist: 23, maxdist: 24,
  cl_viewangles: 33, cl_viewangles_x: 34, cl_viewangles_y: 35, cl_viewangles_z: 36,
  activeseat: 202, afov: 203, screenvsize: 204, screenpsize: 205
}

// addentities masks (QSS pr_ext.c:6686-6690). MASK_NORMAL is not an engine constant, just the
// conventional first .drawmask bit; the loop below ANDs the whole argument against the field.
const MASK_ENGINE = 1
const MASK_VIEWMODEL = 2

// getentity field selectors (QSS getrenderentityfield_e, pr_ext.c:7381-7425).
const GE = {
  maxents: -1, active: 0, origin: 1, forward: 2, right: 3, up: 4, scale: 5,
  originandvectors: 6, alpha: 7, colormod: 8, pantscolor: 9, shirtcolor: 10, skin: 11,
  modelindex: 200, effects: 202, frame: 203, angles: 204
}

export let state = {
  // QSS's csqc viewprops (pr_ext.c:6775-6787), reset by clearscene. rect_* are virtual canvas
  // units; renderscene scales them to pixels. drawworld lives on r.state.refdef instead.
  rect_x: 0,
  rect_y: 0,
  rect_w: 0,
  rect_h: 0,
  afov: 0,
  fov_x: 0,
  fov_y: 0,
  origin: vec.emptyV3(),
  angles: vec.emptyV3(),
  drawsbar: false,
  drawcrosshair: false,
  // COM_Parse cursor over the worldmodel's entity lump for getentitytoken (QSS csqcmapentitydata).
  entitydata: null as string | null,
  // model name -> progs string offset, so setmodel/setmodelindex don't mint a new string per call.
  modelstrings: new Map<string, number>(),
  // Persistent scratch for the projection builtins: they run per HUD label per frame.
  proj: new Float32Array(9),
  // getlight's lightmap sample cache, so repeated queries at one point don't re-trace.
  lightcache: { surf: 0, ds: 0, dt: 0, pos: new Float32Array(3) } as LightCache,
  // Vector arguments of the particle builtins; their consumers read them immediately.
  partorg: vec.emptyV3(),
  partvel: vec.emptyV3(),
  trailstart: vec.emptyV3(),
  trailend: vec.emptyV3(),
  // Builtins refused for want of engine support, warned once per session each.
  warned: new Set<string>()
}

// Drop everything tied to the csqc progs image: the model-name string offsets point into a strings
// array pr.resetVM is about to rebuild, and the entity-lump cursor belongs to the old map.
export const reset = function () {
  state.modelstrings.clear()
  state.entitydata = null
}

const warnOnce = function (what: string) {
  if (state.warned.has(what))
    return
  state.warned.add(what)
  con.print('CSQC: ' + what + ' is not supported\n')
}

// ---- csqc-side model precache (QSS CL_Precache_Model, pr_cmds.c:1968) ----
// Models the client progs names itself get negative indices so they can't collide with the
// server's precache list; cl.modelForIndex resolves both signs.

export const precacheModel = function (name: string): number {
  if (name.length === 0)
    return 0
  const clState = cl.clState
  var i: number
  // Already precached by the server? Then use the index both sides agree on.
  for (i = 1; i < clState.model_precache.length; ++i) {
    if ((clState.model_precache[i] != null) && (clState.model_precache[i].name === name))
      return i
  }
  for (i = 1; i < clState.model_name_csqc.length; ++i) {
    if (clState.model_name_csqc[i] === name)
      return -i
  }
  if (i >= MAX_MODELS) {
    pr.runError('CL_Precache_Model: overflow')
    return 0
  }
  clState.model_name_csqc[i] = name
  clState.model_precache_csqc[i] = mod.forName(name, false) as Model
  return -i
}

// ---- csqc-side particle precache (QSS PF_CL_ForceParticlePrecache/PF_CL_GetParticle, pr_ext.c:5220-5265) ----

const forceParticlePrecache = function (name: string): number {
  const clState = cl.clState
  var i: number
  for (i = 1; i < clState.particle_precache.length; ++i) {
    if (clState.particle_precache[i] === name)
      return i
  }
  for (i = 1; i < clState.local_particle_precache.length; ++i) {
    if (clState.local_particle_precache[i] === name)
      return -i
  }
  if (i >= MAX_PARTICLETYPES)
    return 0
  clState.local_particle_precache[i] = name
  return -i
}

// Effect index (either sign) -> pscript effect type, or -1 when the name is unknown.
const particleType = function (idx: number): number {
  const clState = cl.clState
  if (idx === 0)
    return -1
  const name = (idx < 0) ? clState.local_particle_precache[-idx] : clState.particle_precache[idx]
  return (name != null) ? pscript.findParticleType(name) : -1
}

// ---- #300 clearscene (QSS PF_cl_clearscene, pr_ext.c:6790-6826) ----

export const clearscene = function () {
  cl.state.numvisedicts = 0
  cl.state.num_temp_entities = 0
  // FTE's clearscene drops the csqc 3D polygon batch too (PF_R_ClearScene -> CL_ClearEntityLists,
  // pr_csqc.c:2075). This is the ONLY thing that empties the batch — renderscene draws it without
  // consuming it.
  r.clearScenePolygons()
  pfcl.polyReset()

  // The temporary dlights dynamiclight_add made live exactly one frame.
  for (var i = 0; i < cl.state.dlights.length; ++i) {
    if (cl.state.dlights[i].decay === -1)
      cl.state.dlights[i].radius = 0
  }

  const scale = pfcl.vmScale()
  state.rect_x = state.rect_y = 0
  state.rect_w = vid.state.width / scale
  state.rect_h = vid.state.height / scale
  state.afov = state.fov_x = state.fov_y = 0
  state.drawsbar = false
  state.drawcrosshair = false

  // The default camera is the engine's own, so a csprogs that only calls renderscene gets the
  // vanilla view; the viewmodel is opt-in through addentities(MASK_VIEWMODEL), as in QSS.
  // Pre-signon the view entity may not exist yet, and the zeroed seed is what QSS computes there.
  r.state.refdef.drawworld = true
  r.state.refdef.drawviewmodel = false
  if (cl.state.entities[cl.clState.viewentity] != null) {
    v.calcRefdef()
    vec.copy(r.state.refdef.vieworg, state.origin)
    vec.copy(r.state.refdef.viewangles, state.angles)
  } else {
    vec.copy(vec.origin, state.origin)
    vec.copy(vec.origin, state.angles)
  }
}

// ---- #302 addentity / #301 addentities (QSS PR_addentity_internal/PF_cs_addentities, pr_ext.c:6588-6753) ----

// Copy one csqc edict's render fields into a render entity appended to the visedict list. The
// entities come from cl.state.temp_entities, a persistent pool, so this allocates nothing per frame.
const addEntityInternal = function (e: Edict) {
  const model = pr.state.getModel(e.v_float[pr.entvars.modelindex] >> 0)
  if (model == null)
    return
  const fields = csqc.state.extfields
  const rent = cl.newTempEntity()

  rent.origin[0] = e.v_float[pr.entvars.origin]
  rent.origin[1] = e.v_float[pr.entvars.origin1]
  rent.origin[2] = e.v_float[pr.entvars.origin2]
  rent.angles[0] = e.v_float[pr.entvars.angles]
  rent.angles[1] = e.v_float[pr.entvars.angles1]
  rent.angles[2] = e.v_float[pr.entvars.angles2]
  rent.model = model
  rent.frame = e.v_float[pr.entvars.frame]
  rent.skinnum = e.v_float[pr.entvars.skin]
  rent.colormap = 0
  rent.effects = 0
  rent.alpha = (fields.alpha != null) ? pr.encodeAlpha(e.v_float[fields.alpha]) : protocol.ENT_ALPHA.default
  rent.scale = (fields.scale != null) ? pr.encodeScale(e.v_float[fields.scale]) : protocol.ENTSCALE_DEFAULT

  // Explicit pose blending + tint, QSS PR_addentity_internal (pr_ext.c:6597-6639).
  // newTempEntity cleared LERP.explicit and colormod; only nonzero QC fields re-arm them.
  if ((fields.colormod != null)
    && (e.v_float[fields.colormod] !== 0 || e.v_float[fields.colormod + 1] !== 0 || e.v_float[fields.colormod + 2] !== 0)) {
    rent.colormod[0] = e.v_float[fields.colormod]
    rent.colormod[1] = e.v_float[fields.colormod + 1]
    rent.colormod[2] = e.v_float[fields.colormod + 2]
  }
  // "can't exactly use currentpose/previous pose, as we don't know them" - QSS pr_ext.c:6621.
  // LERP.explicit routes setupAliasFrame to the snap fields; resetanim/resetmove came from
  // newTempEntity.
  rent.lerpflags |= r.LERP.explicit
  rent.snapFrame2 = (fields.frame2 != null) ? e.v_float[fields.frame2] : 0
  var lf = (fields.lerpfrac != null) ? e.v_float[fields.lerpfrac] : 0
  rent.snapLerpfrac = lf < 0 ? 0 : (lf > 1 ? 1 : lf)
  rent.snapTime1 = (fields.frame1time != null) ? e.v_float[fields.frame1time] : 0
  rent.snapTime2 = (fields.frame2time != null) ? e.v_float[fields.frame2time] : 0

  // .colormap rides through to the draw (FTE pr_csqc.c:861-879; QSS drops it).
  rent.colormap = e.v_float[pr.entvars.colormap] >> 0

  const rf = (fields.renderflags != null) ? (e.v_float[fields.renderflags] >> 0) : 0
  if (rf !== 0) {
    // QSS's consumed set (pr_ext.c:6631-6639). RF_DEPTHHACK (bit 4) is silently ignored standalone
    // as in QSS — the viewmodel path already applies the depth squash.
    if ((rf & 1) !== 0)
      rent.eflags |= r.EFLAGS.viewmodel
    if ((rf & 2) !== 0)
      rent.eflags |= r.EFLAGS.exteriormodel
    if ((rf & 64) !== 0) {   // RF_WEIRDFRAMETIMES: frameNtime arrives as 'time - frameNtime'
      rent.snapTime1 = pr.state.time - rent.snapTime1
      rent.snapTime2 = pr.state.time - rent.snapTime2
    }
    if ((rf & ~(1 | 2 | 4 | 64)) !== 0)
      warnOnce('.renderflags bits ' + (rf & ~(1 | 2 | 4 | 64)) + ' on csqc entities')
  }
}

export const addentity = function () {
  addEntityInternal(pr.state.edicts[pr.state.globals_int[PARM0]])
}

export const addentities = function () {
  const mask = pr.state.globals_float[PARM0] >> 0
  if (mask === 0)
    return

  if (((mask & MASK_ENGINE) !== 0) && (pr.state.worldmodel != null)) {
    // Beams/explosions first: they rebuild the temp entity pool.
    cl.updateTEnts()
    for (var i = 1; i < cl.state.entities.length; ++i) {
      const ent = cl.state.entities[i]
      if (ent.model == null)
        continue
      if ((i === cl.clState.viewentity) && (chase.cvr.active.value === 0))
        continue
      cl.state.visedicts[cl.state.numvisedicts++] = ent
    }
  }

  const drawmask = csqc.state.extfields.drawmask
  if (drawmask != null) {
    const predraw = csqc.state.extfields.predraw
    for (var e = 1; e < pr.state.num_edicts; ++e) {
      const edict = pr.state.edicts[e]
      if ((edict == null) || (edict.free === true))
        continue
      if (((edict.v_float[drawmask] >> 0) & mask) === 0)
        continue
      if ((predraw != null) && (edict.v_int[predraw] !== 0)) {
        pr.state.globals_int[pr.globalvars.self] = e
        pr.executeProgram(edict.v_int[predraw])
        // Nonzero return is PREDRAW_NEXT (the QC drew it); re-read because predraw may have freed
        // the edict out from under us.
        if ((pr.state.edicts[e].free === true) || (pr.state.globals_float[RETURN] !== 0))
          continue
      }
      addEntityInternal(edict)
    }
  }

  // Delta from QSS: QSS appends cl.viewent to the visedict list here; our renderer draws the
  // viewmodel on its own path, so the mask flips a refdef flag instead.
  if ((mask & MASK_VIEWMODEL) !== 0)
    r.state.refdef.drawviewmodel = true
}

// ---- #305 dynamiclight_add (QSS PF_cs_addlight, pr_ext.c:6757) ----

export const dynamiclight_add = function () {
  const g = pr.state.globals_float
  const dl = cl.allocDlight(0)
  dl.origin[0] = g[PARM0]; dl.origin[1] = g[PARM0 + 1]; dl.origin[2] = g[PARM0 + 2]
  dl.color[0] = g[PARM2]; dl.color[1] = g[PARM2 + 1]; dl.color[2] = g[PARM2 + 2]
  dl.radius = g[PARM1]
  dl.minlight = 32
  dl.die = cl.clState.time + 1
  dl.decay = -1    // the marker clearscene kills: this light lives one frame
}

// ---- #303 setproperty / #309 getproperty (QSS PF_cl_setproperty/PF_cl_getproperty, pr_ext.c:6901-7137) ----

export const setproperty = function () {
  const g = pr.state.globals_float
  const prop = g[PARM0] >> 0
  switch (prop) {
  case VF.min:
    state.rect_x = g[PARM1]; state.rect_y = g[PARM1 + 1];
    return
  case VF.min_x: state.rect_x = g[PARM1]; return
  case VF.min_y: state.rect_y = g[PARM1]; return
  case VF.size:
    state.rect_w = g[PARM1]; state.rect_h = g[PARM1 + 1];
    return
  case VF.size_x: state.rect_w = g[PARM1]; return
  case VF.size_y: state.rect_h = g[PARM1]; return
  case VF.viewport:
    state.rect_x = g[PARM1]; state.rect_y = g[PARM1 + 1];
    state.rect_w = g[PARM2]; state.rect_h = g[PARM2 + 1];
    return
  case VF.fov:
    state.fov_x = g[PARM1]; state.fov_y = g[PARM1 + 1];
    return
  case VF.fov_x: state.fov_x = g[PARM1]; return
  case VF.fov_y: state.fov_y = g[PARM1]; return
  case VF.origin:
    state.origin[0] = g[PARM1]; state.origin[1] = g[PARM1 + 1]; state.origin[2] = g[PARM1 + 2];
    return
  case VF.origin_x:
  case VF.origin_y:
  case VF.origin_z:
    state.origin[prop - VF.origin_x] = g[PARM1];
    return
  case VF.angles:
    state.angles[0] = g[PARM1]; state.angles[1] = g[PARM1 + 1]; state.angles[2] = g[PARM1 + 2];
    return
  case VF.angles_x:
  case VF.angles_y:
  case VF.angles_z:
    state.angles[prop - VF.angles_x] = g[PARM1];
    return
  case VF.drawworld: r.state.refdef.drawworld = (g[PARM1] !== 0); return
  case VF.drawenginesbar: state.drawsbar = (g[PARM1] !== 0); return
  case VF.drawcrosshair: state.drawcrosshair = (g[PARM1] !== 0); return
  case VF.cl_viewangles:
    cl.clState.viewangles[0] = g[PARM1]; cl.clState.viewangles[1] = g[PARM1 + 1]; cl.clState.viewangles[2] = g[PARM1 + 2];
    return
  case VF.cl_viewangles_x:
  case VF.cl_viewangles_y:
  case VF.cl_viewangles_z:
    cl.clState.viewangles[prop - VF.cl_viewangles_x] = g[PARM1];
    return
  case VF.activeseat:
    if (g[PARM1] !== 0)
      con.print('VF_ACTIVESEAT: splitscreen not supported\n')
    return
  case VF.afov: state.afov = g[PARM1]; return
  }
  con.print('PF_setproperty: unsupported property ' + prop + '\n')
}

export const getproperty = function () {
  const g = pr.state.globals_float
  const prop = g[PARM0] >> 0
  g[RETURN] = g[RETURN + 1] = g[RETURN + 2] = 0
  switch (prop) {
  case VF.min:
    g[RETURN] = state.rect_x; g[RETURN + 1] = state.rect_y;
    return
  case VF.min_x: g[RETURN] = state.rect_x; return
  case VF.min_y: g[RETURN] = state.rect_y; return
  case VF.size:
    g[RETURN] = state.rect_w; g[RETURN + 1] = state.rect_h;
    return
  case VF.size_x: g[RETURN] = state.rect_w; return
  case VF.size_y: g[RETURN] = state.rect_h; return
  case VF.fov:
    g[RETURN] = state.fov_x; g[RETURN + 1] = state.fov_y;
    return
  case VF.fov_x: g[RETURN] = state.fov_x; return
  case VF.fov_y: g[RETURN] = state.fov_y; return
  // Delta from QSS: QSS writes view origin/angles into OFS_PARM1 (pr_ext.c:6945/6957) rather than
  // the return slot; returned here, as FTE does.
  case VF.origin:
    if (blocked(prop)) return
    g[RETURN] = state.origin[0]; g[RETURN + 1] = state.origin[1]; g[RETURN + 2] = state.origin[2];
    return
  case VF.origin_x:
  case VF.origin_y:
  case VF.origin_z:
    if (blocked(prop)) return
    g[RETURN] = state.origin[prop - VF.origin_x];
    return
  case VF.angles:
    if (blocked(prop)) return
    g[RETURN] = state.angles[0]; g[RETURN + 1] = state.angles[1]; g[RETURN + 2] = state.angles[2];
    return
  case VF.angles_x:
  case VF.angles_y:
  case VF.angles_z:
    if (blocked(prop)) return
    g[RETURN] = state.angles[prop - VF.angles_x];
    return
  case VF.drawworld: g[RETURN] = r.state.refdef.drawworld ? 1 : 0; return
  case VF.drawenginesbar: g[RETURN] = state.drawsbar ? 1 : 0; return
  case VF.drawcrosshair: g[RETURN] = state.drawcrosshair ? 1 : 0; return
  case VF.mindist: g[RETURN] = NEARCLIP; return
  case VF.maxdist: g[RETURN] = FARCLIP; return
  case VF.cl_viewangles:
    if (blocked(prop)) return
    g[RETURN] = cl.clState.viewangles[0]; g[RETURN + 1] = cl.clState.viewangles[1]; g[RETURN + 2] = cl.clState.viewangles[2];
    return
  case VF.cl_viewangles_x:
  case VF.cl_viewangles_y:
  case VF.cl_viewangles_z:
    if (blocked(prop)) return
    g[RETURN] = cl.clState.viewangles[prop - VF.cl_viewangles_x];
    return
  case VF.activeseat: g[RETURN] = 0; return
  case VF.afov: g[RETURN] = state.afov; return
  case VF.screenvsize: {
    const scale = pfcl.vmScale()
    g[RETURN] = vid.state.width / scale; g[RETURN + 1] = vid.state.height / scale;
    return
  }
  case VF.screenpsize:
    g[RETURN] = vid.state.width; g[RETURN + 1] = vid.state.height;
    return
  }
  con.print('PF_getproperty(' + prop + '): unsupported property\n')
}

// Simple-tier csqc must not learn where the camera is (QSS qcvm->nogameaccess).
const blocked = function (prop: number): boolean {
  if (!csqc.state.nogameaccess)
    return false
  con.print('PF_getproperty(' + prop + '): not allowed to access game properties\n')
  return true
}

// ---- #304 renderscene (QSS PF_cl_computerefdef/PF_cl_renderscene, pr_ext.c:7139-7228) ----

// viewprops -> r.state.refdef, in pixels, with the fov the QC asked for (or afov/scr_fov).
const computeRefdef = function () {
  const scale = pfcl.vmScale()
  const refdef = r.state.refdef
  vec.copy(state.origin, refdef.vieworg)
  vec.copy(state.angles, refdef.viewangles)
  refdef.vrect.x = state.rect_x * scale
  refdef.vrect.y = state.rect_y * scale
  refdef.vrect.width = state.rect_w * scale
  refdef.vrect.height = state.rect_h * scale

  if ((state.fov_x !== 0) && (state.fov_y !== 0)) {
    refdef.fov_x = state.fov_x
    refdef.fov_y = state.fov_y
    return
  }
  if (state.afov === 0)
    state.afov = scr.cvr.fov.value
  // C integer division in QSS: `vrect.width/vrect.height < 4/3` is `< 1`, i.e. a portrait viewport.
  if (((refdef.vrect.width / refdef.vrect.height) >> 0) < 1) {
    refdef.fov_y = state.afov
    refdef.fov_x = Math.atan(refdef.vrect.width / (refdef.vrect.height / Math.tan(refdef.fov_y * Math.PI / 360.0))) * 360.0 / Math.PI
  } else {
    const fy = Math.tan(state.afov * Math.PI / 360.0) * (3.0 / 4.0)
    const fx = fy * refdef.vrect.width / refdef.vrect.height
    refdef.fov_x = Math.atan(fx) * (360.0 / Math.PI)
    refdef.fov_y = Math.atan(fy) * (360.0 / Math.PI)
  }
}

export const renderscene = function () {
  // mod.clearAll can gut the worldmodel mid-map-change while still connected, and r.renderScene
  // walks it unconditionally; r.renderView guards its own pass the same way.
  const world = cl.clState.worldmodel
  if ((world == null) || ((world as any).nodes == null))
    return

  // fte's PF_R_RenderScene drops the in-progress poly too (pr_csqc.c:2704); the batch itself
  // survives the scene and is drawn again by the next renderscene.
  pfcl.polyReset()

  computeRefdef()
  const refdef = r.state.refdef
  if ((refdef.vrect.width < 1) || (refdef.vrect.height < 1))
    return    // can't draw nuffin

  // The only other rebuild is scr.calcRefdef's, which knows nothing about the viewport/fov the QC
  // just asked for.
  const ymax = 4.0 * Math.tan(refdef.fov_y * Math.PI / 360.0)
  r.state.perspective[0] = 4.0 / (ymax * refdef.vrect.width / refdef.vrect.height)
  r.state.perspective[5] = 4.0 / ymax

  // The engine's per-scene prologue (QSS reaches it via R_MarkSurfaces inside R_RenderView).
  r.gatherDlights()
  r.state.framecount++
  // Depth-only clear per scene, as QSS's R_Clear does at the default gl_clear 0: a second camera
  // composites over the first, and 2D drawn before this stays put. The color clear for the whole
  // csqc frame is scr.updateScreen's, before the QC runs.
  render.getRenderer().clearFrame(false, true)
  // Both backends resolve pending 2D work when a scene opens, so the QC's draw order is preserved
  // across the 3D pass.
  r.renderScene()
  render.getRenderer().begin2D()
  if (r.state.dowarp === true)
    render.getRenderer().endScene()
  if (refdef.drawworld === true)
    render.getRenderer().polyBlend(v.blend)

  if (cl.clState.intermission === 0) {
    if (state.drawsbar === true)
      sbar.drawSbar()
    if (state.drawcrosshair === true)
      scr.drawCrosshair()
  }
  // This scene overwrote the engine's refdef; QSS raises the same flag here so the next
  // engine-owned frame recomputes it.
  scr.state.recalc_refdef = true
}

// ---- #310 unproject / #311 project (QSS PF_cl_unproject/PF_cl_project, pr_ext.c:7230-7312) ----

// The world->clip chain our shaders run (render/webgl/shaders.ts):
//   eye = viewMatrix * (p - vieworg); clip = perspective * vec4(eye.x, eye.z, -eye.y, 1)
// state.proj is that view rotation; the projection scales come from fov_y and the view aspect.
const setupProjection = function () {
  computeRefdef()
  r.computeViewMatrix(state.proj)
}

// r.state.perspective[5]; perspective[0] is this over the view aspect.
const projScaleY = function (): number {
  return 1.0 / Math.tan(r.state.refdef.fov_y * Math.PI / 360.0)
}

export const project = function () {
  const g = pr.state.globals_float
  const scale = pfcl.vmScale()
  const refdef = r.state.refdef
  setupProjection()

  const rel = vec.scratch()
  rel[0] = g[PARM0] - refdef.vieworg[0]
  rel[1] = g[PARM0 + 1] - refdef.vieworg[1]
  rel[2] = g[PARM0 + 2] - refdef.vieworg[2]
  const m = state.proj
  const ex = m[0] * rel[0] + m[3] * rel[1] + m[6] * rel[2]
  const ey = m[1] * rel[0] + m[4] * rel[1] + m[7] * rel[2]
  const ez = m[2] * rel[0] + m[5] * rel[1] + m[8] * rel[2]

  const w = ey
  if (w === 0) {
    g[RETURN] = g[RETURN + 1] = g[RETURN + 2] = 0
    return
  }
  const b = projScaleY()
  const a = b / (refdef.vrect.width / refdef.vrect.height)
  const ndcx = (a * ex) / w
  const ndcy = (b * ez) / w
  var ndcz = (-(FARCLIP + NEARCLIP) / (FARCLIP - NEARCLIP) * -ey - 2.0 * FARCLIP * NEARCLIP / (FARCLIP - NEARCLIP)) / w
  // Keep points behind the camera behind it: the QC uses a negative z as its off-screen test.
  if (w < 0)
    ndcz *= -1

  g[RETURN] = (refdef.vrect.x + refdef.vrect.width * (ndcx + 1) * 0.5) / scale
  g[RETURN + 1] = (refdef.vrect.y + refdef.vrect.height * (1 - (ndcy + 1) * 0.5)) / scale
  g[RETURN + 2] = ndcz
}

export const unproject = function () {
  const g = pr.state.globals_float
  const scale = pfcl.vmScale()
  const refdef = r.state.refdef
  setupProjection()

  const ndcx = ((g[PARM0] * scale - refdef.vrect.x) / refdef.vrect.width) * 2 - 1
  const ndcy = (1 - (g[PARM0 + 1] * scale - refdef.vrect.y) / refdef.vrect.height) * 2 - 1
  var depth = g[PARM0 + 2]
  if (depth >= 1)
    depth = 0.999999   // QSS: 1 lands on the far plane, and some DP mods pass much larger values
  const ndcz = depth * 2 - 1

  // Invert clip.z/clip.w for the eye-space depth, then the projection scales for x/y.
  const c = -(FARCLIP + NEARCLIP) / (FARCLIP - NEARCLIP)
  const d = -2.0 * FARCLIP * NEARCLIP / (FARCLIP - NEARCLIP)
  const denom = -ndcz - c
  if (denom === 0) {
    g[RETURN] = g[RETURN + 1] = g[RETURN + 2] = 0
    return
  }
  const depthz = d / denom      // the vec4's z, i.e. -eye.y
  const w = -depthz
  const b = projScaleY()
  const a = b / (refdef.vrect.width / refdef.vrect.height)
  const ex = ndcx * w / a
  const ez = ndcy * w / b
  const ey = -depthz

  // The view rotation is orthonormal, so its transpose is its inverse.
  const m = state.proj
  g[RETURN] = refdef.vieworg[0] + m[0] * ex + m[1] * ey + m[2] * ez
  g[RETURN + 1] = refdef.vieworg[1] + m[3] * ex + m[4] * ey + m[5] * ez
  g[RETURN + 2] = refdef.vieworg[2] + m[6] * ex + m[7] * ey + m[8] * ez
}

// ---- #3 setmodel / #333 setmodelindex / #334 modelnameforindex / #69 makestatic ----

// A model name as a progs string, minted once per name (QSS leans on PR_SetEngineString's own
// known-string table for the same reason).
const modelString = function (name: string): number {
  const hit = state.modelstrings.get(name)
  if (hit !== undefined)
    return hit
  const ofs = pr.newString(name, name.length + 1)
  state.modelstrings.set(name, ofs)
  return ofs
}

// Both setmodel forms end here (QSS PF_cl_setmodel/PF_cl_setmodelindex, pr_cmds.c:2011,
// pr_ext.c:2203): write .model/.modelindex, then size the edict from the model.
const applyModel = function (e: Edict, index: number) {
  const model = pr.state.getModel(index)
  e.v_int[pr.entvars.model] = (model != null) ? modelString(model.name) : 0
  e.v_float[pr.entvars.modelindex] = index
  if (model != null)
    pf.setMinMaxSize(e, model.mins, model.maxs)
  else
    pf.setMinMaxSize(e, vec.origin, vec.origin)
  const modelflags = csqc.state.extfields.modelflags
  if (modelflags != null)
    e.v_float[modelflags] = (model != null) ? (model.flags & 0xff) : 0
}

export const setmodel = function () {
  const e = pr.state.edicts[pr.state.globals_int[PARM0]]
  applyModel(e, precacheModel(pr.getString(pr.state.globals_int[PARM1])))
}

export const setmodelindex = function () {
  applyModel(pr.state.edicts[pr.state.globals_int[PARM0]], pr.state.globals_float[PARM1] >> 0)
}

export const modelnameforindex = function () {
  const model = pr.state.getModel(pr.state.globals_float[PARM0] >> 0)
  if (model == null) {
    pr.state.globals_int[RETURN] = 0
    return
  }
  pr.tempString(model.name)
  pr.state.globals_int[RETURN] = pr.state.string_temp
}

// float(string modelname, optional float queryonly) getmodelindex = #200 (FTE PF_getmodelindex):
// precache_model + return the index; with queryonly, look up only and return 0 for an unknown name.
export const getmodelindex = function () {
  const name = pr.getString(pr.state.globals_int[PARM0])
  if (pr.state.argc > 1 && pr.state.globals_float[PARM1] !== 0) {
    const clState = cl.clState
    var i: number
    for (i = 1; i < clState.model_precache.length; ++i) {
      if ((clState.model_precache[i] != null) && (clState.model_precache[i].name === name)) {
        pr.state.globals_float[RETURN] = i
        return
      }
    }
    for (i = 1; i < clState.model_name_csqc.length; ++i) {
      if (clState.model_name_csqc[i] === name) {
        pr.state.globals_float[RETURN] = -i
        return
      }
    }
    pr.state.globals_float[RETURN] = 0
    return
  }
  pr.state.globals_float[RETURN] = precacheModel(name)
}

// #69 makestatic (QSS PF_cl_makestatic, pr_cmds.c:2090): promote a csqc edict to a permanent
// client-side entity in the efrag tree, then free the edict. Cold path, so the entity is allocated.
export const makestatic = function () {
  const e = pr.state.edicts[pr.state.globals_int[PARM0]]
  const model = pr.state.getModel(e.v_float[pr.entvars.modelindex] >> 0)
  if (model != null) {
    const fields = csqc.state.extfields
    const stat = cl.newEntity(-1)
    stat.model = model
    stat.frame = e.v_float[pr.entvars.frame]
    stat.skinnum = e.v_float[pr.entvars.skin]
    stat.effects = 0
    stat.colormap = 0
    stat.alpha = (fields.alpha != null) ? pr.encodeAlpha(e.v_float[fields.alpha]) : protocol.ENT_ALPHA.default
    stat.scale = (fields.scale != null) ? pr.encodeScale(e.v_float[fields.scale]) : protocol.ENTSCALE_DEFAULT
    stat.lerpflags |= r.LERP.resetanim | r.LERP.resetmove
    ed.vector(e, pr.entvars.origin, stat.origin)
    ed.vector(e, pr.entvars.angles, stat.angles)
    const emins = vec.scratch(), emaxs = vec.scratch()
    vec.add(stat.origin, model.mins, emins)
    vec.add(stat.origin, model.maxs, emaxs)
    r.splitEntityOnNode(0, stat, emins, emaxs)
  }
  ed.free(e)
}

// ---- #335/336/337 particles (QSS PF_cl_particleeffectnum/trailparticles/pointparticles, pr_ext.c:5268-5320) ----

export const particleeffectnum = function () {
  const name = pr.getString(pr.state.globals_int[PARM0])
  pr.state.globals_float[RETURN] = 0
  if (name.length === 0)
    return
  const idx = forceParticlePrecache(name)
  if (idx === 0)
    pr.runError('PF_cl_particleeffectnum: overflow')
  pr.state.globals_float[RETURN] = idx
  pscript.ensureEffectsLoaded()
}

export const trailparticles = function () {
  const g = pr.state.globals_float
  // DP passes (ent, effectnum); QSS accepts both orders by testing whether the second argument
  // reads as a plausible edict number.
  const efnum = ((pr.state.globals_int[PARM1] >>> 0) >= pr.state.num_edicts) ? (g[PARM1] >> 0) : (g[PARM0] >> 0)
  if (efnum === 0)
    return
  const type = particleType(efnum)
  if (type < 0)
    return
  const start = state.trailstart, end = state.trailend
  start[0] = g[PARM2]; start[1] = g[PARM2 + 1]; start[2] = g[PARM2 + 2]
  end[0] = g[PARM3]; end[1] = g[PARM3 + 1]; end[2] = g[PARM3 + 2]
  pscript.runTrailEffect(type, start as unknown as pscript.Vec3, end as unknown as pscript.Vec3)
}

export const pointparticles = function () {
  const g = pr.state.globals_float
  const count = (pr.state.argc < 4) ? 1 : (g[PARM3] >> 0)
  if (count <= 0)
    return
  const type = particleType(g[PARM0] >> 0)
  if (type < 0)
    return
  const org = state.partorg, vel = state.partvel
  org[0] = g[PARM1]; org[1] = g[PARM1 + 1]; org[2] = g[PARM1 + 2]
  if (pr.state.argc < 3) {
    vel[0] = vel[1] = vel[2] = 0
  } else {
    vel[0] = g[PARM2]; vel[1] = g[PARM2 + 1]; vel[2] = g[PARM2 + 2]
  }
  pscript.runParticleEffect(type, org as unknown as pscript.Vec3, vel as unknown as pscript.Vec3, count)
}

// ---- #340/341/342 keys (QSS PF_cl_keynumtostring/stringtokeynum/getkeybind, pr_ext.c:5706-5732) ----

export const keynumtostring = function () {
  const keynum = key.qcToNative(pr.state.globals_float[PARM0] >> 0)
  pr.tempString((keynum < 0) ? '' : key.keynumToString(keynum))
  pr.state.globals_int[RETURN] = pr.state.string_temp
}

export const stringtokeynum = function () {
  const keynum = key.stringToKeynum(pr.getString(pr.state.globals_int[PARM0]))
  pr.state.globals_float[RETURN] = (keynum == null) ? -1 : key.nativeToQC(keynum)
}

export const getkeybind = function () {
  const keynum = key.qcToNative(pr.state.globals_float[PARM0] >> 0)
  const bind = ((keynum >= 0) && (key.state.bindings[keynum] != null)) ? key.state.bindings[keynum] : ''
  pr.tempString(bind)
  pr.state.globals_int[RETURN] = pr.state.string_temp
}

// ---- #348 getplayerkeyvalue / #349 isdemo / #350 isserver / #354 serverkey ----

// QSS PF_cl_playerkey_internal (pr_ext.c:5871). Delta from QSS: our client carries no per-player
// userinfo string, so only the keys the scoreboard holds are answered.
const playerKey = function (player: number, keyname: string): string {
  if ((player < 0) && (player >= -sbar.state.scoreboardlines))
    player = sbar.state.fragsort[-1 - player]
  const scores = cl.clState.scores
  if ((player < 0) || (player >= scores.length))
    return null
  if (keyname === 'viewentity')
    return String(player + 1)   // DP compat: answered even for an empty slot
  const score = scores[player]
  if ((score == null) || (score.name.length === 0))
    return null
  switch (keyname) {
  case 'name': return score.name
  case 'frags': return String(score.frags)
  case 'ping': return String(score.ping)
  case 'entertime': return String(score.entertime)
  case 'topcolor': return String((score.colors >> 4) & 15)
  case 'bottomcolor': return String(score.colors & 15)
  case 'team': return String((score.colors & 15) + 1)
  }
  return null
}

export const getplayerkeyvalue = function () {
  const val = playerKey(pr.state.globals_float[PARM0] >> 0, pr.getString(pr.state.globals_int[PARM1]))
  if (val == null) {
    pr.state.globals_int[RETURN] = 0
    return
  }
  pr.tempString(val)
  pr.state.globals_int[RETURN] = pr.state.string_temp
}

export const isdemo = function () {
  pr.state.globals_float[RETURN] = (cl.cls.demoplayback === true) ? 1 : 0
}

export const isserver = function () {
  const active = (sv.state.server.phase !== 'inactive')
  pr.state.globals_float[RETURN] = active ? ((sv.state.svs.maxclients > 1) ? 1 : 0.5) : 0
}

// QSS PF_cl_serverkey_internal (pr_ext.c:5966). Delta from QSS: our client keeps no serverinfo
// string, so "constate" is the only answerable key.
export const serverkey = function () {
  const keyname = pr.getString(pr.state.globals_int[PARM0])
  var val = ''
  if (keyname === 'constate') {
    if (cl.cls.state !== cl.ACTIVE.connected)
      val = 'disconnected'
    else if (cl.cls.signon === 4)
      val = 'active'
    else
      val = 'connecting'
  }
  pr.tempString(val)
  pr.state.globals_int[RETURN] = pr.state.string_temp
}

// ---- #351 SetListener (QSS PF_cs_setlistener, pr_ext.c:7316) ----

export const setlistener = function () {
  const g = pr.state.globals_float
  const clState = cl.clState
  clState.listener_defined = true    // lasts until the next video frame
  clState.listener_origin[0] = g[PARM0]; clState.listener_origin[1] = g[PARM0 + 1]; clState.listener_origin[2] = g[PARM0 + 2]
  clState.listener_forward[0] = g[PARM1]; clState.listener_forward[1] = g[PARM1 + 1]; clState.listener_forward[2] = g[PARM1 + 2]
  clState.listener_right[0] = g[PARM2]; clState.listener_right[1] = g[PARM2 + 1]; clState.listener_right[2] = g[PARM2 + 2]
  clState.listener_up[0] = g[PARM3]; clState.listener_up[1] = g[PARM3 + 1]; clState.listener_up[2] = g[PARM3 + 2]
}

// ---- #355 getentitytoken (QSS PF_cs_getentitytoken, pr_ext.c:6495) ----

export const getentitytoken = function () {
  if (pr.state.argc > 0) {
    const arg = pr.getString(pr.state.globals_int[PARM0])
    state.entitydata = (arg.length !== 0) ? arg : ((cl.clState.worldmodel != null) ? cl.clState.worldmodel.entities : null)
    pr.state.globals_int[RETURN] = 0
    return
  }
  if (state.entitydata == null) {
    pr.state.globals_int[RETURN] = 0
    return
  }
  const rest = com.parse(state.entitydata)
  if (rest == null) {
    state.entitydata = null
    pr.state.globals_int[RETURN] = 0
    return
  }
  state.entitydata = rest
  // ED_NewString's escape handling: \n becomes a newline, any other backslash pair a backslash.
  const token = com.state.token
  var out = ''
  for (var i = 0; i < token.length; ++i) {
    if ((token.charCodeAt(i) === 92) && (i < token.length - 1)) {
      ++i
      out += (token.charCodeAt(i) === 110) ? '\n' : '\\'
    } else
      out += token[i]
  }
  pr.tempString(out)
  pr.state.globals_int[RETURN] = pr.state.string_temp
}

// ---- #504 getentity (QSS PF_cl_getrenderentity, pr_ext.c:7426) ----

export const getentity = function () {
  const g = pr.state.globals_float
  const entnum = g[PARM0] >> 0
  const field = g[PARM1] >> 0
  g[RETURN] = g[RETURN + 1] = g[RETURN + 2] = 0
  if (csqc.state.nogameaccess) {
    con.print('PF_getentity: not permitted\n')
    return
  }
  if (field === GE.maxents) {
    g[RETURN] = cl.state.entities.length
    return
  }
  const ent = ((entnum >= 0) && (entnum < cl.state.entities.length)) ? cl.state.entities[entnum] : null
  if ((ent == null) || (ent.model == null))
    return

  switch (field) {
  case GE.active: g[RETURN] = 1; return
  case GE.origin:
    g[RETURN] = ent.origin[0]; g[RETURN + 1] = ent.origin[1]; g[RETURN + 2] = ent.origin[2];
    return
  case GE.angles:
    g[RETURN] = ent.angles[0]; g[RETURN + 1] = ent.angles[1]; g[RETURN + 2] = ent.angles[2];
    return
  case GE.originandvectors:
    g[RETURN] = ent.origin[0]; g[RETURN + 1] = ent.origin[1]; g[RETURN + 2] = ent.origin[2];
    entityVectors(ent, pr.globalvars.v_forward, pr.globalvars.v_right, pr.globalvars.v_up);
    return
  case GE.forward: entityVectors(ent, RETURN, -1, -1); return
  case GE.right: entityVectors(ent, -1, RETURN, -1); return
  case GE.up: entityVectors(ent, -1, -1, RETURN); return
  case GE.scale: g[RETURN] = ent.scale / protocol.ENTSCALE_DEFAULT; return
  case GE.alpha: g[RETURN] = pr.decodeAlpha(ent.alpha); return
  case GE.skin: g[RETURN] = ent.skinnum; return
  case GE.modelindex: g[RETURN] = ent.modelindex; return   // the LIVE index (QSS netstate.modelindex)
  case GE.effects: g[RETURN] = ent.effects; return
  case GE.frame: g[RETURN] = ent.frame; return
  case GE.colormod:
    // QSS pr_ext.c:7486-7490 (netstate.colormod/32); ours is stored 1.0-scaled, and server-parsed
    // entities carry the untinted default — NQ's wire has no colormod.
    g[RETURN] = ent.colormod[0]; g[RETURN + 1] = ent.colormod[1]; g[RETURN + 2] = ent.colormod[2];
    return
  case GE.pantscolor:
  case GE.shirtcolor: {
    // QSS pr_ext.c:7491-7516: player slots read the scoreboard colors (pants = low nibble, shirt =
    // high) through the palette at c*16+8; any other colormap value derives from itself, with QSS's
    // asymmetric nibble handling mirrored (&0x0f pants, &0xf0 shirt, +8 - sbar.c:516). Delta: our
    // .colormap indexes scores 1-based.
    const palidx = ent.colormap
    let pal: number
    if ((palidx >= 1) && (palidx <= cl.clState.maxclients) && (cl.clState.scores[palidx - 1] != null)) {
      const colors = cl.clState.scores[palidx - 1].colors
      const c = (field === GE.pantscolor) ? (colors & 15) : ((colors >> 4) & 15)
      pal = vid.d_8to24table[(c << 4) + 8]
    }
    else
      pal = vid.d_8to24table[((field === GE.pantscolor) ? (palidx & 0x0f) : (palidx & 0xf0)) + 8]
    g[RETURN] = (pal & 0xff) / 255.0
    g[RETURN + 1] = ((pal >> 8) & 0xff) / 255.0
    g[RETURN + 2] = ((pal >> 16) & 0xff) / 255.0
    return
  }
  }
  con.print('PF_getentity(,' + field + '): not implemented\n')
}

// AngleVectors on an entity's angles, with the alias-model pitch flip QSS applies. A destination
// offset of -1 discards that vector.
const entityVectors = function (ent: Entity, fwd: number, right: number, up: number) {
  const ang = vec.scratch()
  ang[0] = ent.angles[0]; ang[1] = ent.angles[1]; ang[2] = ent.angles[2]
  if (ent.model.type === mod.TYPE.alias)
    ang[0] *= -1
  const f = vec.scratch(), rt = vec.scratch(), u = vec.scratch()
  vec.angleVectors(ang, f, rt, u)
  const g = pr.state.globals_float
  if (fwd >= 0) { g[fwd] = f[0]; g[fwd + 1] = f[1]; g[fwd + 2] = f[2] }
  if (right >= 0) { g[right] = rt[0]; g[right + 1] = rt[1]; g[right + 2] = rt[2] }
  if (up >= 0) { g[up] = u[0]; g[up + 1] = u[1]; g[up + 2] = u[2] }
}

// ---- #92 getlight / #240 checkpvs / #279 touchtriggers ----

// QSS PF_sv_getlight (pr_ext.c:2576), shared by both VMs: the lightmap sample under a point, 0-1.
// QSS notes QuakeSpasm has no coloured model lighting, so all three components come back equal.
export const getlight = function () {
  const g = pr.state.globals_float
  const p = vec.scratch()
  p[0] = g[PARM0]; p[1] = g[PARM0 + 1]; p[2] = g[PARM0 + 2]
  const light = r.lightPoint(p, state.lightcache)
  g[RETURN] = light[0] / 255.0
  g[RETURN + 1] = light[1] / 255.0
  g[RETURN + 2] = light[2] / 255.0
}

// QSS PF_checkpvs (pr_ext.c:7360): is any leaf the edict touches visible from viewpos?
export const checkpvs = function () {
  const g = pr.state.globals_float
  const worldmodel = pr.state.worldmodel
  const e = pr.state.edicts[pr.state.globals_int[PARM1]]
  g[RETURN] = 0
  if ((worldmodel == null) || (e == null))
    return
  const p = vec.scratch()
  p[0] = g[PARM0]; p[1] = g[PARM0 + 1]; p[2] = g[PARM0 + 2]
  const pvs = mod.leafPVS(mod.pointInLeaf(p, worldmodel), worldmodel)
  for (var i = 0; i < e.leafnums.length; ++i) {
    if ((pvs[e.leafnums[i] >> 3] & (1 << (e.leafnums[i] & 7))) !== 0) {
      g[RETURN] = 1
      return
    }
  }
}

// QSS PF_touchtriggers (pr_ext.c:7346): relink an edict (optionally moving it first) and fire the
// triggers it now overlaps.
export const touchtriggers = function () {
  const e = (pr.state.argc > 0)
    ? pr.state.edicts[pr.state.globals_int[PARM0]]
    : pr.state.edicts[pr.state.globals_int[pr.globalvars.self]]
  if (pr.state.argc > 1) {
    const g = pr.state.globals_float
    e.v_float[pr.entvars.origin] = g[PARM1]
    e.v_float[pr.entvars.origin1] = g[PARM1 + 1]
    e.v_float[pr.entvars.origin2] = g[PARM1 + 2]
  }
  sv.linkEdict(e, true)
}

// ---- #345 getinputstate ----

// #345 getinputstate(sequence): load a logged input frame into the input_* globals, TRUE if known
// (QSS PF_cs_getinputstate, pr_ext.c:7331-7345). Delta from QSS: it answers from a 64-move log for
// its PEXT2_PREDINFO prediction; we implement neither, so only the current command frame is known
// and every other sequence returns FALSE, as QSS answers outside its log.
export const getinputstate = function () {
  const seq = pr.state.globals_float[PARM0]
  const known = (seq === cl.clState.movemessages)
  pr.state.globals_float[RETURN] = known ? 1 : 0
  if (known)
    csqc.publishInputs()
}

// ---- #343 setcursormode / getcursormode / #346 setsensitivityscaler (QSS pr_ext.c:5846-5871) ----
// None of the three is nogameaccess-gated in QSS, so simple csqc may use them.

// #343 setcursormode(usecursor, optional cursorimage, optional hotspot, optional scale): TRUE asks
// the engine to release the mouse and send absolute events, FALSE to grab it again for looking.
export const setcursormode = function () {
  const forced = pr.state.globals_float[PARM0] !== 0
  const image = (pr.state.argc > 1) ? pr.getString(pr.state.globals_int[PARM1]) : ''
  // Delta from QSS: it hands the image to SDL as a hardware cursor (VID_SetCursor,
  // gl_vidsdl.c:2446); we have no cursor-image plumbing.
  if (image !== '')
    warnOnce('setcursormode cursor images')
  csqc.state.cursorforced = forced
  input.applyCursorMode()
}

// getcursormode(optional effective). QSS answers with the requested mode either way - its
// `effective` branch is commented out (pr_ext.c:5857-5864).
export const getcursormode = function () {
  pr.state.globals_float[RETURN] = csqc.state.cursorforced ? 1 : 0
}

// #346 setsensitivityscaler(sens): a temporary multiplier for zoom, kept out of the cvar so it
// can't be saved over the player's real sensitivity. input.mouseMove consumes it.
export const setsensitivityscaler = function () {
  csqc.state.sensitivity = pr.state.globals_float[PARM0]
}
