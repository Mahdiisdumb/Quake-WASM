import * as con from './console'
import * as sys from './sys'
import * as GL from './GL'
import * as tx from './texture'
import * as image from './image'
import { getRenderer } from './render'
import { Model, AliasFrame, Md3Surface } from './types'
import { V3 } from './types/Vector'
import { GLTexture } from './texture'

// ---- glTF-binary (.glb) static model loading -----------------------------------------
// Converts the bind pose of a glTF 2.0 scene into the layout mod.ts's md3 path produces -- a
// non-indexed triangle soup in a shared `cmds` array plus one Md3Surface per primitive -- so the
// alias renderer draws it unchanged. Conventions mirror FTE's plugins/models/gltf.c.
//
// SKIPPED (deliberately, this is a static-prop importer): skins/joints/inverse bind matrices,
// animations and morph targets, sparse accessors, draco, and every PBR channel except
// baseColorTexture. A skinned or animated .glb renders as its bind pose, undeformed.

// FTE mod_gltf_scale, default 30: "the number of units per metre, in order to correctly
// load standard-scale gltf models" (gltf.c:3569).
const SCALE = 30;

const COMPONENT_SIZE: { [k: number]: number } = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_COMPONENTS: { [k: string]: number } = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// One glTF primitive unrolled into the soup. Positions/normals are already in quake space.
type GLBPrimitive = {
  name: string
  corners: Uint32Array
  pos: Float32Array
  norm: Float32Array
  st: Float32Array
  material: number
  first: number
};

// Column-major 4x4, matching glTF's own `node.matrix` element order.
const matIdentity = function(): Float64Array {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
};

// out = a * b (b applied first). Distinct from a and b.
const matMultiply = function(a: Float64Array, b: Float64Array, out: Float64Array): Float64Array {
  for (var c = 0; c < 4; c++)
    for (var r = 0; r < 4; r++)
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
};

// glTF node TRS composes as T * R * S (spec 3.4.2, same order as FTE's
// GenMatrixPosQuat4ScaleDouble, gltf.c:2457).
const matFromTRS = function(t: number[], q: number[], s: number[]): Float64Array {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * s[0]; m[1] = (2 * (x * y + z * w)) * s[0]; m[2] = (2 * (x * z - y * w)) * s[0];
  m[4] = (2 * (x * y - z * w)) * s[1]; m[5] = (1 - 2 * (x * x + z * z)) * s[1]; m[6] = (2 * (y * z + x * w)) * s[1];
  m[8] = (2 * (x * z + y * w)) * s[2]; m[9] = (2 * (y * z - x * w)) * s[2]; m[10] = (1 - 2 * (x * x + y * y)) * s[2];
  m[12] = t[0]; m[13] = t[1]; m[14] = t[2]; m[15] = 1;
  return m;
};

// FTE mod_gltf_standardorientation, default 1 (gltf.c:3231-3235): y-up glTF -> z-up quake, i.e.
// quake = (gltf.z, gltf.x, gltf.y) * SCALE. Same permutation, in glTF's column-major order.
const gltfRootMatrix = function(): Float64Array {
  const m = new Float64Array(16);
  m[1] = SCALE;  // gltf x -> quake y
  m[6] = SCALE;  // gltf y -> quake z
  m[8] = SCALE;  // gltf z -> quake x
  m[15] = 1;
  return m;
};

const jsonAt = function(arr: any, idx: any): any {
  if (arr == null || typeof idx !== 'number') return null;
  return arr[idx] ?? null;
};

