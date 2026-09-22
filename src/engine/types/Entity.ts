import type { Model } from "./Model";
import type { V3 } from "./Vector";

// surf === 0: invalid, needs re-walk. surf === -1: walked, no lit surface hit.
// surf > 0: worldmodel.faces index + 1, ds/dt are the lightmap sample coords.
export type LightCache = {
    surf: number,
    ds: number,
    dt: number,
    pos: Float32Array
}

export type Entity = {
    alpha: number,
    scale: number,
    update_type: number,
    syncbase: number,
    num: number,
    free: boolean,
    area: any,
    leafnums: number[],
    baseline: {
      alpha: number,
      scale: number,
      origin: V3,
      angles: V3,
      modelindex: number,
      frame: number,
      colormap: number,
      skin: number,
      effects: number
    },
    freetime: number,
    v: ArrayBuffer;
    v_float: Float32Array
    v_int: Int32Array
    sendinterval?: boolean
    visframe: number
    angles: V3
    origin: V3
    model?: Model
    // Live wire model index (QSS netstate.modelindex); baseline.modelindex stays at spawn.
    modelindex: number
    frame: number
    lerpflags: number
    // LERP.explicit inputs (QSS entity_t lerp.snap, render.h): csqc addentity's explicit
    // frame2/lerpfrac/frame-times. Only read when LERP.explicit is set.
    snapFrame2: number
    snapLerpfrac: number
    snapTime1: number
    snapTime2: number
    // Per-entity render tint (QSS netstate.colormod, applied into the alias lightcolor,
    // r_alias.c:1092-1094). 1,1,1 = untinted; persistent array, reset by newTempEntity.
    colormod: V3
    // QSS entity_t eflags (protocol.h:500-501): VIEWMODEL = view-attached + depth-squashed,
    // EXTERIORMODEL = skipped by the entity walk. Reset by newTempEntity.
    eflags: number
    lerpfinish: number
    lerpstart: number       // anim lerp: cl.time when current pose transition began
    lerptime: number        // anim lerp: expected interval between poses (0.1 or framegroup spacing)
    previouspose: number    // cmdofs of the pose being blended from (-1 = none)
    currentpose: number     // cmdofs of the pose being blended to
    movelerpstart: number   // transform lerp: cl.time when origin/angles last changed
    previousorigin: V3
    currentorigin: V3
    previousangles: V3
    currentangles: V3
    skinnum: number
    effects: number
    colormap: number
    msgtime: number
    forcelink: boolean
    msg_origins: V3[]
    msg_angles: V3[]
    dlightframe: number,
    dlightbits: number[]
    lightcache: LightCache
  }