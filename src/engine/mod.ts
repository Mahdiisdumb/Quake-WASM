import * as sys from './sys'
import * as con from './console'
import * as com from './com'
import * as vid from './vid'
import * as r from './r'
import * as GL from './GL'
import * as q from './q'
import * as vec from './vec'
import * as host from './host'
import * as def from './def'
import * as tx from './texture'
import { V3 } from './types/Vector'
import { Leaf, Model, NodeLeaf, UnloadedModel, Node, Face, Texture, TexInfo, ClipNode, Plane, Skin, SkinGroup, Frame, SpriteFrame, AliasFrame, AliasFrameGroup, SpriteFrameGroup, TexChain } from './types'
import { GLTexture } from './texture'

export const EFFECTS = {
  brightfield: 1,
  muzzleflash: 2,
  brightlight: 4,
  dimlight: 8
};

export const TYPE = {
  brush: 0,
  sprite: 1,
  alias: 2
};

export const FLAGS = {
  rocket: 1,
  grenade: 2,
  gib: 4,
  rotate: 8,
  tracer: 16,
  zomgib: 32,
  tracer2: 64,
  tracer3: 128
};

export const VERSION = {
  'bsp2': (('B'.charCodeAt(0) << 0)  | ('S'.charCodeAt(0) << 8)  | ('P'.charCodeAt(0) << 16) | ('2'.charCodeAt(0) << 24)),
  '2psb': (('B'.charCodeAt(0) << 24) | ('S'.charCodeAt(0) << 16) | ('P'.charCodeAt(0) << 8)  | '2'.charCodeAt(0)),
  brush: 29,
  sprite: 1,
  alias: 6
};



let known: any = [];

//
var loadmodel: Model = null

export const novis = new Uint8Array(0)
var filledcolor = 0

export const init = function()
{
  filledcolor = 0
  loadmodel = null
  known = []
  var i;
  for (i = 0; i < 1024; ++i)
    novis[i] = 0xff;

  for (i = 0; i <= 255; ++i)
  {
    if (vid.d_8to24table[i] === 0)
    {
      filledcolor = i;
      break;
    }
  }
};

// export const pointInLeaf = function(p, model: Model)
// {
//   if (model == null)
//     sys.error('Mod.PointInLeaf: bad model');
//   if (model.nodes == null)
//     sys.error('Mod.PointInLeaf: bad model');
//   var node = model.nodes[0];
//   var normal;
//   var plane;
//   for (;;)
//   {
//     if (node.contents < 0) {
//       return node;
//     }
//     plane = model.planes[node.planenum]
//     normal = plane.normal;
//     if ((p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2] - plane.dist) > 0)
//       node = model.nodes[node.children[0]];
//     else
//       node = model.nodes[node.children[1]];
//   }
// };
export const pointInLeaf = function(p: V3, model: Model) : Leaf
{
  if (model == null)
    sys.error('Mod.PointInLeaf: bad model');
  if (model.nodes == null)
    sys.error('Mod.PointInLeaf: bad model');
  var node: Node | Leaf = model.nodes[0];
  var normal: V3;
  for (;;)
  {
    if (node.contents < 0)
      return node as Leaf;
    
    const _node = node as Node
    normal = _node.plane.normal;
    if ((p[0] * normal[0] + p[1] * normal[1] + p[2] * normal[2] - _node.plane.dist) > 0)
      node = _node.children[0];
    else
      node = _node.children[1];
  }
};

// TODO: Joe - is this array size correct?s
export const decompressVis = function(i: number, model: Model)
{
  var decompressed = new Uint8Array((model.leafs.length + 7) >> 3), 
    c: number,
    out = 0, 
    row = (model.leafs.length + 7) >> 3;
  if (model.visdata == null)
  {
    for (; row >= 0; --row)
      decompressed[out++] = 0xff;
    return decompressed;
  }
  for (out = 0; out < row; )
  {
    if (model.visdata[i] !== 0)
    {
      decompressed[out++] = model.visdata[i++];
      continue;
    }
    for (c = model.visdata[i + 1]; c > 0; --c)
      decompressed[out++] = 0;
    i += 2;
  }
  return decompressed;
};

export const calcSurfaceBounds = (model: Model, surf: Face) => {
	// int			i, e;
	// mvertex_t	*v;

	surf.mins[0] = surf.mins[1] = surf.mins[2] = 9999;
	surf.maxs[0] = surf.maxs[1] = surf.maxs[2] = -9999;

	for (var i = 0 ; i < surf.numedges ; i++)
	{
		var v, e = model.surfedges[surf.firstedge + i];
		if (e >= 0)
			v = model.vertexes[model.edges[e][0]];
		else
			v = model.vertexes[model.edges[-e][1]];

		if (surf.mins[0] > v[0])
			surf.mins[0] = v[0];
		if (surf.mins[1] > v[1])
			surf.mins[1] = v[1];
		if (surf.mins[2] > v[2])
			surf.mins[2] = v[2];

		if (surf.maxs[0] < v[0])
			surf.maxs[0] = v[0];
		if (surf.maxs[1] < v[1])
			surf.maxs[1] = v[1];
		if (surf.maxs[2] < v[2])
			surf.maxs[2] = v[2];
	}
}

const polyForUnlitSurface = (loadmodel: Model, fa: Face) => {
  var texscale, _vec;
  
	if (fa.flags & (def.SURF.drawtub | def.SURF.drawsky))
		texscale = (1.0/128.0); //warp animation repeats every 128
	else
		texscale = (1.0/32.0); //to match r_notexture_mip

  fa.polys = {
    next: null,
    numverts: fa.numedges,
    verts: []
  }
  const texinfo = loadmodel.texinfo[fa.texinfo]
	// convert edges back to a normal polygon
	for (var i = 0 ; i < fa.numedges; i++)
	{
		var lindex = loadmodel.surfedges[fa.firstedge + i];

		if (lindex > 0)
			_vec = loadmodel.vertexes[loadmodel.edges[lindex][0]];
		else
      _vec = loadmodel.vertexes[loadmodel.edges[-lindex][1]];

    fa.polys.verts[i] = [0,0,0,0,0,0, 0]
    // @ts-ignore
    vec.copy (_vec, fa.polys.verts[i]);
    
		fa.polys.verts[i][3] = vec.dotProductV3(_vec, texinfo.vecs[0]) * texscale;
		fa.polys.verts[i][4] = vec.dotProductV3(_vec, texinfo.vecs[1]) * texscale;
  }
}

export const leafPVS = function(leaf: Leaf, model: Model)
{
  if (leaf === model.leafs[0])
    return novis;
  return decompressVis(leaf.visofs, model);
};

export const clearAll = function()
{
  var i, mod 
  for (i = 0; i < known.length; ++i)
  {
    mod = known[i];
    if (mod.type !== TYPE.brush)
      continue;
    tx.freeTextureForOwner(mod)
    known[i] = {
      name: mod.name,
      needload: true
    };
  }
};

export const findName = function(name: string)
{
  if (name.length === 0)
    sys.error('Mod.FindName: NULL name');
  var i;
  for (i = 0; i < known.length; ++i)
  {
    if (known[i] == null)
      continue;
    if (known[i].name === name)
      return known[i];
  }
  for (i = 0; i <= known.length; ++i)
  {
    if (known[i] != null)
      continue;
    known[i] = {name: name, needload: true};
    return known[i];
  }
};

export const loadModel = async function(mod: UnloadedModel | Model, crash: boolean)
{
  if (!('needload' in mod))
    return mod;
  const unloadedModel = mod as UnloadedModel
  var buf = await com.loadFile(mod.name);
  if (buf == null)
  {
    if (crash === true)
      sys.error('Mod.LoadModel: ' + mod.name + ' not found');
    return;
  }
  loadmodel = mod as unknown as Model;
  delete mod.needload

  switch ((new DataView(buf)).getUint32(0, true))
  {
  case 0x4f504449:
    loadAliasModel(buf);
    break;
  case 0x50534449:
    loadSpriteModel(buf);
    break;
  default:
    await loadBrushModel(buf);
  }
  return loadmodel;
};