// Accessor -> float array of `comps` components per element, widening/normalising integer
// component types the way FTE's GLTF_AccessorToDataF does. Honours bufferView.byteStride.
// Sparse accessors are not supported (see the skipped list above).
const readAccessorF = function(json: any, bin: DataView, idx: any, comps: number, name: string): Float32Array | null {
  const acc = jsonAt(json.accessors, idx);
  if (acc == null) return null;
  if (acc.sparse != null) {
    con.dPrint('Mod.LoadGLB: ' + name + ': sparse accessors unsupported\n');
    return null;
  }
  const srcComps = TYPE_COMPONENTS[acc.type];
  const csize = COMPONENT_SIZE[acc.componentType];
  if (srcComps == null || csize == null) return null;
  const bv = jsonAt(json.bufferViews, acc.bufferView);
  if (bv == null || (bv.buffer ?? 0) !== 0) return null;
  const stride = bv.byteStride || (csize * srcComps);
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const count = acc.count | 0;
  if (base + (count - 1) * stride + csize * srcComps > bin.byteLength) {
    con.dPrint('Mod.LoadGLB: ' + name + ': accessor overruns the BIN chunk\n');
    return null;
  }
  const out = new Float32Array(count * comps);
  const n = Math.min(comps, srcComps);
  for (var i = 0; i < count; i++) {
    const o = base + i * stride;
    for (var c = 0; c < n; c++) {
      const co = o + c * csize;
      var v: number;
      switch (acc.componentType) {
      case 5126: v = bin.getFloat32(co, true); break;
      case 5121: v = acc.normalized === false ? bin.getUint8(co) : bin.getUint8(co) / 255; break;
      case 5123: v = acc.normalized === false ? bin.getUint16(co, true) : bin.getUint16(co, true) / 65535; break;
      case 5120: v = acc.normalized === false ? bin.getInt8(co) : Math.max(bin.getInt8(co) / 127, -1); break;
      case 5122: v = acc.normalized === false ? bin.getInt16(co, true) : Math.max(bin.getInt16(co, true) / 32767, -1); break;
      default: v = 0;
      }
      out[i * comps + c] = v;
    }
  }
  return out;
};

// Index accessor -> uint32. componentType 5121/5123/5125 per FTE gltf.c:2253-2270.
const readIndices = function(json: any, bin: DataView, idx: any, vertCount: number, name: string): Uint32Array | null {
  const acc = jsonAt(json.accessors, idx);
  if (acc == null) {
    // no indices -> the primitive is already a soup, in accessor order (glTF spec 3.7.2)
    const seq = new Uint32Array(vertCount);
    for (var k = 0; k < vertCount; k++) seq[k] = k;
    return seq;
  }
  const csize = COMPONENT_SIZE[acc.componentType];
  if (csize == null || acc.type !== 'SCALAR') return null;
  const bv = jsonAt(json.bufferViews, acc.bufferView);
  if (bv == null || (bv.buffer ?? 0) !== 0) return null;
  const stride = bv.byteStride || csize;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const count = acc.count | 0;
  if (base + (count - 1) * stride + csize > bin.byteLength) {
    con.dPrint('Mod.LoadGLB: ' + name + ': index accessor overruns the BIN chunk\n');
    return null;
  }
  const out = new Uint32Array(count);
  for (var i = 0; i < count; i++) {
    const o = base + i * stride;
    switch (acc.componentType) {
    case 5121: out[i] = bin.getUint8(o); break;
    case 5123: out[i] = bin.getUint16(o, true); break;
    case 5125: out[i] = bin.getUint32(o, true); break;
    default: return null;
    }
  }
  return out;
};

