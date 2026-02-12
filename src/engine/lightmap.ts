import {loadLightmapTexture, bind, state as txState} from './texture'
import * as cl from './cl'
import * as vec from './vec'
import * as def from './def'
import * as GL from './GL'
import * as texture from './texture'
import * as con from './console'
import {cvr} from './r'
import { Face, Model, TexChain } from './types/Model'
import { V3 } from './types/Vector'

export const LM_BLOCK_WIDTH = 256
export const LM_BLOCK_HEIGHT = 256
export const MAXLIGHTMAPS = 512
export const MAX_LIGHTSTYLES = 64

// const cvr = {
// 	gl_overbright: {value: 1},
// 	gl_fullbrights: {value: 0},
// 	r_novis: {value: 0},
//   dynamic: {value:0},
// 	oldskyleaf: {value: 0}
// }

export type LightmapState = {
	lightmap_modified: boolean[],
	lightmap_rectchange: {l: number, t: number, w: number, h: number}[],
	lightstylevalue: Uint32Array,
	blocklights: Uint32Array,
	lightmap_bytes: number,
	lightmaps: Uint8Array,
	allocated: number[][],
	dlightframecount: number,
	last_lightmap_allocated: number
}

export const state: LightmapState = {
    lightmap_modified: [],
    lightmap_rectchange: [],
    lightstylevalue: new Uint32Array(new ArrayBuffer(256 * 4)),
    blocklights: new Uint32Array(new ArrayBuffer(3 * LM_BLOCK_HEIGHT * LM_BLOCK_WIDTH)),
    lightmap_bytes: 4,
    lightmaps: new Uint8Array(new ArrayBuffer(4 * MAXLIGHTMAPS * LM_BLOCK_HEIGHT * LM_BLOCK_WIDTH)),
  allocated: Array.apply(null, new Array(MAXLIGHTMAPS)).map((): number[] => []),
  dlightframecount: 0,
  last_lightmap_allocated: 0
}

export const init = () => {	
	for (var i=0 ; i<256 ; i++)
		state.lightstylevalue[i] = 264;	

	state.lightmap_modified = Array.apply(null, new Array(MAXLIGHTMAPS)).map(() => false)
	state.lightmap_rectchange = Array.apply(null, new Array(MAXLIGHTMAPS)).map(() => ({l:0, t:0, w:0, h:0}))

	state.allocated = Array.apply(null, new Array(MAXLIGHTMAPS)).map(() => 
		Array.apply(null, new Array(LM_BLOCK_WIDTH)).map(() => 0))
	state.last_lightmap_allocated = 0;

	state.dlightframecount = 0; // no dlightcache
}

/*
========================
AllocBlock -- returns a texture number and the position inside it
========================
*/
const allocBlock = (surf: Face) => {
	var	i, j;
	var	best, best2;
	var	texnum;
	var w = (surf.extents[0]>>4)+1;
	var h = (surf.extents[1]>>4)+1;

	// ericw -- rather than searching starting at lightmap 0 every time,
	// start at the last lightmap we allocated a surface in.
	// This makes AllocBlock much faster on large levels (can shave off 3+ seconds
	// of load time on a level with 180 lightmaps), at a cost of not quite packing
	// lightmaps as tightly vs. not doing this (uses ~5% more lightmaps)
	for (texnum=state.last_lightmap_allocated ; texnum<MAXLIGHTMAPS ; texnum++, state.last_lightmap_allocated++)
	{
		best = LM_BLOCK_HEIGHT;

		for (i=0 ; i<LM_BLOCK_WIDTH-w ; i++)
		{
			best2 = 0;

			for (j=0 ; j<w ; j++)
			{
				if (state.allocated[texnum][i+j] >= best)
					break;
				if (state.allocated[texnum][i+j] > best2)
					best2 = state.allocated[texnum][i+j];
			}
			if (j == w)
			{	// this is a valid spot
				surf.light_s = i;
				surf.light_t = best = best2;
			}
		}

		if (best + h > LM_BLOCK_HEIGHT)
			continue;

		for (i=0 ; i<w ; i++)
			state.allocated[texnum][surf.light_s + i] = best + h;

		return texnum;
	}

	throw new Error ("AllocBlock: full");
}