export const forName = async function(name: string, crash = false)
{
  return await loadModel(findName(name), crash);
};

/*
===============================================================================

          BRUSHMODEL LOADING

===============================================================================
*/

const LUMP =
{
  entities: 0,
  planes: 1,
  textures: 2,
  vertexes: 3,
  visibility: 4,
  nodes: 5,
  texinfo: 6,
  faces: 7,
  lighting: 8,
  clipnodes: 9,
  leafs: 10,
  marksurfaces: 11,
  edges: 12,
  surfedges: 13,
  models: 14
};

export const CONTENTS = {
  empty: -1,
  solid: -2,
  water: -3,
  slime: -4,
  lava: -5,
  sky: -6,
  origin: -7,
  clip: -8,
  current_0: -9,
  current_90: -10,
  current_180: -11,
  current_270: -12,
  current_up: -13,
  current_down: -14
};

export const loadTextures = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.textures << 3) + 4, true);
  var filelen = view.getUint32((LUMP.textures << 3) + 8, true);
  loadmodel.textures = [];
  var nummiptex = view.getUint32(fileofs, true);
  var dataofs = fileofs + 4;
  var i, miptexofs, texture: Texture, glt;
  for (i = 0; i < nummiptex; ++i)
  {
    miptexofs = view.getInt32(dataofs, true);
    dataofs += 4;
    if (miptexofs === -1)
    {
      loadmodel.textures[i] = r.state.notexture_mip;
      continue;
    }
    miptexofs += fileofs;
    texture =
    {
      name: q.memstr(new Uint8Array(buf, miptexofs, 16)),
      width: view.getUint32(miptexofs + 16, true),
      height: view.getUint32(miptexofs + 20, true),
      texturechains: {[TexChain.world]: null, [TexChain.model]: null},
    } as Texture
    if (texture.name.substring(0, 3).toLowerCase() === 'sky')
    {
      r.initSky(new Uint8Array(buf, miptexofs + view.getUint32(miptexofs + 24, true), 32768));
      texture.texturenum = r.state.solidskytexture;
      r.state.skytexturenum = i;
      texture.sky = true;
    }
    else
    {
      if (GL.getContext()) {
        let data = null
        if (texture.height === 0 || texture.width === 0) {
          data = new Uint8Array()
        } else {
          data = new Uint8Array(buf, miptexofs + view.getUint32(miptexofs + 24, true), texture.width * texture.height)
        }
        glt = tx.loadTexture(loadmodel, texture.name, texture.width, texture.height, data);
        texture.texturenum = glt.texnum;
      }
      if (texture.name.charCodeAt(0) === 42)
        texture.turbulent = true;
    }
    loadmodel.textures[i] = texture;
  }

  var j, texture2, num, name;
  for (i = 0; i < nummiptex; ++i)
  {
    texture = loadmodel.textures[i];
    if (texture.name.charCodeAt(0) !== 43)
      continue;
    if (texture.name.charCodeAt(1) !== 48)
      continue;
    name = texture.name.substring(2);
    texture.anims = [i];
    texture.alternate_anims = [];
    for (j = 0; j < nummiptex; ++j)
    {
      texture2 = loadmodel.textures[j];
      if (texture2.name.charCodeAt(0) !== 43)
        continue;
      if (texture2.name.substring(2) !== name)
        continue;
      num = texture2.name.charCodeAt(1);
      if (num === 48)
        continue;
      if ((num >= 49) && (num <= 57))
      {
        texture.anims[num - 48] = j;
        texture2.anim_base = i;
        texture2.anim_frame = num - 48;
        continue;
      }
      if (num >= 97)
        num -= 32;
      if ((num >= 65) && (num <= 74))
      {
        texture.alternate_anims[num - 65] = j;
        texture2.anim_base = i;
        texture2.anim_frame = num - 65;
        continue;
      }
      sys.error('Bad animating texture ' + texture.name);
    }
    for (j = 0; j < texture.anims.length; ++j)
    {
      if (texture.anims[j] == null)
        sys.error('Missing frame ' + j + ' of ' + texture.name);
    }
    for (j = 0; j < texture.alternate_anims.length; ++j)
    {
      if (texture.alternate_anims[j] == null)
        sys.error('Missing frame ' + j + ' of ' + texture.name);
    }
    loadmodel.textures[i] = texture;
  }

  loadmodel.textures[loadmodel.textures.length] = r.state.notexture_mip;
};


export const loadLighting = async function(buf: ArrayBuffer)
{
  let i = 0, j = 0
  const litFileName = com.removeExtension(loadmodel.name) + '.lit'
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.lighting << 3) + 4, true);
  var filelen = view.getUint32((LUMP.lighting << 3) + 8, true);
  var litFile = await com.loadFile(litFileName);
  if (litFile) {
			i = com.state.littleLong((new DataView(litFile).getUint8(4)))
			if (i == 1)
			{
				if (8+filelen*3 == litFile.byteLength)
				{
					con.dPrint(`${litFileName} loaded\n`);
          loadmodel.lightdata = new Uint8Array(new ArrayBuffer(filelen*3));
          loadmodel.lightdata.set(new Uint8Array(litFile, 8, filelen*3));
					return;
				}
				con.print(`Outdated .lit file (${litFileName} should be ${8+filelen*3} bytes, not ${litFile.byteLength})\n`)
			}
			else
			{
				con.print(`Unknown .lit file version (${i})\n`);
			}
  } else {
    if (filelen === 0)
      return;
    loadmodel.lightdata = new Uint8Array(new ArrayBuffer(filelen * 3));
    const lightData = new Uint8Array(buf, fileofs, filelen)
    for (i = 0,  j = 0; i < filelen; i++) {
      loadmodel.lightdata[j++] = lightData[i]
      loadmodel.lightdata[j++] = lightData[i]
      loadmodel.lightdata[j++] = lightData[i]
    }
  }
};

export const loadVisibility = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.visibility << 3) + 4, true);
  var filelen = view.getUint32((LUMP.visibility << 3) + 8, true);
  if (filelen === 0)
    return;
  loadmodel.visdata = new Uint8Array(new ArrayBuffer(filelen));
  loadmodel.visdata.set(new Uint8Array(buf, fileofs, filelen));
};

export const loadEntities = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.entities << 3) + 4, true);
  var filelen = view.getUint32((LUMP.entities << 3) + 8, true);
  loadmodel.entities = q.memstr(new Uint8Array(buf, fileofs, filelen));
};

export const loadVertexes = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.vertexes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.vertexes << 3) + 8, true);
  if ((filelen % 12) !== 0)
    sys.error('Mod.LoadVisibility: funny lump size in ' + loadmodel.name);
  var count = filelen / 12;
  loadmodel.vertexes = [];
  var i;
  for (i = 0; i < count; ++i)
  {
    loadmodel.vertexes[i] = [view.getFloat32(fileofs, true), view.getFloat32(fileofs + 4, true), view.getFloat32(fileofs + 8, true)];
    fileofs += 12;
  }
};