// Bakes one primitive into quake space under `world`, unrolling its indices. FTE reverses
// the triangle winding on import ("swap winding order. we cull wrongly." gltf.c:2283-2289);
// mirrored here since our alias draws run with CULL_FACE enabled.
const loadPrimitive = function(json: any, bin: DataView, prim: any, meshName: string, world: Float64Array,
                               name: string): GLBPrimitive | null {
  if ((prim.mode ?? 4) !== 4) {
    con.dPrint('Mod.LoadGLB: ' + name + ': primitive mode ' + prim.mode + ' is not TRIANGLES, skipped\n');
    return null;
  }
  const attr = prim.attributes;
  if (attr == null) return null;
  const pos = readAccessorF(json, bin, attr.POSITION, 3, name);
  if (pos == null || pos.length === 0) return null;
  const verts = pos.length / 3;
  const st = readAccessorF(json, bin, attr.TEXCOORD_0, 2, name) ?? new Float32Array(verts * 2);
  const norm = readAccessorF(json, bin, attr.NORMAL, 3, name);

  const idx = readIndices(json, bin, prim.indices, verts, name);
  if (idx == null) return null;
  const tris = (idx.length / 3) | 0;
  const corners = new Uint32Array(tris * 3);
  for (var t = 0; t < tris; t++) {
    const a = idx[t * 3], b = idx[t * 3 + 1], c = idx[t * 3 + 2];
    if (a >= verts || b >= verts || c >= verts) {
      con.dPrint('Mod.LoadGLB: ' + name + ': index list exceeds vertex count range\n');
      return null;
    }
    corners[t * 3] = a; corners[t * 3 + 1] = c; corners[t * 3 + 2] = b;
  }

  // positions through the full node chain; normals through its 3x3 then renormalised -- the
  // inverse-transpose only differs under non-uniform scale (FTE TransformDirArray does the same)
  const qpos = new Float32Array(verts * 3);
  const qnorm = new Float32Array(verts * 3);
  for (var v = 0; v < verts; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    qpos[v * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
    qpos[v * 3 + 1] = world[1] * x + world[5] * y + world[9] * z + world[13];
    qpos[v * 3 + 2] = world[2] * x + world[6] * y + world[10] * z + world[14];
    if (norm != null) {
      const nx = norm[v * 3], ny = norm[v * 3 + 1], nz = norm[v * 3 + 2];
      var ox = world[0] * nx + world[4] * ny + world[8] * nz;
      var oy = world[1] * nx + world[5] * ny + world[9] * nz;
      var oz = world[2] * nx + world[6] * ny + world[10] * nz;
      const len = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (len > 0) { ox /= len; oy /= len; oz /= len; } else oz = 1;
      qnorm[v * 3] = ox; qnorm[v * 3 + 1] = oy; qnorm[v * 3 + 2] = oz;
    }
  }
  // no NORMAL attribute: glTF says shade flat, so give each corner its own face normal
  if (norm == null) {
    for (var ft = 0; ft < tris; ft++) {
      const i0 = corners[ft * 3], i1 = corners[ft * 3 + 1], i2 = corners[ft * 3 + 2];
      const ax = qpos[i1 * 3] - qpos[i0 * 3], ay = qpos[i1 * 3 + 1] - qpos[i0 * 3 + 1], az = qpos[i1 * 3 + 2] - qpos[i0 * 3 + 2];
      const bx = qpos[i2 * 3] - qpos[i0 * 3], by = qpos[i2 * 3 + 1] - qpos[i0 * 3 + 1], bz = qpos[i2 * 3 + 2] - qpos[i0 * 3 + 2];
      var fx = ay * bz - az * by, fy = az * bx - ax * bz, fz = ax * by - ay * bx;
      const flen = Math.sqrt(fx * fx + fy * fy + fz * fz);
      if (flen > 0) { fx /= flen; fy /= flen; fz /= flen; } else fz = 1;
      // written per shared vertex; last triangle wins, which is the usual unwelded case
      qnorm[i0 * 3] = qnorm[i1 * 3] = qnorm[i2 * 3] = fx;
      qnorm[i0 * 3 + 1] = qnorm[i1 * 3 + 1] = qnorm[i2 * 3 + 1] = fy;
      qnorm[i0 * 3 + 2] = qnorm[i1 * 3 + 2] = qnorm[i2 * 3 + 2] = fz;
    }
  }

  return { name: meshName, corners, pos: qpos, norm: qnorm, st, material: prim.material ?? -1, first: 0 };
};

// Depth-first scene walk composing node TRS/matrix down the chain (FTE GLTF_ProcessNode,
// gltf.c:2500-2700). Guards against the cyclic node graphs malformed files can carry.
const walkNode = function(json: any, bin: DataView, nodeIdx: any, parent: Float64Array, out: GLBPrimitive[],
                          seen: boolean[], name: string) {
  const node = jsonAt(json.nodes, nodeIdx);
  if (node == null || seen[nodeIdx]) return;
  seen[nodeIdx] = true;

  var local: Float64Array;
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    local = new Float64Array(16);
    for (var i = 0; i < 16; i++) local[i] = node.matrix[i];
  } else {
    const q = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    const t = node.translation ?? [0, 0, 0];
    local = matFromTRS(t, q, s);
  }
  const world = matMultiply(parent, local, new Float64Array(16));

  if (node.skin != null)
    con.dPrint('Mod.LoadGLB: ' + name + ': skinned node, loading its bind pose only\n');

  const mesh = jsonAt(json.meshes, node.mesh);
  if (mesh != null && Array.isArray(mesh.primitives)) {
    for (var p = 0; p < mesh.primitives.length; p++) {
      const built = loadPrimitive(json, bin, mesh.primitives[p],
        (mesh.name || 'mesh') + (mesh.primitives.length > 1 ? '_' + p : ''), world, name);
      if (built != null) out.push(built);
    }
  }

  if (Array.isArray(node.children))
    for (var c = 0; c < node.children.length; c++)
      walkNode(json, bin, node.children[c], world, out, seen, name);
};

