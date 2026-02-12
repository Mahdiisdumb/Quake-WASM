import { V3 } from "./Vector.js";

export type Edict = {
    alpha: number,
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
  }