export const loadSubmodels = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.models << 3) + 4, true);
  var filelen = view.getUint32((LUMP.models << 3) + 8, true);
  var count = filelen >> 6;
  if (count === 0)
    sys.error('Mod.LoadSubmodels: funny lump size in ' + loadmodel.name);
  loadmodel.submodels = [];

  loadmodel.visleafs = view.getUint32(fileofs + 52, true);
  loadmodel.numleafs = loadmodel.visleafs

  loadmodel.mins = [view.getFloat32(fileofs, true) - 1.0,
    view.getFloat32(fileofs + 4, true) - 1.0,
    view.getFloat32(fileofs + 8, true) - 1.0];
  loadmodel.maxs = [view.getFloat32(fileofs + 12, true) + 1.0,
    view.getFloat32(fileofs + 16, true) + 1.0,
    view.getFloat32(fileofs + 20, true) + 1.0];
  loadmodel.hulls[0].firstclipnode = view.getUint32(fileofs + 36, true);
  loadmodel.hulls[1].firstclipnode = view.getUint32(fileofs + 40, true);
  loadmodel.hulls[2].firstclipnode = view.getUint32(fileofs + 44, true);
  fileofs += 64;

  var i, clipnodes = loadmodel.hulls[0].clipnodes, out: Model;
  for (i = 1; i < count; ++i)
  {
    out = findName('*' + i);
    // @ts-ignore
    delete out.needload
    out.type = TYPE.brush;
    out.submodel = true;
    out.mins = [view.getFloat32(fileofs, true) - 1.0,
      view.getFloat32(fileofs + 4, true) - 1.0,
      view.getFloat32(fileofs + 8, true) - 1.0];
    out.maxs = [view.getFloat32(fileofs + 12, true) + 1.0,
      view.getFloat32(fileofs + 16, true) + 1.0,
      view.getFloat32(fileofs + 20, true) + 1.0];
    out.origin = [view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true), view.getFloat32(fileofs + 32, true)];
    out.hulls = [
      {
        clipnodes: clipnodes,
        firstclipnode: view.getUint32(fileofs + 36, true),
        lastclipnode: loadmodel.nodes.length - 1,
        planes: loadmodel.planes,
        clip_mins: [0.0, 0.0, 0.0],
        clip_maxs: [0.0, 0.0, 0.0]
      },
      {
        clipnodes: loadmodel.clipnodes,
        firstclipnode: view.getUint32(fileofs + 40, true),
        lastclipnode: loadmodel.clipnodes.length - 1,
        planes: loadmodel.planes,
        clip_mins: [-16.0, -16.0, -24.0],
        clip_maxs: [16.0, 16.0, 32.0]
      },
      {
        clipnodes: loadmodel.clipnodes,
        firstclipnode: view.getUint32(fileofs + 44, true),
        lastclipnode: loadmodel.clipnodes.length - 1,
        planes: loadmodel.planes,
        clip_mins: [-32.0, -32.0, -24.0],
        clip_maxs: [32.0, 32.0, 64.0]
      }
    ];
    out.textures = loadmodel.textures;
    out.lightdata = loadmodel.lightdata;
    out.faces = loadmodel.faces;
    out.texinfo = loadmodel.texinfo;
    out.visleafs = view.getUint32(fileofs + 52, true);
    out.firstface = view.getUint32(fileofs + 56, true);
    out.numfaces = view.getUint32(fileofs + 60, true);
    loadmodel.submodels[i - 1] = out;
    fileofs += 64;
  }
};

export const loadEdges = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2'] ? 8 : 4
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.edges << 3) + 4, true);
  var filelen = view.getUint32((LUMP.edges << 3) + 8, true);
  if ((filelen % size) !== 0)
    sys.error('Mod.LoadEdges: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.edges = [];
  var i;

  if (bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2']) {
    for (i = 0; i < count; ++i)
    {
      loadmodel.edges[i] = [view.getUint32(fileofs, true), view.getUint32(fileofs + 4, true)];
      fileofs += 8;
    }
  } else {
    for (i = 0; i < count; ++i)
    {
      loadmodel.edges[i] = [view.getUint16(fileofs, true), view.getUint16(fileofs + 2, true)];
      fileofs += 4;
    }
  }
};

export const loadTexinfo = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.texinfo << 3) + 4, true);
  var filelen = view.getUint32((LUMP.texinfo << 3) + 8, true);
  if ((filelen % 40) !== 0)
    sys.error('Mod.LoadTexinfo: funny lump size in ' + loadmodel.name);
  var count = filelen / 40;
  loadmodel.texinfo = [];
  var i, out: TexInfo;
  for (i = 0; i < count; ++i)
  {
    out = {
      vecs: [
        [view.getFloat32(fileofs, true), view.getFloat32(fileofs + 4, true), view.getFloat32(fileofs + 8, true), view.getFloat32(fileofs + 12, true)],
        [view.getFloat32(fileofs + 16, true), view.getFloat32(fileofs + 20, true), view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true)]
      ],
      texture: view.getUint32(fileofs + 32, true),
      flags: view.getUint32(fileofs + 36, true)
    };
    if (out.texture >= loadmodel.textures.length)
    {
      out.texture = loadmodel.textures.length - 1;
      out.flags = 0;
    }
    loadmodel.texinfo[i] = out;
    fileofs += 40;
  }
};

export const loadFaces = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2'] ? 28 : 20
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.faces << 3) + 4, true);
  var filelen = view.getUint32((LUMP.faces << 3) + 8, true);
  if ((filelen % size) !== 0)
    sys.error('Mod.LoadFaces: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.firstface = 0;
  loadmodel.numfaces = count;
  loadmodel.faces = [];
  var i, styles, out: Face;
  var mins, maxs, j, e, tex, v, val;
  for (i = 0; i < count; ++i) {
    if (bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2']) {
      styles = new Uint8Array(buf, fileofs + 20, 4);
      out = {
        plane: loadmodel.planes[view.getUint32(fileofs, true)],
        side: view.getUint32(fileofs + 4, true),
        firstedge: view.getUint32(fileofs + 8, true),
        numedges: view.getUint32(fileofs + 12, true),
        texinfo: view.getUint32(fileofs + 16, true),
        styles: [],
        lightofs: view.getInt32(fileofs + 24, true),
        mins: [],
        maxs: [],
        dlightbits: [],
        cached_light: []
      } as any;
      fileofs += 28;
    } else {
      styles = new Uint8Array(buf, fileofs + 12, 4);
      out = {
        plane: loadmodel.planes[view.getUint16(fileofs, true)],
        side: view.getUint16(fileofs + 2, true),
        firstedge: view.getUint32(fileofs + 4, true),
        numedges: view.getUint16(fileofs + 8, true),
        texinfo: view.getUint16(fileofs + 10, true),
        styles: [],
        lightofs: view.getInt32(fileofs + 16, true),
        mins: [],
        maxs: [],
        dlightbits: [],
        cached_light: []
      } as any;
      fileofs += 20;
    }
    if (styles[0] !== 255)
      out.styles[0] = styles[0];
    if (styles[1] !== 255)
      out.styles[1] = styles[1];
    if (styles[2] !== 255)
      out.styles[2] = styles[2];
    if (styles[3] !== 255)
      out.styles[3] = styles[3];

    mins = [999999, 999999];
    maxs = [-99999, -99999];
    tex = loadmodel.texinfo[out.texinfo];
    out.texture = tex.texture;
		out.flags = 0;

		if (out.side) // side
      out.flags |= def.SURF.planeback
    
    if (loadmodel.textures[tex.texture].sky){
      out.flags |= (def.SURF.drawsky | def.SURF.drawtiled)
      out.sky = true;
      polyForUnlitSurface(loadmodel, out);
    }
    else if (loadmodel.textures[tex.texture].turbulent) {
      out.flags |= (def.SURF.drawtub | def.SURF.drawtiled)
      out.turbulent = true; 
      
      // detect special liquid types
      
      if (loadmodel.textures[tex.texture].name.substring(0, 5).toLowerCase() === '*lava')
        out.flags |= def.SURF.drawlava
      else if (loadmodel.textures[tex.texture].name.substring(0, 6).toLowerCase() === '*slime')
        out.flags |= def.SURF.drawslime
      else if (loadmodel.textures[tex.texture].name.substring(0, 5).toLowerCase() === '*tele')
        out.flags |= def.SURF.drawtele
      else out.flags |= def.SURF.drawwater;
      
      polyForUnlitSurface(loadmodel, out);
      // GL_SubdivideSurface (out);
    } else if (loadmodel.textures[tex.texture].name[0] === '{') {
      out.flags |= def.SURF.drawfence
    } else if (tex.flags & def.TEX.missing) {
      if (out.lightofs < 0) {
        out.flags |= (def.SURF.notexture | def.SURF.drawtiled);
        polyForUnlitSurface(loadmodel, out);
      } else {
        out.flags |= def.SURF.notexture
      }
    }
    for (j = 0; j < out.numedges; ++j)
    {
      e = loadmodel.surfedges[out.firstedge + j];
      if (e >= 0)
        v = loadmodel.vertexes[loadmodel.edges[e][0]];
      else
        v = loadmodel.vertexes[loadmodel.edges[-e][1]];
      val = vec.dotProductV3(v, tex.vecs[0]) + tex.vecs[0][3];
      if (val < mins[0])
        mins[0] = val;
      if (val > maxs[0])
        maxs[0] = val;
      val = vec.dotProductV3(v, tex.vecs[1]) + tex.vecs[1][3];
      if (val < mins[1])
        mins[1] = val;
      if (val > maxs[1])
        maxs[1] = val;
    }
    
    calcSurfaceBounds(loadmodel, out)

    out.texturemins = [Math.floor(mins[0] / 16) * 16, Math.floor(mins[1] / 16) * 16];
    out.extents = [Math.ceil(maxs[0] / 16) * 16 - out.texturemins[0], Math.ceil(maxs[1] / 16) * 16 - out.texturemins[1]];
    out.lightofs = out.lightofs > 0 ? out.lightofs * 3 : out.lightofs
    
    if (!(tex.flags & def.TEX.special) && 
      (out.extents[0] > 2000 || out.extents[1] > 2000))
      throw new Error("Bad surface extents")
      
    if (loadmodel.textures[tex.texture].turbulent === true)
      out.turbulent = true;
    else if (loadmodel.textures[tex.texture].sky === true)
      out.sky = true;

    loadmodel.faces[i] = out;
  }
};

