import type { Leaf, Model } from "./Model";
import type { V3 } from "./Vector";

export type Entity = {
    alpha: number,
    update_type: number,
    syncbase: number,
    num: number,
    free: boolean,
    area: any,
    leafnums: number[],
    baseline: {
      alpha: number,
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
    frame: number
    lerpflags: number
    lerpfinish: number
    skinnum: number
    effects: number
    colormap: number
    msgtime: number
    forcelink: boolean
    msg_origins: V3[]
    msg_angles: V3[]
    dlightframe: number,
    dlightbits: number[]
    topnode: Leaf | Node
  }