export const createSurfaceLightmap = (model: Model, surf: Face) => {
	surf.lightmaptexturenum = allocBlock (surf);

	var bufOfs = surf.lightmaptexturenum * state.lightmap_bytes * LM_BLOCK_WIDTH * LM_BLOCK_HEIGHT;
	bufOfs += (surf.light_t * LM_BLOCK_WIDTH + surf.light_s) * state.lightmap_bytes;
	buildLightMap (model, surf, bufOfs, LM_BLOCK_WIDTH * state.lightmap_bytes);
}

export const addDynamicLights = (blocklights: Uint32Array, model: Model, surf: Face) => {
	//johnfitz

	var smax = (surf.extents[0] >> 4) + 1;
	var tmax = (surf.extents[1] >> 4) + 1;
	var tex = model.texinfo[surf.texinfo];
	var impact: V3 = vec.emptyV3(), local = []
	var sd, td, brightness, blidx = 0;

	for (var i = 0; i < cl.state.dlights.length; i++)
	{
		if (! (surf.dlightbits[i >> 5] & (1 << (i & 31))))
			continue;		// not lit by this light

		var rad = cl.state.dlights[i].radius;
		var dist = vec.dotProductV3(cl.state.dlights[i].origin, surf.plane.normal) -
				surf.plane.dist;

		rad -= Math.abs(dist);

		var minlight = cl.state.dlights[i].minlight;
		if (rad < minlight)
			continue;

		minlight = rad - minlight;

		for (var j=0 ; j<3 ; j++)
		{
			impact[j] = cl.state.dlights[i].origin[j] -
					surf.plane.normal[j] * dist;
		}

		local[0] = vec.dotProductV3(impact, tex.vecs[0]) + tex.vecs[0][3];
		local[1] = vec.dotProductV3(impact, tex.vecs[1]) + tex.vecs[1][3];

		local[0] -= surf.texturemins[0];
		local[1] -= surf.texturemins[1];

		//johnfitz -- lit support via lordhavoc
		var bl = blocklights;
		var cred = 256 // cl.state.dlights[i].color[0] * 256.0;
		var cgreen = 256 // cl.state.dlights[i].color[1] * 256.0;
		var cblue = 256 // cl.state.dlights[i].color[2] * 256.0;

		//johnfitz
		for (var t = 0; t < tmax; t++)
		{
			td = local[1] - (t << 4);
			if (td < 0)
				td = -td;
			td = Math.floor(td)

			for (var s = 0 ; s < smax ; s++)
			{
				sd = local[0] - (s << 4);
				if (sd < 0)
					sd = -sd;
				sd = Math.floor(sd)
				if (sd > td)
					dist = sd + (td>>1);
				else
					dist = td + (sd>>1);
				if (dist < minlight)
				//johnfitz -- lit support via lordhavoc
				{
					brightness = rad - dist;
					bl[blidx++] += Math.floor(brightness * cred);
					bl[blidx++] += Math.floor(brightness * cgreen);
					bl[blidx++] += Math.floor(brightness * cblue);
				} else {
					blidx += 3
				}
				//johnfitz
			}
		}
	}
}
export const buildLightmaps = (gl: WebGLRenderingContext, model: Model) => {

	//johnfitz -- null out array (the gltexture objects themselves were already freed by Mod_ClearAll)
	
	// for (var i=0; i < MAXLIGHTMAPS; i++)
	// 	txState.lightmap_textures[i] = null;

	//johnfitz

	state.lightmap_bytes = 4 // hardcoded for gl.RGBA

	// for (j=1 ; j<MAX_MODELS ; j++)
	// {
	// 	m = cl.model_precache[j];
	// 	if (!m)
	// 		break;
	// 	if (m->name[0] == '*')
	// 		continue;
	//	r_pcurrentvertbase = model.vertexes; // bs 
	//	currentmodel = m;
		for (var i=0 ; i<model.numfaces ; i++)
		{
			//johnfitz -- rewritten to use SURF_DRAWTILED instead of the sky/water flags
			if (model.faces[i].flags & def.SURF.drawtiled)
				continue;
			createSurfaceLightmap (model, model.faces[i]);
			//johnfitz
		}
	//}

	//
	// upload all lightmaps that were filled
	//
	for (i = 0; i<MAXLIGHTMAPS; i++)
	{
		if (!state.allocated[i][0])
			break;		// no more used
		state.lightmap_modified[i] = false;
		state.lightmap_rectchange[i].l = LM_BLOCK_WIDTH;
		state.lightmap_rectchange[i].t = LM_BLOCK_HEIGHT;
		state.lightmap_rectchange[i].w = 0;
		state.lightmap_rectchange[i].h = 0;

		//johnfitz -- use texture manager
		const name = `lightmap#${i}`
		const lightmapSize = LM_BLOCK_WIDTH * LM_BLOCK_HEIGHT * state.lightmap_bytes
		const data = state.lightmaps.subarray(lightmapSize * i, lightmapSize * i + lightmapSize)

		loadLightmapTexture(gl, i, name, LM_BLOCK_WIDTH, LM_BLOCK_HEIGHT, data)
		//johnfitz
	}

	//johnfitz -- warn about exceeding old limits
	if (i >= 64)
		con.dPrint(`${i} lightmaps exceeds standard limit of 64 (max = ${MAXLIGHTMAPS}).\n`);
	//johnfitz
}