export const setParent = function(node: NodeLeaf, parent?: Node)
{
  node.parent = parent;
  if (node.contents < 0)
    return;
  
  const _node = node as Node
  setParent(_node.children[0], _node);
  setParent(_node.children[1], _node);
};

export const loadNodes = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] ? 32 : 
    bspVersion === VERSION.bsp2 ? 44 : 24
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.nodes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.nodes << 3) + 8, true);
  if ((filelen === 0) || ((filelen % size) !== 0))
    sys.error('Mod.LoadNodes: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.nodes = [];

  switch (bspVersion) {
    case VERSION["2psb"]:
      return loadNodes_2psb(view, count, fileofs)
    case VERSION['bsp2']:
      return loadNodes_bsp2(view, count, fileofs)
    default:
      return loadNodes_s(view, count, fileofs)
  }
};

const loadNodes_s = (view: DataView, count: number, fileofs: number) => {
  loadmodel.nodes = [];
  var i: number;
  var out: Node;
  
  for (i = 0; i < count; ++i) {
    loadmodel.nodes[i] = {
      num: i,
      contents: 0,
      planenum: view.getUint32(fileofs, true),
      childrenNum: [view.getInt16(fileofs + 4, true), view.getInt16(fileofs + 6, true)],
      mins: [view.getInt16(fileofs + 8, true), view.getInt16(fileofs + 10, true), view.getInt16(fileofs + 12, true)],
      maxs: [view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true), view.getInt16(fileofs + 18, true)],
      firstface: view.getUint16(fileofs + 20, true),
      numfaces: view.getUint16(fileofs + 22, true),
      cmds: [],
      // deferred set
      children: [] as any,
      plane: null as any,
      markvisframe: 0
    };
    fileofs += 24;
  }
  for (i = 0; i < count; ++i)
  {
    out = loadmodel.nodes[i] as Node;
    out.plane = loadmodel.planes[out.planenum];
    
    if (out.childrenNum[0] >= 0)
      out.children[0] = loadmodel.nodes[out.childrenNum[0]];
    else
      out.children[0] = loadmodel.leafs[-1 - out.childrenNum[0]];
    if (out.childrenNum[1] >= 0)
      out.children[1] = loadmodel.nodes[out.childrenNum[1]];
    else
      out.children[1] = loadmodel.leafs[-1 - out.childrenNum[1]];

    delete out.childrenNum
  }
  setParent(loadmodel.nodes[0], undefined);
}
const loadNodes_2psb = (view: DataView, count: number, fileofs: number) => {
  loadmodel.nodes = [];
  var i,j, out: Node, p
  
  for (i = 0; i < count; ++i) {
    loadmodel.nodes[i] = {
      num: i,
      contents: 0,
      planenum: view.getUint32(fileofs, true),
      childrenNum: [view.getInt32(fileofs + 4, true), view.getInt32(fileofs + 8, true)],
      mins: [view.getInt16(fileofs + 12, true), view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true)],
      maxs: [view.getInt16(fileofs + 18, true), view.getInt16(fileofs + 20, true), view.getInt16(fileofs + 22, true)],
      firstface: view.getUint32(fileofs + 24, true),
      numfaces: view.getUint32(fileofs + 28, true),
      cmds: [],
      // deferred set
      children: [] as any,
      plane: null as any,
      markvisframe: 0
    };
    fileofs += 32;
  }

  for (i = 0; i < count; ++i) {
    out = loadmodel.nodes[i] as Node;
    out.plane = loadmodel.planes[out.planenum];
    for (j = 0; j < 2; j++) {
      
      p = out.childrenNum[j]
      if (p >= 0 && p < count) {
        out.children[j] = loadmodel.nodes[p];
      } else {
        p = (new Uint32Array([0xffffffff - p]))[0];
        if ( p >= 0 && p < loadmodel.leafs.length) {
          out.children[j] = loadmodel.leafs[p]
        } else {
          con.print(`Mod_LoadNodes: invalid leaf index ${p} (file has only ${loadmodel.leafs.length} leafs)\n`)
          out.children[j] = loadmodel.leafs[0]
        }
      }
    }
    delete out.childrenNum
  }
  setParent(loadmodel.nodes[0], undefined);
}