// 16x16 grey checkerboard shown until a baseColorTexture decodes, and left in place when the
// material has none -- same fallback the md3 path uses.
const glbPlaceholderSkin = function(model: Model): GLTexture {
  const px = new Uint8Array(16 * 16 * 4);
  for (var y = 0; y < 16; y++)
    for (var x = 0; x < 16; x++) {
      const v = (((x >> 2) ^ (y >> 2)) & 1) ? 128 : 64;
      const o = (y * 16 + x) * 4;
      px[o] = px[o + 1] = px[o + 2] = v; px[o + 3] = 255;
    }
  return tx.loadRGBATexture(model, '__md3_notexture', 16, 16, px);
};

// glTF images are PNG/JPEG bytes in a bufferView and browser decode is async, so resolve off the
// critical path and swap the surface skin in when it arrives (md3 skin behaviour). A material with
// no baseColorTexture keeps the placeholder.
const resolveGLBSkin = async function(model: Model, surface: Md3Surface, json: any, buffer: ArrayBuffer,
                                      binOfs: number, material: any) {
  const mat = jsonAt(json.materials, material);
  const texIdx = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  const tex = jsonAt(json.textures, texIdx);
  if (tex == null) return;
  const imgIdx = tex.source;
  const img = jsonAt(json.images, imgIdx);
  if (img == null) return;
  if (img.uri != null) {
    // external/data-uri images aren't produced by the .glb exporters we target
    con.dPrint('Mod.LoadGLB: ' + model.name + ': image uri unsupported\n');
    return;
  }
  const bv = jsonAt(json.bufferViews, img.bufferView);
  if (bv == null || (bv.buffer ?? 0) !== 0) return;
  const bytes = buffer.slice(binOfs + (bv.byteOffset || 0), binOfs + (bv.byteOffset || 0) + bv.byteLength);
  const raster = await image.decodeRaster(bytes);
  if (raster == null) {
    con.dPrint('Mod.LoadGLB: ' + model.name + ': failed to decode image ' + imgIdx + '\n');
    return;
  }
  surface.skins[0] = tx.loadRGBATexture(model, model.name + ':img' + imgIdx, raster.width, raster.height, raster.data);
};