const buildLightMap = (model: Model, surf: Face, buffofs: number, stride: number) => {
	surf.cached_dlight = surf.dlightframe === state.dlightframecount

	const smax = (surf.extents[0]>>4)+1;
	const tmax = (surf.extents[1]>>4)+1;
	const size = smax * tmax;

	var blockidx = 0
	var buffidx = surf.lightofs

	if (model && model.lightdata)
	{
		state.blocklights.fill(0, 0, size * 3)
		// add all the lightmaps
		if (buffidx > -1)
		{
			for (var maps = 0; maps < surf.styles.length && surf.styles[maps] !== 255;
				 maps++)
			{
				const scale = state.lightstylevalue[surf.styles[maps]];
				surf.cached_light[maps] = scale;	// 8.8 fraction

				blockidx = 0
				//johnfitz -- lit support via lordhavoc

				for (var i = 0; i < size; i++)
				{
					state.blocklights[blockidx++] += model.lightdata[buffidx++] * scale
					state.blocklights[blockidx++] += model.lightdata[buffidx++] * scale
					state.blocklights[blockidx++] += model.lightdata[buffidx++] * scale
				}

				//johnfitz
			}
		}

		// add all the dynamic lights
		if (surf.dlightframe === state.dlightframecount)
			addDynamicLights (state.blocklights, model, surf);
	}
	else
	{
		// set to full bright if no light data
		state.blocklights.fill(255 * 255)
	}

	// case GL_RGBA:
	stride -= smax * 4;
	blockidx = 0
	
	buffidx = buffofs
	var r, g, b
	for (var i=0 ; i<tmax ; i++, buffidx += stride)
	{
		for (var j=0 ; j<smax ; j++)
		{
			if (0)//cvr.gl_overbright.value)
			{
				r = state.blocklights[blockidx++] >> 8;
				g = state.blocklights[blockidx++] >> 8;
				b = state.blocklights[blockidx++] >> 8;
			}
			else
			{
				r = state.blocklights[blockidx++] >> 7;
				g = state.blocklights[blockidx++] >> 7;
				b = state.blocklights[blockidx++] >> 7;
			}
			state.lightmaps[buffidx++] 	= (r > 255)? 255 : r;
			state.lightmaps[buffidx++] 	= (g > 255)? 255 : g;
			state.lightmaps[buffidx++] 	= (b > 255)? 255 : b;
			state.lightmaps[buffidx++] 	= 255;
		}
	}
}