const loadNodes_bsp2 = (view: DataView, count: number, fileofs: number) => {

  loadmodel.nodes = [];
  var i,j, out: Node, p
  
  for (i = 0; i < count; ++i) {
    loadmodel.nodes[i] = {
      num: i,
      contents: 0,
      planenum: view.getUint32(fileofs, true),
      childrenNum: [view.getInt32(fileofs + 4, true), view.getInt32(fileofs + 8, true)],
      mins: [view.getFloat32(fileofs + 12, true), view.getFloat32(fileofs + 16, true), view.getFloat32(fileofs + 20, true)],
      maxs: [view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true), view.getFloat32(fileofs + 32, true)],
      firstface: view.getUint32(fileofs + 36, true),
      numfaces: view.getUint32(fileofs + 40, true),
      cmds: [],
      // deferred set
      children: [] as any,
      plane: null as any,
      markvisframe: 0
    };
    fileofs += 44;
  }
  
  for (i = 0; i < count; ++i) {
    out = loadmodel.nodes[i] as Node;
    out.plane = loadmodel.planes[out.planenum];
    for (j = 0; j < 2; j++) {
			//johnfitz -- hack to handle nodes > 32k, adapted from darkplaces
      p = out.childrenNum[j]
      if (p > 0 && p < count) {
        out.children[j] = loadmodel.nodes[p];
      } else {
        p = (new Uint32Array([0xffffffff - p]))[0];
        if ( p >= 0 && p < loadmodel.leafs.length) {
          out.children[j] = loadmodel.leafs[p]
        } else {
          con.print(`Mod_LoadNodes: invalid leaf index ${p} (file has only ${loadmodel.leafs.length} leafs)\n`)
          out.children[j] = loadmodel.leafs[0]
        }
      }
    }
    delete out.childrenNum
  }
  setParent(loadmodel.nodes[0], undefined);
}
export const loadLeafs = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] ? 32 :
    bspVersion === VERSION.bsp2 ? 44 : 28
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.leafs << 3) + 4, true);
  var filelen = view.getUint32((LUMP.leafs << 3) + 8, true);
  if ((filelen % size) !== 0)
    sys.error('Mod.LoadLeafs: funny lump size in ' + loadmodel.name);
  var count = filelen / size;
  loadmodel.leafs = [];
  var i, out: Leaf;
  for (i = 0; i < count; ++i)
  {
    switch (bspVersion) {
      case VERSION["2psb"]:
        out = {
          num: i,
          contents: view.getInt32(fileofs, true),
          visofs: view.getInt32(fileofs + 4, true),
          mins: [view.getInt16(fileofs + 8, true), view.getInt16(fileofs + 10, true), view.getInt16(fileofs + 12, true)],
          maxs: [view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true), view.getInt16(fileofs + 18, true)],
          firstmarksurface: view.getUint32(fileofs + 20, true),
          nummarksurfaces: view.getUint32(fileofs + 24, true),
          ambient_level: [view.getUint8(fileofs + 28), view.getUint8(fileofs + 29), view.getUint8(fileofs + 30), view.getUint8(fileofs + 31)],
          cmds: [],
          skychain: 0,
          waterchain: 0,
          parent: null as any,
          efrags: null,
          markvisframe: 0,
          visframe: 0
        };
        loadmodel.leafs[i] = out
        fileofs += 32
        break
      case VERSION['bsp2']:
          out = {
            num: i,
            contents: view.getInt32(fileofs, true),
            visofs: view.getInt32(fileofs + 4, true),
            mins: [view.getFloat32(fileofs + 8, true), view.getFloat32(fileofs + 12, true), view.getFloat32(fileofs + 16, true)],
            maxs: [view.getFloat32(fileofs + 20, true), view.getFloat32(fileofs + 24, true), view.getFloat32(fileofs + 28, true)],
            firstmarksurface: view.getUint32(fileofs + 32, true),
            nummarksurfaces: view.getUint32(fileofs + 36, true),
            ambient_level: [view.getUint8(fileofs + 40), view.getUint8(fileofs + 41), view.getUint8(fileofs + 42), view.getUint8(fileofs + 43)],
            cmds: [],
            skychain: 0,
            waterchain: 0,
            parent: null as any,
            efrags: null,
            markvisframe: 0,
            visframe: 0
          }
          loadmodel.leafs[i] = out
          fileofs += 44
        break
      default:
        out = {
          num: i,
          contents: view.getInt32(fileofs, true),
          visofs: view.getInt32(fileofs + 4, true),
          mins: [view.getInt16(fileofs + 8, true), view.getInt16(fileofs + 10, true), view.getInt16(fileofs + 12, true)],
          maxs: [view.getInt16(fileofs + 14, true), view.getInt16(fileofs + 16, true), view.getInt16(fileofs + 18, true)],
          firstmarksurface: view.getUint16(fileofs + 20, true),
          nummarksurfaces: view.getUint16(fileofs + 22, true),
          ambient_level: [view.getUint8(fileofs + 24), view.getUint8(fileofs + 25), view.getUint8(fileofs + 26), view.getUint8(fileofs + 27)],
          cmds: [],
          skychain: 0,
          waterchain: 0,
          parent: null as any,
          efrags: null,
          markvisframe: 0,
          visframe: 0
        };
        loadmodel.leafs[i] = out
        fileofs += 28
      break
    }
  };
};

export const loadClipnodes = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION.bsp2 ? 12 : 8
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.clipnodes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.clipnodes << 3) + 8, true);
  var count = filelen / size;
  loadmodel.clipnodes = [];

  loadmodel.hulls = [];
  loadmodel.hulls[1] = {
    clipnodes: loadmodel.clipnodes,
    firstclipnode: 0,
    lastclipnode: count - 1,
    planes: loadmodel.planes,
    clip_mins: [-16.0, -16.0, -24.0],
    clip_maxs: [16.0, 16.0, 32.0]
  };
  loadmodel.hulls[2] = {
    clipnodes: loadmodel.clipnodes,
    firstclipnode: 0,
    lastclipnode: count - 1,
    planes: loadmodel.planes,
    clip_mins: [-32.0, -32.0, -24.0],
    clip_maxs: [32.0, 32.0, 64.0]
  };
  var i;
  for (i = 0; i < count; ++i)
  {
    if (bspVersion === VERSION["2psb"] || bspVersion === VERSION.bsp2) {
      loadmodel.clipnodes[i] = {
        planenum: view.getUint32(fileofs, true),
        children: [view.getInt32(fileofs + 4, true), view.getInt32(fileofs + 8, true)]
      };
      fileofs += size
    } else {
			//johnfitz -- support clipnodes > 32k
      var out = {
        planenum: view.getUint32(fileofs, true),
        children: [
          view.getUint16(fileofs + 4, true), 
          view.getUint16(fileofs + 6, true)
        ] as [number, number]
      };
			if (out.children[0] >= count)
				out.children[0] -= 65536;
			if (out.children[1] >= count)
        out.children[1] -= 65536;

      loadmodel.clipnodes[i] = out
      fileofs += size
    }
  }
};

export const makeHull0 = function()
{
  var node: Node, child, clipnodes: ClipNode[] = [], i, out: ClipNode;
  var hull = {
    clipnodes: clipnodes,
    lastclipnode: loadmodel.nodes.length - 1,
    planes: loadmodel.planes,
    clip_mins: vec.emptyV3(),
    clip_maxs: vec.emptyV3()
  };
  for (i = 0; i < loadmodel.nodes.length; ++i)
  {
    node = loadmodel.nodes[i] as Node;
    out = {planenum: node.planenum, children: [0,0]};
    child = node.children[0];
    out.children[0] = child.contents < 0 ? child.contents : child.num;
    child = node.children[1];
    out.children[1] = child.contents < 0 ? child.contents : child.num;
    clipnodes[i] = out;
  }
  loadmodel.hulls[0] = hull;
};

export const loadMarksurfaces = function(buf: ArrayBuffer, bspVersion: number)
{
  var size = bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2'] ? 4 : 2
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.marksurfaces << 3) + 4, true);
  var filelen = view.getUint32((LUMP.marksurfaces << 3) + 8, true);
  var count = filelen / size;
  loadmodel.marksurfaces = [];
  var i, j;
  for (i = 0; i < count; ++i)
  {
    if (bspVersion === VERSION["2psb"] || bspVersion === VERSION['bsp2']) { 
      j = view.getInt32(fileofs + (i << 2), true);
    } else {
      j = view.getUint16(fileofs + (i << 1), true);
    }
    if (j > loadmodel.faces.length)
      sys.error('Mod.LoadMarksurfaces: bad surface number');
    loadmodel.marksurfaces[i] = j;
  }
};

export const loadSurfedges = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.surfedges << 3) + 4, true);
  var filelen = view.getUint32((LUMP.surfedges << 3) + 8, true);
  var count = filelen >> 2;
  loadmodel.surfedges = [];
  var i;
  for (i = 0; i < count; ++i)
    loadmodel.surfedges[i] = view.getInt32(fileofs + (i << 2), true);
}

export const loadPlanes = function(buf: ArrayBuffer)
{
  var view = new DataView(buf);
  var fileofs = view.getUint32((LUMP.planes << 3) + 4, true);
  var filelen = view.getUint32((LUMP.planes << 3) + 8, true);
  if ((filelen % 20) !== 0)
    sys.error('Mod.LoadPlanes: funny lump size in ' + loadmodel.name);
  var count = filelen / 20;
  loadmodel.planes = [];
  var i, out: Plane;
  for (i = 0; i < count; ++i)
  {
    out = {
      normal: [view.getFloat32(fileofs, true), view.getFloat32(fileofs + 4, true), view.getFloat32(fileofs + 8, true)],
      dist: view.getFloat32(fileofs + 12, true),
      type: view.getUint32(fileofs + 16, true),
      signbits: 0
    };
    if (out.normal[0] < 0)
      ++out.signbits;
    if (out.normal[1] < 0)
      out.signbits += 2;
    if (out.normal[2] < 0)
      out.signbits += 4;
    loadmodel.planes[i] = out;
    fileofs += 20;
  }
};

