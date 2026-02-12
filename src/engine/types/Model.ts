import { GLTexture } from "../texture.js"
import { Entity } from "./Entity.js"
import { V3, V4 } from "./Vector.js"

export enum TexChain {
  world = 0,
  model
} 

export type UnloadedModel = {
  name: string
  needload: true
}

export type EFrags = {
  leafnext: EFrags | null
  entity: Entity
}

export type ClipNode = {
  planenum: number;
  children: [number, number];
}

export type PolyChain = {
  next: PolyChain | null
  verts: [...V3, number, number, number, number][]
  numverts: number
}

export type Texture = {
  name: string;
  width: number;
  height: number;
  texturenum: WebGLTexture
  texturechains: Record<TexChain, Face>;
  turbulent: boolean;
  sky: boolean;
  anims: number[]
  alternate_anims: number[]
  anim_base: number
  anim_frame: number
  warpimage?: boolean
  update_warp?: boolean
}

export type Hull = {
  firstclipnode?: number;
  lastclipnode: number;
  planes: Plane[];
  clip_mins: V3;
  clip_maxs: V3;
  clipnodes: ClipNode[]
}


export type Node = {
  num: number;
  contents: number;
  planenum?: number;
  children: [Node | Leaf, Node | Leaf];
  childrenNum?: [number, number];
  mins: V3;
  maxs: V3;
  firstface: number;
  numfaces: number;
  cmds: number[];
  plane: Plane;
  parent?: Node
  markvisframe: number
}

export type Leaf = {
  num: number;
  contents: number;
  visofs: number;
  mins: V3;
  maxs: V3;
  firstmarksurface: number;
  nummarksurfaces: number;
  ambient_level: V4;
  cmds: [],
  skychain: 0,
  waterchain: 0
  parent: Node
  efrags: EFrags
  markvisframe: number
  visframe: number
}
export type Face = {
  plane: Plane;
  side: number;
  firstedge: number;
  numedges: number;
  texinfo: number;
  styles: [number, number, number, number];
  lightofs: number;
  mins: V3;
  maxs: V3;
  dlightbits: number[];
  cached_light: number[];
  texture: number;
  flags: number;
  sky: boolean;
  turbulent: boolean;
  texturemins: [number, number]
  extents: [number, number];
  polys: PolyChain
  light_t: number
  light_s: number
  dlightframe: number
  texturechain: Face
  culled?: boolean
  lightmaptexturenum: number
  visframe: number,
  vbo_firstvert: number,
  cached_dlight: boolean
}

export type NodeLeaf = Node | Leaf
export type Edge = [number, number]

export type Plane = {
  normal: V3;
  dist: number;
  type: number;
  signbits: number
}

export type TexInfo = {
  vecs: [V4, V4]
  texture: number;
  flags: number;
}


export type Skin = {
  group: false;
  texturenum: GLTexture
  playertexture: WebGLTexture
  interval: number
}

export type SkinGroup = {
  group: true,
  skins?: Skin[]
}

export type FrameVert = {
  lightnormalindex: number
  v: V3
}

export type AliasFrameGroup = {
  type: 'alias'
  group: true,
  bboxmin: V3,
  bboxmax: V3,
  frames: AliasFrame[]
}

export type AliasFrame = {
  type: 'alias'
  group: false,
  name: string
  numposes: number,
  bboxmin: V3,
  bboxmax: V3,
  interval: number,
  v: FrameVert[],
  cmdofs: number
  // Sprite?
}

export type SpriteFrame = {
  type: 'sprite'
  group: false,
  origin: [number, number]
  width: number
  height: number
  texturenum: WebGLTexture
  interval: number,
}
export type SpriteFrameGroup = {
  type: 'sprite'
  group: true,
  frames: SpriteFrame[]
}

export type Frame = AliasFrame | AliasFrameGroup | SpriteFrame | SpriteFrameGroup

export type StVert = {
  onseam: boolean,
  s: number;
  t: number
}
export type Triangle = {
  facesfront: boolean;
  vertindex: V3
}
export type Model = {
  name: string
  type: number;
  player: boolean;
  firstface: number
  numfaces: number;
  cmds: WebGLBuffer;

  submodels: Model[];
  visleafs: number;
  numleafs: number;
  mins: V3;
  maxs: V3;
  hulls: Hull[];
  textures: Texture[];
  lightdata: Uint8Array;
  visdata: Uint8Array;
  entities: string;
  planes: Plane[];
  nodes: Node[];
  clipnodes: ClipNode[]
  leafs: Leaf[]
  edges: Edge[]
  texinfo: TexInfo[]
  faces: Face[]
  surfedges: number[]
  marksurfaces: number[]
  skinwidth: number
  skinheight: number
  radius: number
  scale: V3;
  scale_origin: V3;
  boundingradius: number;
  oriented: boolean
  width: number
  height: number

  numtris: number
  triangles: Triangle[]

  random: boolean
  flags: number

  numskins: number;
  skins: (Skin | SkinGroup)[]

  numframes: number;
  frames: Frame[]

  numverts: number;
  vertexes: V3[];

  stverts: StVert[]
  submodel: boolean
  origin: V3
}