const renderDynamicLightmaps = (model: Model, surf: Face) => {
	if (surf.flags & def.SURF.drawtiled) //johnfitz -- not a lightmapped surface
		return;

	var doDynamic = false

	// check for lightmap modification
	for (var maps=0; maps < surf.styles.length && surf.styles[maps] !== 255; maps++)
		if (state.lightstylevalue[surf.styles[maps]] !== surf.cached_light[maps]){
			doDynamic= true
			break
		}

	if (doDynamic 
		|| surf.dlightframe === state.dlightframecount	// dynamic this frame
		|| surf.cached_dlight)			// dynamic previously
	{
		if (cvr.dynamic.value)
		{
			state.lightmap_modified[surf.lightmaptexturenum] = true;
			var theRect = state.lightmap_rectchange[surf.lightmaptexturenum];
			if (surf.light_t < theRect.t) {
				if (theRect.h)
					theRect.h += theRect.t - surf.light_t;
				theRect.t = surf.light_t;
			}
			if (surf.light_s < theRect.l) {
				if (theRect.w)
					theRect.w += theRect.l - surf.light_s;
				theRect.l = surf.light_s;
			}
			var smax = (surf.extents[0]>>4)+1;
			var tmax = (surf.extents[1]>>4)+1;
			if ((theRect.w + theRect.l) < (surf.light_s + smax))
				theRect.w = (surf.light_s-theRect.l)+smax;
			if ((theRect.h + theRect.t) < (surf.light_t + tmax))
				theRect.h = (surf.light_t-theRect.t)+tmax;
			var bufOfs = surf.lightmaptexturenum * state.lightmap_bytes * LM_BLOCK_WIDTH * LM_BLOCK_HEIGHT;
			bufOfs += surf.light_t * LM_BLOCK_WIDTH * state.lightmap_bytes + surf.light_s * state.lightmap_bytes;
			buildLightMap (model, surf, bufOfs, LM_BLOCK_WIDTH * state.lightmap_bytes);
		}
	}
}


export const buildLightmapChains = (model: Model, chain: TexChain) => {
	var i = 0, t, s
	for (var i = 0; i < model.textures.length; i++)
	{
		t = model.textures[i];

		if (!t || !t.texturechains[chain])
			continue;

		for (s = t.texturechains[chain]; s; s = s.texturechain)
			if (!s.culled)
				renderDynamicLightmaps (model, s);
	}
}

// Dynamic lights
const uploadLightmap = (gl: WebGLRenderingContext, lmapIdx: number) => {

	if (!state.lightmap_modified[lmapIdx])
		return;

	state.lightmap_modified[lmapIdx] = false
	
	const theRect = state.lightmap_rectchange[lmapIdx]

	const offset =  (lmapIdx * LM_BLOCK_HEIGHT + theRect.t) * LM_BLOCK_WIDTH * 4
	const length = LM_BLOCK_WIDTH * theRect.h * 4
	const data = state.lightmaps.subarray(offset)

	gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, theRect.t, LM_BLOCK_WIDTH, theRect.h, gl.RGBA, gl.UNSIGNED_BYTE, data);
	theRect.l = LM_BLOCK_WIDTH;
	theRect.t = LM_BLOCK_HEIGHT;
	theRect.h = 0;
	theRect.w = 0;

	// rs_dynamiclightmaps++; // stats
}

export const uploadLightmaps = (gl: WebGLRenderingContext) => {
	for (var i = 0; i < MAXLIGHTMAPS; i++)
	{
		if (!state.lightmap_modified[i])
			continue;

		texture.bind(0, texture.state.lightmap_textures[i].texnum);
		uploadLightmap(gl, i);
	}
}
// const uploadLightmaps = (gl: WebGLRenderingContext) => {
// 	for (var lmapIdx = 0; lmapIdx < MAXLIGHTMAPS; lmapIdx++)
// 	{
// 		if (!state.lightmap_modified[lmapIdx])
// 			continue;

// 		bind (gl, 0, txState.lightmap_textures[lmapIdx].texnum);
// 		uploadLightmap(gl, lmapIdx);
// 	}
// }