export const loadBrushModel = async function(buffer: ArrayBuffer)
{
  loadmodel.type = TYPE.brush;
  var version = (new DataView(buffer)).getUint32(0, true);

  switch (version) {
    case VERSION.bsp2:
    case VERSION["2psb"]:
    case VERSION.brush:
      break;
    default:
      throw new Error('Mod.LoadBrushModel: ' +  loadmodel.name  + ' has wrong version number (' + version + ')');
  }

  // bspx.setup(loadmodel, buffer);

	// Q1BSPX_Setup(mod, buffer, com_filesize, header->lumps, HEADER_LUMPS);
  
  if (!host.state.dedicated) {
    loadVertexes(buffer);
    loadEdges(buffer, version);
    loadSurfedges(buffer);
    loadTextures(buffer);
    await loadLighting(buffer);
  }
  loadPlanes(buffer);
  if (!host.state.dedicated) {
    loadTexinfo(buffer);
    loadFaces(buffer, version);
    loadMarksurfaces(buffer, version);
  }
  loadVisibility(buffer);
  loadLeafs(buffer, version);
  loadNodes(buffer, version);
  loadClipnodes(buffer, version);
  makeHull0();
  loadEntities(buffer);
  loadSubmodels(buffer);

  if (!host.state.dedicated) {
    var i, vert, mins = [0.0, 0.0, 0.0], maxs = [0.0, 0.0, 0.0];
    for (i = 0; i < loadmodel.vertexes.length; ++i)
    {
      vert = loadmodel.vertexes[i];
      if (vert[0] < mins[0])
        mins[0] = vert[0];
      else if (vert[0] > maxs[0])
        maxs[0] = vert[0];

      if (vert[1] < mins[1])
        mins[1] = vert[1];
      else if (vert[1] > maxs[1])
        maxs[1] = vert[1];

      if (vert[2] < mins[2])
        mins[2] = vert[2];
      else if (vert[2] > maxs[2])
        maxs[2] = vert[2];
    };
    loadmodel.radius = vec.length([
      Math.abs(mins[0]) > Math.abs(maxs[0]) ? Math.abs(mins[0]) : Math.abs(maxs[0]),
      Math.abs(mins[1]) > Math.abs(maxs[1]) ? Math.abs(mins[1]) : Math.abs(maxs[1]),
      Math.abs(mins[2]) > Math.abs(maxs[2]) ? Math.abs(mins[2]) : Math.abs(maxs[2])
    ]);
  }
};

/*
==============================================================================

ALIAS MODELS

==============================================================================
*/

export const translatePlayerSkin = function(data: Uint8Array, skin: Skin)
{
  const gl = GL.getContext()
  if ((loadmodel.skinwidth !== 512) || (loadmodel.skinheight !== 256))
    data = tx.resampleTexture(data, loadmodel.skinwidth, loadmodel.skinheight, 512, 256);
  var out = new Uint8Array(new ArrayBuffer(524288));
  var i, original;
  for (i = 0; i < 131072; ++i)
  {
    original = data[i];
    if ((original >> 4) === 1)
    {
      out[i << 2] = (original & 15) * 17;
      out[(i << 2) + 1] = 255;
    }
    else if ((original >> 4) === 6)
    {
      out[(i << 2) + 2] = (original & 15) * 17;
      out[(i << 2) + 3] = 255;
    }
  }
  skin.playertexture = gl.createTexture();
  tx.bind(0, skin.playertexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 512, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, tx.state.filter_min);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tx.state.filter_max);
};

export const floodFillSkin = function(skin: Uint8Array)
{
  var fillcolor = skin[0];
  if (fillcolor === filledcolor)
    return;

  var width = loadmodel.skinwidth;
  var height = loadmodel.skinheight;

  var lifo = [[0, 0]], sp, cur, x, y;

  for (sp = 1; sp > 0; )
  {
    cur = lifo[--sp];
    x = cur[0];
    y = cur[1];
    skin[y * width + x] = filledcolor;
    if (x > 0)
    {
      if (skin[y * width + x - 1] === fillcolor)
        lifo[sp++] = [x - 1, y];
    }
    if (x < (width - 1))
    {
      if (skin[y * width + x + 1] === fillcolor)
        lifo[sp++] = [x + 1, y];
    }
    if (y > 0)
    {
      if (skin[(y - 1) * width + x] === fillcolor)
        lifo[sp++] = [x, y - 1];
    }
    if (y < (height - 1))
    {
      if (skin[(y + 1) * width + x] === fillcolor)
        lifo[sp++] = [x, y + 1];
    }
  }
};

export const loadAllSkins = function(buffer: ArrayBuffer, inmodel: number)
{
  loadmodel.skins = [];
  var model = new DataView(buffer);
  var i, j, group: SkinGroup, numskins;
  var skinsize = loadmodel.skinwidth * loadmodel.skinheight;
  var skin;
  for (i = 0; i < loadmodel.numskins; ++i)
  {
    inmodel += 4;
    if (model.getUint32(inmodel - 4, true) === 0)
    {
      if (GL.getContext()) {
        skin = new Uint8Array(buffer, inmodel, skinsize);
        floodFillSkin(skin);
        const newSkin: Skin = {
          group: false,
          texturenum: tx.loadTexture(loadmodel, loadmodel.name + '_' + i,
            loadmodel.skinwidth,
            loadmodel.skinheight,
            skin),
          playertexture: null,
          interval: 0
        };
        loadmodel.skins[i] = newSkin
        if (loadmodel.player === true)
          translatePlayerSkin(new Uint8Array(buffer, inmodel, skinsize), newSkin);
      }
      inmodel += skinsize;
    }
    else
    {
      group = {
        group: true,
        skins: []
      };
      numskins = model.getUint32(inmodel, true);
      inmodel += 4;
      for (j = 0; j < numskins; ++j)
      {
        group.skins[j] = {
          group: false,
          interval: model.getFloat32(inmodel, true), 
          texturenum: null, 
          playertexture: null
        };
        if (group.skins[j].interval <= 0.0)
          sys.error('Mod.LoadAllSkins: interval<=0');
        inmodel += 4;
      }
      for (j = 0; j < numskins; ++j)
      {
        if (GL.getContext()) {
          skin = new Uint8Array(buffer, inmodel, skinsize);
          floodFillSkin(skin);
          group.skins[j].texturenum = tx.loadTexture(loadmodel, loadmodel.name + '_' + i + '_' + j,
            loadmodel.skinwidth,
            loadmodel.skinheight,
            skin);
          if (loadmodel.player === true)
            translatePlayerSkin(new Uint8Array(buffer, inmodel, skinsize), group.skins[j]);
        }
        inmodel += skinsize;
      }
      loadmodel.skins[i] = group;
    }
  }
  return inmodel;
};