export const loadGLBModel = function(model: Model, buffer: ArrayBuffer) {
  model.player = false;
  const view = new DataView(buffer);

  // GLB container: 12-byte header then length-prefixed chunks (glTF 2.0 spec 4.4)
  if (view.getUint32(4, true) !== 2)
    sys.error(model.name + ' has wrong glb version number (' + view.getUint32(4, true) + ' should be 2)');
  var jsonOfs = -1, jsonLen = 0, binOfs = -1, binLen = 0;
  var o = 12;
  while (o + 8 <= buffer.byteLength) {
    const clen = view.getUint32(o, true);
    const ctype = view.getUint32(o + 4, true);
    if (o + 8 + clen > buffer.byteLength) break;
    if (ctype === 0x4E4F534A && jsonOfs < 0) { jsonOfs = o + 8; jsonLen = clen; }        // 'JSON'
    else if (ctype === 0x004E4942 && binOfs < 0) { binOfs = o + 8; binLen = clen; }      // 'BIN\0'
    o += 8 + clen;
  }
  if (jsonOfs < 0)
    sys.error('model ' + model.name + ' has no glb JSON chunk');
  if (binOfs < 0) { binOfs = 0; binLen = 0; }

  var json: any;
  try {
    // the JSON chunk is space-padded to 4 bytes, but trailing NULs turn up in the wild too
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, jsonOfs, jsonLen)).replace(/\0+$/, ''));
  } catch (e) {
    sys.error('model ' + model.name + ' has a corrupt glb JSON chunk');
    return;
  }
  const bin = new DataView(buffer, binOfs, binLen);

  // default scene, else scene 0, else every node as a root (glTF spec 3.3)
  const scene = jsonAt(json.scenes, json.scene ?? 0);
  const roots: any[] = Array.isArray(scene?.nodes) ? scene.nodes
    : (Array.isArray(json.nodes) ? json.nodes.map((_: any, i: number) => i) : []);

  const root = matMultiply(gltfRootMatrix(), matIdentity(), new Float64Array(16));
  const prims: GLBPrimitive[] = [];
  const seen: boolean[] = [];
  for (var ri = 0; ri < roots.length; ri++)
    walkNode(json, bin, roots[ri], root, prims, seen, model.name);

  if (prims.length === 0)
    sys.error('model ' + model.name + ' has no triangles');

  // --- build the shared cmds buffer: all texcoords first, then the single pose block ---
  var unrolled = 0;
  for (var pi = 0; pi < prims.length; pi++) {
    prims[pi].first = unrolled;
    unrolled += prims[pi].corners.length;
  }

  const cmds: number[] = [];
  for (var si = 0; si < prims.length; si++) {
    const su = prims[si];
    for (var c = 0; c < su.corners.length; c++) {
      const vi = su.corners[c];
      cmds.push(su.st[vi * 2], su.st[vi * 2 + 1]);
    }
  }

  const mins: V3 = [Infinity, Infinity, Infinity];
  const maxs: V3 = [-Infinity, -Infinity, -Infinity];
  var radiusSq = 0;
  const frame: AliasFrame = {
    type: 'alias', group: false, numposes: 1, name: 'bindpose', interval: 0.1,
    bboxmin: [0, 0, 0], bboxmax: [0, 0, 0], v: [], cmdofs: cmds.length << 2
  };
  for (var s2 = 0; s2 < prims.length; s2++) {
    const su2 = prims[s2];
    for (var cc = 0; cc < su2.corners.length; cc++) {
      const vi2 = su2.corners[cc];
      const x = su2.pos[vi2 * 3], y = su2.pos[vi2 * 3 + 1], z = su2.pos[vi2 * 3 + 2];
      cmds.push(x, y, z, su2.norm[vi2 * 3], su2.norm[vi2 * 3 + 1], su2.norm[vi2 * 3 + 2]);
      if (x < mins[0]) mins[0] = x; if (x > maxs[0]) maxs[0] = x;
      if (y < mins[1]) mins[1] = y; if (y > maxs[1]) maxs[1] = y;
      if (z < mins[2]) mins[2] = z; if (z > maxs[2]) maxs[2] = z;
      const d = x * x + y * y + z * z;
      if (d > radiusSq) radiusSq = d;
    }
  }
  frame.bboxmin = [mins[0], mins[1], mins[2]];
  frame.bboxmax = [maxs[0], maxs[1], maxs[2]];
  model.frames = [frame];

  model.numframes = 1;
  model.numtris = unrolled / 3;
  model.numverts = unrolled;
  model.random = false;
  model.flags = 0;
  model.mins = mins;
  model.maxs = maxs;
  model.boundingradius = Math.sqrt(radiusSq);
  model.nolerp = false; // one pose: setupAliasFrame blends it against itself anyway

  // --- skins + GPU upload (GL only; the dedicated server needs neither) ---
  model.skins = [];
  model.numskins = 0;
  const gl = GL.getContext();
  if (gl) {
    const placeholder = glbPlaceholderSkin(model);
    const outSurfaces: Md3Surface[] = [];
    for (var s3 = 0; s3 < prims.length; s3++) {
      const su3 = prims[s3];
      const surface: Md3Surface = { name: su3.name, first: su3.first, count: su3.corners.length, skins: [placeholder] };
      resolveGLBSkin(model, surface, json, buffer, binOfs, su3.material);
      outSurfaces.push(surface);
    }
    model.numskins = 1;
    model.surfaces = outSurfaces;

    const cmdsArray = new Float32Array(cmds);
    model.cmds = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, model.cmds);
    gl.bufferData(gl.ARRAY_BUFFER, cmdsArray, gl.STATIC_DRAW);
    // WebGPU backend uploads its own alias VBO keyed by this array's identity (as md3 does)
    if (getRenderer().backend === 'webgpu')
      model.cmdsData = cmdsArray;
  }
};