export const loadAllFrames = function(buffer: ArrayBuffer, inmodel: number)
{
  var poseverts = []
  loadmodel.frames = [];
  var model = new DataView(buffer);
  var i, j, k, frame: AliasFrame, group: AliasFrameGroup, numframes;
  for (i = 0; i < loadmodel.numframes; ++i)
  {
    inmodel += 4;
    if (model.getUint32(inmodel - 4, true) === 0) // ALIAS_SINGLE
    {
      frame = {
        type: 'alias',
        numposes: 1,
        group: false,
        bboxmin: [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)],
        bboxmax: [model.getUint8(inmodel + 4), model.getUint8(inmodel + 5), model.getUint8(inmodel + 6)],
        name: q.memstr(new Uint8Array(buffer, inmodel + 8, 16)),
        interval: 0,
        v: [],
        cmdofs: 0
      };
      inmodel += 24;
      for (j = 0; j < loadmodel.numverts; ++j)
      {
        frame.v[j] = {
          v: [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)],
          lightnormalindex: model.getUint8(inmodel + 3)
        };
        inmodel += 4;
      }
      loadmodel.frames[i] = frame;
    }
    else
    {
      group = {
        type: 'alias',
        group: true,
        bboxmin: [model.getUint8(inmodel + 4), model.getUint8(inmodel + 5), model.getUint8(inmodel + 6)],
        bboxmax: [model.getUint8(inmodel + 8), model.getUint8(inmodel + 9), model.getUint8(inmodel + 10)],
        frames: []
      };
      numframes = model.getUint32(inmodel, true);
      inmodel += 12;
      for (j = 0; j < numframes; ++j)
      {
        group.frames[j] = {
          type: 'alias',
          group: false,
          numposes: 0,
          name: '',
          bboxmin: [0, 0, 0],
          bboxmax: [0, 0, 0],
          v: [],
          interval: model.getFloat32(inmodel, true),
          cmdofs: 0
        };
        if (group.frames[j].interval <= 0.0)
          sys.error('Mod.LoadAllFrames: interval<=0');
        inmodel += 4;
      }
      for (j = 0; j < numframes; ++j)
      {
        frame = group.frames[j];
        frame.bboxmin = [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)];
        frame.bboxmax = [model.getUint8(inmodel + 4), model.getUint8(inmodel + 5), model.getUint8(inmodel + 6)];
        frame.name = q.memstr(new Uint8Array(buffer, inmodel + 8, 16));
        frame.v = [];
        inmodel += 24;
        for (k = 0; k < loadmodel.numverts; ++k)
        {
          frame.v[k] = {
            v: [model.getUint8(inmodel), model.getUint8(inmodel + 1), model.getUint8(inmodel + 2)],
            lightnormalindex: model.getUint8(inmodel + 3)
          };
          inmodel += 4;
        }
      }
      loadmodel.frames[i] = group;
    }
  }
};


//=========================================================================

/*
=================
Mod_CalcAliasBounds -- johnfitz -- calculate bounds of alias model for nonrotated, yawrotated, and fullrotated cases
=================
*/
// const calcAliasBounds = a => {
//   var i, j, k
// 	var		dist, yawradius, radius, v;

// 	//clear out all data
// 	for (i = 0; i < 3; i++)
// 	{
// 		loadmodel.mins[i] = loadmodel.ymins[i] = loadmodel.rmins[i] = 999999;
// 		loadmodel.maxs[i] = loadmodel.ymaxs[i] = loadmodel.rmaxs[i] = -999999;
// 		radius = yawradius = 0;
// 	}

// 	//process verts
// 	for (i = 0 ; i < a.numposes; i++)
// 		for (j = 0; j < a.numverts; j++)
// 		{
// 			for (k = 0; k < 3; k++)
// 				v[k] = poseverts[i][j].v[k] * pheader->scale[k] + pheader->scale_origin[k];

// 			for (k=0; k<3;k++)
// 			{
// 				loadmodel->mins[k] = q_min(loadmodel->mins[k], v[k]);
// 				loadmodel->maxs[k] = q_max(loadmodel->maxs[k], v[k]);
// 			}
// 			dist = v[0] * v[0] + v[1] * v[1];
// 			if (yawradius < dist)
// 				yawradius = dist;
// 			dist += v[2] * v[2];
// 			if (radius < dist)
// 				radius = dist;
// 		}

// 	//rbounds will be used when entity has nonzero pitch or roll
// 	radius = sqrt(radius);
// 	loadmodel->rmins[0] = loadmodel->rmins[1] = loadmodel->rmins[2] = -radius;
// 	loadmodel->rmaxs[0] = loadmodel->rmaxs[1] = loadmodel->rmaxs[2] = radius;

// 	//ybounds will be used when entity has nonzero yaw
// 	yawradius = sqrt(yawradius);
// 	loadmodel->ymins[0] = loadmodel->ymins[1] = -yawradius;
// 	loadmodel->ymaxs[0] = loadmodel->ymaxs[1] = yawradius;
// 	loadmodel->ymins[2] = loadmodel->mins[2];
// 	loadmodel->ymaxs[2] = loadmodel->maxs[2];
// }


export const loadAliasModel = function(buffer: ArrayBuffer)
{
  var i, j, k, l;

  loadmodel.type = TYPE.alias;
  loadmodel.player = loadmodel.name === 'progs/player.mdl';
  var model = new DataView(buffer);
  var version = model.getUint32(4, true);
  if (version !== VERSION.alias)
    sys.error(loadmodel.name + ' has wrong version number (' + version + ' should be ' + VERSION.alias + ')');
  loadmodel.scale = [model.getFloat32(8, true), model.getFloat32(12, true), model.getFloat32(16, true)];
  loadmodel.scale_origin = [model.getFloat32(20, true), model.getFloat32(24, true), model.getFloat32(28, true)];
  loadmodel.boundingradius = model.getFloat32(32, true);
  loadmodel.numskins = model.getUint32(48, true);
  if (loadmodel.numskins === 0)
    sys.error('model ' + loadmodel.name + ' has no skins');
  loadmodel.skinwidth = model.getUint32(52, true);
  loadmodel.skinheight = model.getUint32(56, true);
  loadmodel.numverts = model.getUint32(60, true);
  if (loadmodel.numverts === 0)
    sys.error('model ' + loadmodel.name + ' has no vertices');
  loadmodel.numtris = model.getUint32(64, true);
  if (loadmodel.numtris === 0)
    sys.error('model ' + loadmodel.name + ' has no triangles');
  loadmodel.numframes = model.getUint32(68, true);
  if (loadmodel.numframes === 0)
    sys.error('model ' + loadmodel.name + ' has no frames');
  loadmodel.random = model.getUint32(72, true) === 1;
  loadmodel.flags = model.getUint32(76, true);
  loadmodel.mins = [-16.0, -16.0, -16.0];
  loadmodel.maxs = [16.0, 16.0, 16.0];

  var inmodel = loadAllSkins(buffer, 84);

  loadmodel.stverts = [];
  for (i = 0; i < loadmodel.numverts; ++i)
  {
    loadmodel.stverts[i] = {
      onseam: model.getUint32(inmodel, true) !== 0,
      s: model.getUint32(inmodel + 4, true),
      t: model.getUint32(inmodel + 8, true)
    };
    inmodel += 12;
  }

  loadmodel.triangles = [];
  for (i = 0; i < loadmodel.numtris; ++i)
  {
    loadmodel.triangles[i] = {
      facesfront: model.getUint32(inmodel, true) !== 0,
      vertindex: [
        model.getUint32(inmodel + 4, true),
        model.getUint32(inmodel + 8, true),
        model.getUint32(inmodel + 12, true)
      ]
    };
    inmodel += 16;
  }

  loadAllFrames(buffer, inmodel);

  var cmds = [];

  var triangle, vert, s;
  for (i = 0; i < loadmodel.numtris; ++i)
  {
    triangle = loadmodel.triangles[i];
    if (triangle.facesfront === true)
    {
      vert = loadmodel.stverts[triangle.vertindex[0]];
      cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
      vert = loadmodel.stverts[triangle.vertindex[1]];
      cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
      vert = loadmodel.stverts[triangle.vertindex[2]];
      cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
      continue;
    }
    for (j = 0; j < 3; ++j)
    {
      vert = loadmodel.stverts[triangle.vertindex[j]];
      if (vert.onseam === true)
        cmds[cmds.length] = (vert.s + loadmodel.skinwidth / 2 + 0.5) / loadmodel.skinwidth;
      else
        cmds[cmds.length] = (vert.s + 0.5) / loadmodel.skinwidth;
      cmds[cmds.length] = (vert.t + 0.5) / loadmodel.skinheight;
    }
  }

  var group: AliasFrameGroup, frame: AliasFrame;
  for (i = 0; i < loadmodel.numframes; ++i)
  {
    if (loadmodel.frames[i].group === true)
    {
      group = loadmodel.frames[i] as AliasFrameGroup
      for (j = 0; j < group.frames.length; ++j)
      {
        frame = group.frames[j];
        frame.cmdofs = cmds.length << 2;
        for (k = 0; k < loadmodel.numtris; ++k)
        {
          triangle = loadmodel.triangles[k];
          for (l = 0; l < 3; ++l)
          {
            vert = frame.v[triangle.vertindex[l]];
            if (vert.lightnormalindex >= 162)
              sys.error('lightnormalindex >= NUMVERTEXNORMALS');
            cmds[cmds.length] = vert.v[0] * loadmodel.scale[0] + loadmodel.scale_origin[0];
            cmds[cmds.length] = vert.v[1] * loadmodel.scale[1] + loadmodel.scale_origin[1];
            cmds[cmds.length] = vert.v[2] * loadmodel.scale[2] + loadmodel.scale_origin[2];
            cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][0];
            cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][1];
            cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][2];
          }
        }
      }
      continue;
    }
    frame = loadmodel.frames[i] as AliasFrame;
    frame.cmdofs = cmds.length << 2;
    for (j = 0; j < loadmodel.numtris; ++j)
    {
      triangle = loadmodel.triangles[j];
      for (k = 0; k < 3; ++k)
      {
        vert = frame.v[triangle.vertindex[k]];
        if (vert.lightnormalindex >= 162)
          sys.error('lightnormalindex >= NUMVERTEXNORMALS');
        cmds[cmds.length] = vert.v[0] * loadmodel.scale[0] + loadmodel.scale_origin[0];
        cmds[cmds.length] = vert.v[1] * loadmodel.scale[1] + loadmodel.scale_origin[1];
        cmds[cmds.length] = vert.v[2] * loadmodel.scale[2] + loadmodel.scale_origin[2];
        cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][0];
        cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][1];
        cmds[cmds.length] = r.state.avertexnormals[vert.lightnormalindex][2];
      }
    }
  }
  const gl = GL.getContext()
  if (gl) {
    loadmodel.cmds = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, loadmodel.cmds);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cmds), gl.STATIC_DRAW);
  }
};

export const loadSpriteFrame = function(identifier: string, buffer: ArrayBuffer, inframe: number, frame: Partial<SpriteFrame>)
{
  const gl = GL.getContext()
  var i;

  var model = new DataView(buffer);
  frame.origin = [model.getInt32(inframe, true), -model.getInt32(inframe + 4, true)];
  frame.width = model.getUint32(inframe + 8, true);
  frame.height = model.getUint32(inframe + 12, true);
  var size = frame.width * frame.height;

  var glt: GLTexture;
  for (i = 0; i < tx.state.textures.length; ++i)
  {
    glt = tx.state.textures[i];
    if (glt.identifier === identifier)
    {
      // JOE:FIXME: width height undefined! This was in the original code though
      //if ((width !== glt.width) || (height !== glt.height))
      sys.error('Mod.LoadSpriteFrame: cache mismatch');
      frame.texturenum = glt.texnum;
      return inframe + 16 + frame.width * frame.height;
    }
  }

  var data = new Uint8Array(buffer, inframe + 16, size);
  var scaled_width = frame.width, scaled_height = frame.height;
  if (((frame.width & (frame.width - 1)) !== 0) || ((frame.height & (frame.height - 1)) !== 0))
  {
    --scaled_width;
    scaled_width |= (scaled_width >> 1);
    scaled_width |= (scaled_width >> 2);
    scaled_width |= (scaled_width >> 4);
    scaled_width |= (scaled_width >> 8);
    scaled_width |= (scaled_width >> 16);
    ++scaled_width;
    --scaled_height;
    scaled_height |= (scaled_height >> 1);
    scaled_height |= (scaled_height >> 2);
    scaled_height |= (scaled_height >> 4);
    scaled_height |= (scaled_height >> 8);
    scaled_height |= (scaled_height >> 16);
    ++scaled_height;
  }
  if (scaled_width > tx.state.maxtexturesize)
    scaled_width = tx.state.maxtexturesize;
  if (scaled_height > tx.state.maxtexturesize)
    scaled_height = tx.state.maxtexturesize;
  if ((scaled_width !== frame.width) || (scaled_height !== frame.height))
  {
    size = scaled_width * scaled_height;
    if (gl) {
      data = tx.resampleTexture(data, frame.width, frame.height, scaled_width, scaled_height);
    }
  }

  var trans = new ArrayBuffer(size << 2);
  var trans32 = new Uint32Array(trans);
  for (i = 0; i < size; ++i)
  {
    if (data[i] !== 255)
      trans32[i] = com.state.littleLong(vid.d_8to24table[data[i]] + 0xff000000);
  }
  if (gl) {
    glt = {
      texnum: gl.createTexture(), 
      identifier: identifier, 
      width: frame.width, 
      height: frame.height,
      owner: null
    };
    tx.bind(0, glt.texnum);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, scaled_width, scaled_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, tx.state.filter_min);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, tx.state.filter_max);
    tx.state.textures[tx.state.textures.length] = glt;
    frame.texturenum = glt.texnum;
  }
  return inframe + 16 + frame.width * frame.height;
}

export const loadSpriteModel = function(buffer: ArrayBuffer)
{
  loadmodel.type = TYPE.sprite;
  var model = new DataView(buffer);
  var version = model.getUint32(4, true);
  if (version !== VERSION.sprite)
    sys.error(loadmodel.name + ' has wrong version number (' + version + ' should be ' + VERSION.sprite + ')');
  loadmodel.oriented = model.getUint32(8, true) === 3;
  loadmodel.boundingradius = model.getFloat32(12, true);
  loadmodel.width = model.getUint32(16, true);
  loadmodel.height = model.getUint32(20, true);
  loadmodel.numframes = model.getUint32(24, true);
  if (loadmodel.numframes === 0)
    sys.error('model ' + loadmodel.name + ' has no frames');
  loadmodel.random = model.getUint32(32, true) === 1;
  loadmodel.mins = [loadmodel.width * -0.5, loadmodel.width * -0.5, loadmodel.height * -0.5];
  loadmodel.maxs = [loadmodel.width * 0.5, loadmodel.width * 0.5, loadmodel.height * 0.5];

  loadmodel.frames = [];
  var inframe = 36, i, j, frame: Partial<SpriteFrame>, group: Partial<SpriteFrameGroup>, numframes;
  for (i = 0; i < loadmodel.numframes; ++i)
  {
    inframe += 4;
    if (model.getUint32(inframe - 4, true) === 0)
    {
      frame = {
        type: 'sprite',
        group: false
      };
      loadmodel.frames[i] = frame as SpriteFrame;
      inframe = loadSpriteFrame(loadmodel.name + '_' + i + '_' + j, buffer, inframe, frame);
    }
    else
    {
      group = {
        type: 'sprite',
        group: true,
        frames: []
      };
      loadmodel.frames[i] = group as SpriteFrameGroup;
      numframes = model.getUint32(inframe, true);
      inframe += 4;
      for (j = 0; j < numframes; ++j)
      {
        const spriteFrame: Partial<SpriteFrame> = {type: 'sprite', group: false, interval: model.getFloat32(inframe, true)}
        group.frames[j] = spriteFrame as SpriteFrame
        if (group.frames[j].interval <= 0.0)
          sys.error('Mod.LoadSpriteModel: interval<=0');
        inframe += 4;
      }
      for (j = 0; j < numframes; ++j)
        inframe = loadSpriteFrame(loadmodel.name + '_' + i + '_' + j, buffer, inframe, group.frames[j]);
    }
  }
};

export const print = function()
{
  con.print('Cached models:\n');
  var i;
  for (i = 0; i < known.length; ++i)
    con.print(known[i].name + '\n');
};