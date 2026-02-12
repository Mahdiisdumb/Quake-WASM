import * as cmd from './cmd'
import * as cvar from './cvar'
import * as GL from './GL'
import * as vec from './vec'
import * as cl from './cl'
import * as mod from './mod'
import * as chase from './chase'
import * as v from './v'
import * as scr from './scr'
import * as sys from './sys'
import * as con from './console'
import * as host from './host'
import * as com from './com'
import * as sv from './sv'
import * as pr from './pr'
import * as q from './q'
import * as vid from './vid'
import * as msg from './msg'
import * as def from './def'
import * as batchRender from './batchRender'
import * as s from './s'
import * as lm from './lightmap'
import * as tx from './texture'
import * as mapAlpha from './mapAlpha'
import * as fog from './fog'
import { AliasFrame, AliasFrameGroup, Face, Leaf, Model, Node, NodeLeaf, Plane, SpriteFrame, SpriteFrameGroup, TexChain, Texture } from './types/Model'
import { V3, V4 } from './types/Vector'
import { EFrags } from './types/Model'
import { Entity } from './types/Entity'
import { DynamicLight } from './cl'
import { createAttribParam } from './GL'

export const MAX_DLIGHTS = 32
export const LERP = {
	movestep: 1,
	resetanim: 1 << 1,
	resetanim2: 1 << 2,
	resetmove: 1 << 3,
	finish: 1 << 4
}

type Refdef = {
	vrect: {
		x: number,
		y: number,
		width: number,
		height: number
	},
	vieworg: V3,
	viewangles: V3
	fov_y: number
	fov_x: number
}

type Particle = {
	org: V3,
	vel: V3,
	color: number,
	die: number,
	ramp: number,
	type: number
}
type EmptyParticle = {
	die: -1
}
type RState = {
	framecount: number
	pefragtopnode: Leaf | Node | null
	dlightvecs: WebGLBuffer,
	warpbuffer: WebGLBuffer,
	warprenderbuffer: WebGLBuffer,
	warptexture: WebGLTexture,
	notexture_mip: Texture,
	solidskytexture: WebGLTexture,
	alphaskytexture: WebGLTexture,
	null_texture: WebGLTexture,
	vis_changed: boolean,
	visframecount: number,
	frustum: [Plane, Plane, Plane, Plane],
	refdef: Refdef,
	vup: V3,
	vpn: V3,
	vright: V3,
	perspective: number[],
	dowarp: boolean,
	warpwidth: number,
	warpheight: number,
	oldwarpwidth: number,
	oldwarpheight: number,
	viewleaf: Leaf | null,
	c_brush_verts: number,
	c_alias_polys: number,
	skytexturenum: number
	avertexnormals: V3[],
	ramp1: number[],
	ramp2: number[],
	ramp3: number[],
	numparticles: number,
	avelocities: V3[],
	particles: (Particle | EmptyParticle)[],
	tracercount: number
	lightmap_modified: boolean[]
	drawsky: boolean
	model_vbo: WebGLBuffer
	cl_worldmodel: Model
	oldviewleaf: Leaf
	mod_novis: Uint8Array
	mod_novis_capacity: number
	fatbytes: number
	fatpvs: Uint8Array
	fatpvs_capacity: number;
	skyvecs: WebGLBuffer
}

export const state: RState = {
	framecount: 0,
	pefragtopnode: null,
	dlightvecs: null,
	warpbuffer: null,
	warprenderbuffer: null,
	warptexture: null,
	vis_changed: false,
	notexture_mip: null,
	solidskytexture: null,
	alphaskytexture: null,
	null_texture: null,
	visframecount: 0,
	warpwidth: 0,
	warpheight: 0,
	oldwarpwidth: 0,
	oldwarpheight: 0,
	c_brush_verts: 0,
	c_alias_polys: 0,
	frustum: [{
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}, {
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}, {
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}, {
		normal: [0, 0, 0],
		dist: 0,
		signbits: 0,
		type: 0
	}],
	vup: [0,0,0],
	vpn: [0,0,0],
	vright: [0,0,0],	
	refdef: {
		vrect: {
			x: 0,
			y: 0,
			width: 0,
			height: 0
		},
		vieworg: [0.0, 0.0, 0.0],
		viewangles: [0.0, 0.0, 0.0],
		fov_y: 0,
		fov_x: 0
	},
	perspective: [
		0.0, 0.0, 0.0, 0.0,
		0.0, 0.0, 0.0, 0.0,
		0.0, 0.0, -65540.0 / 65532.0, -1.0,
		0.0, 0.0, -524288.0 / 65532.0, 0.0
	],
	dowarp: false,
	viewleaf: null,
	skytexturenum: 0,
	avertexnormals: [],
	ramp1: [],
	ramp2: [],
	ramp3: [],
	numparticles: 0,
	avelocities: [],
	particles: [],
	tracercount: 0,
	lightmap_modified: [],
	drawsky: false,
	model_vbo: null,
	cl_worldmodel: null,
	oldviewleaf: null,
	mod_novis: null,
	mod_novis_capacity: 0,
	fatbytes: 0,
	fatpvs: null,
	fatpvs_capacity: 0,
	skyvecs: null
}

export const cvr = {
} as any

const	MAXLIGHTMAPS = 16
export type Color = [number, number, number]
// set on init
// let gl: any = null

// efrag

export const splitEntityOnNode = function (node: Node | Leaf, entity: Entity, emins: V3, emaxs: V3) {
	if (node.contents === mod.CONTENTS.solid)
		return;

	// add an efrag if the node is a leaf
	if (node.contents < 0) {
		const leaf = node as Leaf
		if (!state.pefragtopnode)
			state.pefragtopnode = leaf;

		const efrags = {
			leafnext: leaf.efrags,
			entity
		}

		leaf.efrags = efrags

		return;
	}
	const _node = node as Node
	var sides = vec.boxOnPlaneSide(emins, emaxs, _node.plane);
	if (sides === 3) {
		// split on this plane
		// if this is the first splitter of this bmodel, remember it
		if (!state.pefragtopnode)
			state.pefragtopnode = _node;
	}

	if ((sides & 1) !== 0)
		splitEntityOnNode(_node.children[0], entity, emins, emaxs);
	if ((sides & 2) !== 0)
		splitEntityOnNode(_node.children[1], entity, emins, emaxs);
};

const storeEfrags = (efrag: EFrags) => {
	for(var _efrag = efrag; !!_efrag; _efrag = _efrag.leafnext) {
		var ent = efrag.entity
		if (ent.visframe !== host.state.framecount && cl.state.numvisedicts < def.max_vis_edicts) {
			cl.state.visedicts[cl.state.numvisedicts++] = ent
			ent.visframe = host.state.framecount
		}
	}
}

// light
/*
==================
R_AnimateLight
==================
*/
const animateLight = () => {
	if (cvr.fullbright.value === 1) {
		for (var j = 0; j < lm.MAX_LIGHTSTYLES; j++) {
			lm.state.lightstylevalue[j] = 264;
		}
		return
	}

	//
	// light animations
	// 'm' is normal light, 'a' is no light, 'z' is double bright
	var i = Math.floor(cl.clState.time * 10)
	for (var j = 0; j < lm.MAX_LIGHTSTYLES; j++) {
		if (cl.state.lightstyle[j].length === 0) {
			lm.state.lightstylevalue[j] = 264;
			continue;
		}

		var k = i % cl.state.lightstyle[j].length;
		k = cl.state.lightstyle[j].charCodeAt(k) - 97; // 'a'

		lm.state.lightstylevalue[j] = k * 22;
		//johnfitz
	}
}

export const renderDlights = function () {
	const gl = GL.getContext()
	if (cvr.flashblend.value === 0)
		return;
	++lm.state.dlightframecount;
	gl.enable(gl.BLEND);
	var program = GL.useProgram('Dlight'), l, a;
	gl.bindBuffer(gl.ARRAY_BUFFER, state.dlightvecs);
	gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, 0, 0); // TODO: is this fixed now?
	for (var i = 0; i <= 31; ++i) {
		l = cl.state.dlights[i];
		if ((l.die < cl.clState.time) || (l.radius === 0.0))
			continue;
		if (vec.length([l.origin[0] - state.refdef.vieworg[0], l.origin[1] - state.refdef.vieworg[1], l.origin[2] - state.refdef.vieworg[2]]) < (l.radius * 0.35)) {
			a = l.radius * 0.0003;
			v.blend[3] += a * (1.0 - v.blend[3]);
			a /= v.blend[3];
			v.blend[0] = v.blend[1] * (1.0 - a) + (255.0 * a);
			v.blend[1] = v.blend[1] * (1.0 - a) + (127.5 * a);
			v.blend[2] *= 1.0 - a;
			continue;
		}
		gl.uniform3fv(program.uniforms.uOrigin, l.origin);
		gl.uniform1f(program.uniforms.uRadius, l.radius);
		gl.drawArrays(gl.TRIANGLE_FAN, 0, 18);
	}
	gl.disable(gl.BLEND);
};

export const markLights = function (light: cl.DynamicLight, bit: number, node: Node | Leaf) {
	if (node.contents < 0)
		return;
	const _node = node as Node
	var worldmodel = cl.clState.worldmodel
	var dist = 0, impact: V3 = [0,0,0]
	var l, i, j, s, t;

	var splitplane = _node.plane;
	if (splitplane.type < 3)
		dist = light.origin[splitplane.type] - splitplane.dist;
	else
		dist = vec.dotProductV3(light.origin, splitplane.normal) - splitplane.dist;

	if (dist > light.radius) {
		markLights(light, bit, _node.children[0]);
		return;
	}
	if (dist < -light.radius) {
		markLights(light, bit, _node.children[1]);
		return;
	}
	var surf;
	var maxdist = light.radius * light.radius;
	for (i = 0; i < _node.numfaces; ++i) {
		surf = cl.clState.worldmodel.faces[_node.firstface + i];
		if ((surf.sky === true) || (surf.turbulent === true))
			continue;

		for (j = 0; j < 3; j++)
			impact[j] = light.origin[j] - surf.plane.normal[j] * dist;
		var texvecs = worldmodel.texinfo[surf.texinfo].vecs
		// clamp center of light to corner and check brightness
		l = vec.dotProductV3(impact, texvecs[0]) + texvecs[0][3] - surf.texturemins[0];
		s = l + 0.5; if (s < 0) s = 0; else if (s > surf.extents[0]) s = surf.extents[0];
		s = l - s;
		l = vec.dotProductV3(impact, texvecs[1]) + texvecs[1][3] - surf.texturemins[1];
		t = l + 0.5; if (t < 0) t = 0; else if (t > surf.extents[1]) t = surf.extents[1];
		t = l - t;

		if ((s * s + t * t + dist * dist) >= maxdist)
			continue

		if (surf.dlightframe !== lm.state.dlightframecount) {
			surf.dlightbits[bit >> 5] = 1 << (bit & 31)
			surf.dlightframe = lm.state.dlightframecount;
		} else {
			surf.dlightbits[bit >> 5] |= 1 << (bit & 31)
		}
	}
	markLights(light, bit, _node.children[0]);
	markLights(light, bit, _node.children[1]);
};

export const pushDlights = () => {
	if (cvr.flashblend.value !== 0)
		return;

	lm.state.dlightframecount = state.framecount + 1
	for (var i = 0; i < cl.state.dlights.length; ++i) {
		var l = cl.state.dlights[i];
		if ((l.die >= cl.clState.time) && (l.radius !== 0.0)) {
			markLights(l, i, cl.clState.worldmodel.nodes[0])
		}
	}
};

export const recursiveLightPoint = function (node: Node, start: V3, end: V3): 0 | -1 | Color {
	if (node.contents < 0)
		return -1;

	var normal = node.plane.normal;
	var front = start[0] * normal[0] + start[1] * normal[1] + start[2] * normal[2] - node.plane.dist;
	var back = end[0] * normal[0] + end[1] * normal[1] + end[2] * normal[2] - node.plane.dist;
	var side = front < 0;

	if ((back < 0) === side)
		return recursiveLightPoint(node.children[side === true ? 1 : 0] as Node, start, end);

	var frac = front / (front - back);
	var mid: V3 = [
		start[0] + (end[0] - start[0]) * frac,
		start[1] + (end[1] - start[1]) * frac,
		start[2] + (end[2] - start[2]) * frac
	];

	var r = recursiveLightPoint(node.children[side === true ? 1 : 0] as Node, start, mid);
	if (r !== 0 && r !== -1)
		return r;

	if ((back < 0) === side)
		return -1;

	var i, surf, tex, s, t, ds, dt, lightmap, size, maps;
	for (i = 0; i < node.numfaces; ++i) {
		surf = cl.clState.worldmodel.faces[node.firstface + i];
		if ((surf.sky === true) || (surf.turbulent === true))
			continue;

		tex = cl.clState.worldmodel.texinfo[surf.texinfo];

		s = vec.dotProductV3(mid, tex.vecs[0]) + tex.vecs[0][3];
		t = vec.dotProductV3(mid, tex.vecs[1]) + tex.vecs[1][3];
		if ((s < surf.texturemins[0]) || (t < surf.texturemins[1]))
			continue;

		ds = s - surf.texturemins[0];
		dt = t - surf.texturemins[1];
		if ((ds > surf.extents[0]) || (dt > surf.extents[1]))
			continue;

		if (surf.lightofs === 0)
			return 0;

		ds >>= 4;
		dt >>= 4;

		lightmap = surf.lightofs;
		if (lightmap === 0)
			return 0;

		lightmap = surf.lightofs;
		if (lightmap === 0)
			return 0;

		lightmap += (dt * ((surf.extents[0] >> 4) + 1) + ds) * 3;
		r = [0, 0, 0];
		size = ((surf.extents[0] >> 4) + 1) * ((surf.extents[1] >> 4) + 1) * 3;
		for (maps = 0; maps < surf.styles.length; ++maps)
		{
				r = [
					r[0] + cl.clState.worldmodel.lightdata[lightmap] * lm.state.lightstylevalue[surf.styles[maps]],
					r[1] + cl.clState.worldmodel.lightdata[lightmap + 1] * lm.state.lightstylevalue[surf.styles[maps]],
					r[2] + cl.clState.worldmodel.lightdata[lightmap + 2] * lm.state.lightstylevalue[surf.styles[maps]],
				] 
			lightmap += size;
		}
		
		return [
			r[0] >> 8,
			r[1] >> 8,
			r[2] >> 8,
		]
	}
	return recursiveLightPoint(node.children[side !== true ? 1 : 0] as Node, mid, end);
};

export const lightPoint = function (p: V3): Color {
	if (cl.clState.worldmodel.lightdata == null){
		return [255, 255, 255];
	}
	
	const r = recursiveLightPoint(cl.clState.worldmodel.nodes[0] as Node, p, [p[0], p[1], p[2] - 2048.0]);
	
	if (r === -1 || r === 0) {
		return [0, 0, 0];
	}

	return r
};

// const cullBox = function(mins, maxs)
// {
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[0]) === 2)
// 		return true;
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[1]) === 2)
// 		return true;
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[2]) === 2)
// 		return true;
// 	if (vec.boxOnPlaneSide(mins, maxs, state.frustum[3]) === 2)
// 		return true;
// };

export const cullBox = function (emins: V3, emaxs: V3) {
	for (var i = 0; i < 4; i++) {
		var p = state.frustum[i];
		switch (p.signbits) {
			default:
			case 0:
				if (p.normal[0] * emaxs[0] + p.normal[1] * emaxs[1] + p.normal[2] * emaxs[2] < p.dist)
					return true;
				break;
			case 1:
				if (p.normal[0] * emins[0] + p.normal[1] * emaxs[1] + p.normal[2] * emaxs[2] < p.dist)
					return true;
				break;
			case 2:
				if (p.normal[0] * emaxs[0] + p.normal[1] * emins[1] + p.normal[2] * emaxs[2] < p.dist)
					return true;
				break;
			case 3:
				if (p.normal[0] * emins[0] + p.normal[1] * emins[1] + p.normal[2] * emaxs[2] < p.dist)
					return true;
				break;
			case 4:
				if (p.normal[0] * emaxs[0] + p.normal[1] * emaxs[1] + p.normal[2] * emins[2] < p.dist)
					return true;
				break;
			case 5:
				if (p.normal[0] * emins[0] + p.normal[1] * emaxs[1] + p.normal[2] * emins[2] < p.dist)
					return true;
				break;
			case 6:
				if (p.normal[0] * emaxs[0] + p.normal[1] * emins[1] + p.normal[2] * emins[2] < p.dist)
					return true;
				break;
			case 7:
				if (p.normal[0] * emins[0] + p.normal[1] * emins[1] + p.normal[2] * emins[2] < p.dist)
					return true;
				break;
		}
	}
	return false;
};

export const drawSpriteModel = function (e: Entity) {
	var program = GL.useProgram('Sprite', true);
	var num = e.frame;
	if ((num >= e.model.numframes) || (num < 0)) {
		con.dPrint('R.DrawSpriteModel: no such frame ' + num + '\n');
		num = 0;
	}
	var frame = e.model.frames[num] as SpriteFrame | SpriteFrameGroup;
	if (frame.group === true) {
		var fullinterval, targettime, i, time = cl.clState.time + e.syncbase;
		num = frame.frames.length - 1;
		fullinterval = frame.frames[num].interval;
		targettime = time - Math.floor(time / fullinterval) * fullinterval;
		for (i = 0; i < num; ++i) {
			if (frame.frames[i].interval > targettime)
				break;
		}
		frame = frame.frames[i];
	}

	tx.bind(program.textures.tTexture, frame.texturenum, true);
	var r = vec.emptyV3(), u = vec.emptyV3()
	if (e.model.oriented === true) {
		vec.angleVectors(e.angles, null, r, u);
	}
	else {
		r = state.vright;
		u = state.vup;
	}
	var p = e.origin;
	var x1 = frame.origin[0], y1 = frame.origin[1], x2 = x1 + frame.width, y2 = y1 + frame.height;

	GL.streamGetSpace(6);
	GL.streamWriteFloat3(
		p[0] + x1 * r[0] + y1 * u[0],
		p[1] + x1 * r[1] + y1 * u[1],
		p[2] + x1 * r[2] + y1 * u[2]);
	GL.streamWriteFloat2(0.0, 1.0);
	GL.streamWriteFloat3(
		p[0] + x1 * r[0] + y2 * u[0],
		p[1] + x1 * r[1] + y2 * u[1],
		p[2] + x1 * r[2] + y2 * u[2]);
	GL.streamWriteFloat2(0.0, 0.0);
	GL.streamWriteFloat3(
		p[0] + x2 * r[0] + y1 * u[0],
		p[1] + x2 * r[1] + y1 * u[1],
		p[2] + x2 * r[2] + y1 * u[2]);
	GL.streamWriteFloat2(1.0, 1.0);
	GL.streamWriteFloat3(
		p[0] + x2 * r[0] + y1 * u[0],
		p[1] + x2 * r[1] + y1 * u[1],
		p[2] + x2 * r[2] + y1 * u[2]);
	GL.streamWriteFloat2(1.0, 1.0);
	GL.streamWriteFloat3(
		p[0] + x1 * r[0] + y2 * u[0],
		p[1] + x1 * r[1] + y2 * u[1],
		p[2] + x1 * r[2] + y2 * u[2]);
	GL.streamWriteFloat2(0.0, 0.0);
	GL.streamWriteFloat3(
		p[0] + x2 * r[0] + y2 * u[0],
		p[1] + x2 * r[1] + y2 * u[1],
		p[2] + x2 * r[2] + y2 * u[2]);
	GL.streamWriteFloat2(1.0, 0.0);
};

state.avertexnormals = [
	[-0.525731, 0.0, 0.850651],
	[-0.442863, 0.238856, 0.864188],
	[-0.295242, 0.0, 0.955423],
	[-0.309017, 0.5, 0.809017],
	[-0.16246, 0.262866, 0.951056],
	[0.0, 0.0, 1.0],
	[0.0, 0.850651, 0.525731],
	[-0.147621, 0.716567, 0.681718],
	[0.147621, 0.716567, 0.681718],
	[0.0, 0.525731, 0.850651],
	[0.309017, 0.5, 0.809017],
	[0.525731, 0.0, 0.850651],
	[0.295242, 0.0, 0.955423],
	[0.442863, 0.238856, 0.864188],
	[0.16246, 0.262866, 0.951056],
	[-0.681718, 0.147621, 0.716567],
	[-0.809017, 0.309017, 0.5],
	[-0.587785, 0.425325, 0.688191],
	[-0.850651, 0.525731, 0.0],
	[-0.864188, 0.442863, 0.238856],
	[-0.716567, 0.681718, 0.147621],
	[-0.688191, 0.587785, 0.425325],
	[-0.5, 0.809017, 0.309017],
	[-0.238856, 0.864188, 0.442863],
	[-0.425325, 0.688191, 0.587785],
	[-0.716567, 0.681718, -0.147621],
	[-0.5, 0.809017, -0.309017],
	[-0.525731, 0.850651, 0.0],
	[0.0, 0.850651, -0.525731],
	[-0.238856, 0.864188, -0.442863],
	[0.0, 0.955423, -0.295242],
	[-0.262866, 0.951056, -0.16246],
	[0.0, 1.0, 0.0],
	[0.0, 0.955423, 0.295242],
	[-0.262866, 0.951056, 0.16246],
	[0.238856, 0.864188, 0.442863],
	[0.262866, 0.951056, 0.16246],
	[0.5, 0.809017, 0.309017],
	[0.238856, 0.864188, -0.442863],
	[0.262866, 0.951056, -0.16246],
	[0.5, 0.809017, -0.309017],
	[0.850651, 0.525731, 0.0],
	[0.716567, 0.681718, 0.147621],
	[0.716567, 0.681718, -0.147621],
	[0.525731, 0.850651, 0.0],
	[0.425325, 0.688191, 0.587785],
	[0.864188, 0.442863, 0.238856],
	[0.688191, 0.587785, 0.425325],
	[0.809017, 0.309017, 0.5],
	[0.681718, 0.147621, 0.716567],
	[0.587785, 0.425325, 0.688191],
	[0.955423, 0.295242, 0.0],
	[1.0, 0.0, 0.0],
	[0.951056, 0.16246, 0.262866],
	[0.850651, -0.525731, 0.0],
	[0.955423, -0.295242, 0.0],
	[0.864188, -0.442863, 0.238856],
	[0.951056, -0.16246, 0.262866],
	[0.809017, -0.309017, 0.5],
	[0.681718, -0.147621, 0.716567],
	[0.850651, 0.0, 0.525731],
	[0.864188, 0.442863, -0.238856],
	[0.809017, 0.309017, -0.5],
	[0.951056, 0.16246, -0.262866],
	[0.525731, 0.0, -0.850651],
	[0.681718, 0.147621, -0.716567],
	[0.681718, -0.147621, -0.716567],
	[0.850651, 0.0, -0.525731],
	[0.809017, -0.309017, -0.5],
	[0.864188, -0.442863, -0.238856],
	[0.951056, -0.16246, -0.262866],
	[0.147621, 0.716567, -0.681718],
	[0.309017, 0.5, -0.809017],
	[0.425325, 0.688191, -0.587785],
	[0.442863, 0.238856, -0.864188],
	[0.587785, 0.425325, -0.688191],
	[0.688191, 0.587785, -0.425325],
	[-0.147621, 0.716567, -0.681718],
	[-0.309017, 0.5, -0.809017],
	[0.0, 0.525731, -0.850651],
	[-0.525731, 0.0, -0.850651],
	[-0.442863, 0.238856, -0.864188],
	[-0.295242, 0.0, -0.955423],
	[-0.16246, 0.262866, -0.951056],
	[0.0, 0.0, -1.0],
	[0.295242, 0.0, -0.955423],
	[0.16246, 0.262866, -0.951056],
	[-0.442863, -0.238856, -0.864188],
	[-0.309017, -0.5, -0.809017],
	[-0.16246, -0.262866, -0.951056],
	[0.0, -0.850651, -0.525731],
	[-0.147621, -0.716567, -0.681718],
	[0.147621, -0.716567, -0.681718],
	[0.0, -0.525731, -0.850651],
	[0.309017, -0.5, -0.809017],
	[0.442863, -0.238856, -0.864188],
	[0.16246, -0.262866, -0.951056],
	[0.238856, -0.864188, -0.442863],
	[0.5, -0.809017, -0.309017],
	[0.425325, -0.688191, -0.587785],
	[0.716567, -0.681718, -0.147621],
	[0.688191, -0.587785, -0.425325],
	[0.587785, -0.425325, -0.688191],
	[0.0, -0.955423, -0.295242],
	[0.0, -1.0, 0.0],
	[0.262866, -0.951056, -0.16246],
	[0.0, -0.850651, 0.525731],
	[0.0, -0.955423, 0.295242],
	[0.238856, -0.864188, 0.442863],
	[0.262866, -0.951056, 0.16246],
	[0.5, -0.809017, 0.309017],
	[0.716567, -0.681718, 0.147621],
	[0.525731, -0.850651, 0.0],
	[-0.238856, -0.864188, -0.442863],
	[-0.5, -0.809017, -0.309017],
	[-0.262866, -0.951056, -0.16246],
	[-0.850651, -0.525731, 0.0],
	[-0.716567, -0.681718, -0.147621],
	[-0.716567, -0.681718, 0.147621],
	[-0.525731, -0.850651, 0.0],
	[-0.5, -0.809017, 0.309017],
	[-0.238856, -0.864188, 0.442863],
	[-0.262866, -0.951056, 0.16246],
	[-0.864188, -0.442863, 0.238856],
	[-0.809017, -0.309017, 0.5],
	[-0.688191, -0.587785, 0.425325],
	[-0.681718, -0.147621, 0.716567],
	[-0.442863, -0.238856, 0.864188],
	[-0.587785, -0.425325, 0.688191],
	[-0.309017, -0.5, 0.809017],
	[-0.147621, -0.716567, 0.681718],
	[-0.425325, -0.688191, 0.587785],
	[-0.16246, -0.262866, 0.951056],
	[0.442863, -0.238856, 0.864188],
	[0.16246, -0.262866, 0.951056],
	[0.309017, -0.5, 0.809017],
	[0.147621, -0.716567, 0.681718],
	[0.0, -0.525731, 0.850651],
	[0.425325, -0.688191, 0.587785],
	[0.587785, -0.425325, 0.688191],
	[0.688191, -0.587785, 0.425325],
	[-0.955423, 0.295242, 0.0],
	[-0.951056, 0.16246, 0.262866],
	[-1.0, 0.0, 0.0],
	[-0.850651, 0.0, 0.525731],
	[-0.955423, -0.295242, 0.0],
	[-0.951056, -0.16246, 0.262866],
	[-0.864188, 0.442863, -0.238856],
	[-0.951056, 0.16246, -0.262866],
	[-0.809017, 0.309017, -0.5],
	[-0.864188, -0.442863, -0.238856],
	[-0.951056, -0.16246, -0.262866],
	[-0.809017, -0.309017, -0.5],
	[-0.681718, 0.147621, -0.716567],
	[-0.681718, -0.147621, -0.716567],
	[-0.850651, 0.0, -0.525731],
	[-0.688191, 0.587785, -0.425325],
	[-0.587785, 0.425325, -0.688191],
	[-0.425325, 0.688191, -0.587785],
	[-0.425325, -0.688191, -0.587785],
	[-0.587785, -0.425325, -0.688191],
	[-0.688191, -0.587785, -0.425325]
];

export const drawAliasModel = function (e: Entity) {
	const gl = GL.getContext()
	var clmodel = e.model;

	if (cullBox(
		[
			e.origin[0] - clmodel.boundingradius,
			e.origin[1] - clmodel.boundingradius,
			e.origin[2] - clmodel.boundingradius
		],
		[
			e.origin[0] + clmodel.boundingradius,
			e.origin[1] + clmodel.boundingradius,
			e.origin[2] + clmodel.boundingradius
		]) === true)
		return;

	var program;
	if ((e.colormap !== 0) && (clmodel.player === true) && (cvr.nocolors.value === 0)) {
		program = GL.useProgram('Player');
		var top = (cl.clState.scores[e.colormap - 1].colors & 0xf0) + 4;
		var bottom = ((cl.clState.scores[e.colormap - 1].colors & 0xf) << 4) + 4;
		if (top <= 127)
			top += 7;
		if (bottom <= 127)
			bottom += 7;
		top = vid.d_8to24table[top];
		bottom = vid.d_8to24table[bottom];
		gl.uniform3f(program.uniforms.uTop, top & 0xff, (top >> 8) & 0xff, top >> 16);
		gl.uniform3f(program.uniforms.uBottom, bottom & 0xff, (bottom >> 8) & 0xff, bottom >> 16);
	}
	else
		program = GL.useProgram('Alias');
	gl.uniform3fv(program.uniforms.uOrigin, e.origin);
	gl.uniformMatrix3fv(program.uniforms.uAngles, false, GL.rotationMatrix(e.angles[0], e.angles[1], e.angles[2]));

	var ambientlight = lightPoint(e.origin);
	
	if (e === cl.clState.viewent)  {
		add = 72 - (ambientlight[0] + ambientlight[1] + ambientlight[2])
		if (add > 0) {
			ambientlight[0] += add / 3
			ambientlight[1] += add / 3
			ambientlight[2] += add / 3
		}
	}
	var i, dl, add;
	for (i = 0; i <= 31; ++i) {
		dl = cl.state.dlights[i];
		if (dl.die < cl.clState.time)
			continue;
		add = dl.radius - vec.length([e.origin[0] - dl.origin[0], e.origin[1] - dl.origin[1], e.origin[1] - dl.origin[1]]);
		if (add > 0.0) {
			ambientlight = vec.vectorMA(ambientlight, add, dl.color)
		}
	}

	var shadelight: Color = [...ambientlight]

	// // todo - full bright & overbright

	ambientlight[0] = ambientlight[0] > 128.0 ? 128.0 : ambientlight[0]
	ambientlight[1] = ambientlight[1] > 128.0 ? 128.0 : ambientlight[1]
	ambientlight[2] = ambientlight[2] > 128.0 ? 128.0 : ambientlight[2]

	shadelight[0] = ambientlight[0] + shadelight[0] > 192.0 ? 192.0 - ambientlight[0] : shadelight[0]
	shadelight[1] = ambientlight[1] + shadelight[1] > 192.0 ? 192.0 - ambientlight[1] : shadelight[1]
	shadelight[2] = ambientlight[2] + shadelight[2] > 192.0 ? 192.0 - ambientlight[2] : shadelight[2]

	// minimum light value on players (8)
	if ((e.num >= 1) && (e.num <= cl.clState.maxclients)) {
		add = 24.0 - (ambientlight[0] + ambientlight[1] + ambientlight[2]);
		if (add > 0.0) {
			ambientlight[0] += add / 3.0
			ambientlight[1] += add / 3.0
			ambientlight[2] += add / 3.0
			shadelight = [...ambientlight]
		}
	}
	gl.uniform3fv(program.uniforms.uAmbientLight, vec.multiplyScaler(ambientlight, 0.0078125));
	gl.uniform3fv(program.uniforms.uShadeLight, vec.multiplyScaler(shadelight, 0.0078125));

	var forward:V3 = [0,0,0], right:V3 = [0,0,0], up:V3 = [0,0,0];
	vec.angleVectors(e.angles, forward, right, up);
	gl.uniform3fv(program.uniforms.uLightVec, [
		vec.dotProductV3([-1.0, 0.0, 0.0], forward),
		-vec.dotProductV3([-1.0, 0.0, 0.0], right),
		vec.dotProductV3([-1.0, 0.0, 0.0], up)
	]);

	state.c_alias_polys += clmodel.numtris;

	var num, fullinterval, targettime, i;
	var time = cl.clState.time + e.syncbase;
	num = e.frame;
	if ((num >= clmodel.numframes) || (num < 0)) {
		con.dPrint('R.DrawAliasModel: no such frame ' + num + '\n');
		num = 0;
	}
	var frame = clmodel.frames[num] as AliasFrame | AliasFrameGroup;
	if (frame.group === true) {
		num = frame.frames.length - 1;
		fullinterval = frame.frames[num].interval;
		targettime = time - Math.floor(time / fullinterval) * fullinterval;
		for (i = 0; i < num; ++i) {
			if (frame.frames[i].interval > targettime)
				break;
		}
		frame = frame.frames[i];
	}
	gl.bindBuffer(gl.ARRAY_BUFFER, clmodel.cmds);
	gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, 24, frame.cmdofs);
	gl.vertexAttribPointer(program.attributeMap.aNormal.location, 3, gl.FLOAT, false, 24, frame.cmdofs + 12);
	gl.vertexAttribPointer(program.attributeMap.aTexCoord.location, 2, gl.FLOAT, false, 0, 0);

	num = e.skinnum;
	if ((num >= clmodel.numskins) || (num < 0)) {
		con.dPrint('R.DrawAliasModel: no such skin # ' + num + '\n');
		num = 0;
	}
	var skin = clmodel.skins[num];
	if (skin.group === true) {
		num = skin.skins.length - 1;
		fullinterval = skin.skins[num].interval;
		targettime = time - Math.floor(time / fullinterval) * fullinterval;
		for (i = 0; i < num; ++i) {
			if (skin.skins[i].interval > targettime)
				break;
		}
		skin = skin.skins[i];
	}
	tx.bind(program.textures.tTexture, skin.texturenum.texnum);
	if ((e.colormap !== 0) && (clmodel.player === true) && (cvr.nocolors.value === 0))
		tx.bind(program.textures.tPlayer, skin.playertexture);

	gl.drawArrays(gl.TRIANGLES, 0, clmodel.numtris * 3);
};

export const drawEntitiesOnList = function (alphaPass: boolean) {
	const gl = GL.getContext()

	if (cvr.drawentities.value === 0)
		return;
	var i, ent, entalpha
	for (i = 0; i < cl.state.numvisedicts; ++i) {
		ent = cl.state.visedicts[i];
		entalpha = pr.decodeAlpha(ent.alpha);
		if (ent.model == null || (entalpha === 1 && alphaPass))
			continue;
		switch (ent.model.type) {
			case mod.TYPE.alias:
				drawAliasModel(ent);
				continue;
			case mod.TYPE.brush:
				drawBrushModel(ent);
		}
	}

	if (!alphaPass) {
		GL.streamFlush();
		gl.depthMask(false);
		gl.enable(gl.BLEND);
		for (i = 0; i < cl.state.numvisedicts; ++i) {
			ent = cl.state.visedicts[i];
			if (ent.model == null)
				continue;
			if (ent.model.type === mod.TYPE.sprite)
				drawSpriteModel(ent);
		}
		GL.streamFlush();
		gl.disable(gl.BLEND);
		gl.depthMask(true);
	}
};

export const drawViewModel = function () {
	const gl = GL.getContext()
	if (cvr.drawviewmodel.value === 0)
		return;
	if (chase.cvr.active.value !== 0)
		return;
	if (cvr.drawentities.value === 0)
		return;
	if ((cl.clState.items & def.IT.invisibility) !== 0)
		return;
	if (cl.clState.stats[def.STAT.health] <= 0)
		return;
	if (cl.clState.viewent.model == null)
		return;

	gl.depthRange(0.0, 0.3);

	var ymax = 4.0 * Math.tan(scr.cvr.fov.value * 0.82 * Math.PI / 360.0);
	state.perspective[0] = 4.0 / (ymax * state.refdef.vrect.width / state.refdef.vrect.height);
	state.perspective[5] = 4.0 / ymax;
	var program = GL.useProgram('Alias');
	gl.uniformMatrix4fv(program.uniforms.uPerspective, false, state.perspective);

	drawAliasModel(cl.clState.viewent);

	ymax = 4.0 * Math.tan(state.refdef.fov_y * Math.PI / 360.0);
	state.perspective[0] = 4.0 / (ymax * state.refdef.vrect.width / state.refdef.vrect.height);
	state.perspective[5] = 4.0 / ymax;
	program = GL.useProgram('Alias');
	gl.uniformMatrix4fv(program.uniforms.uPerspective, false, state.perspective);

	gl.depthRange(0.0, 1.0);
};

export const polyBlend = function () {
	if (cvr.polyblend.value === 0)
		return;
	if (v.blend[3] === 0.0)
		return;
	GL.useProgram('Fill', true);
	var vrect = state.refdef.vrect;
	GL.streamDrawColoredQuad(vrect.x, vrect.y, vrect.width, vrect.height,
		v.blend[0], v.blend[1], v.blend[2], v.blend[3] * 255.0);
};

export const setFrustum = function () {
	state.frustum[0].normal = vec.rotatePointAroundVector(state.vup, state.vpn, -(90.0 - state.refdef.fov_x * 0.5));
	state.frustum[1].normal = vec.rotatePointAroundVector(state.vup, state.vpn, 90.0 - state.refdef.fov_x * 0.5);
	state.frustum[2].normal = vec.rotatePointAroundVector(state.vright, state.vpn, 90.0 - state.refdef.fov_y * 0.5);
	
	var i, out;
	for (i = 0; i <= 3; ++i) {
		out = state.frustum[i];
		out.type = 5;
		out.dist = vec.dotProductV3(state.refdef.vieworg, out.normal);
		out.signbits = 0;
		if (out.normal[0] < 0.0)
			out.signbits = 1;
		if (out.normal[1] < 0.0)
			out.signbits += 2;
		if (out.normal[2] < 0.0)
			out.signbits += 4;
	}
};


export const perspective = function () {
	const gl = GL.getContext()
	var viewangles = [
		state.refdef.viewangles[0] * Math.PI / 180.0,
		(state.refdef.viewangles[1] - 90.0) * Math.PI / -180.0,
		state.refdef.viewangles[2] * Math.PI / -180.0
	];
	var sp = Math.sin(viewangles[0]);
	var cp = Math.cos(viewangles[0]);
	var sy = Math.sin(viewangles[1]);
	var cy = Math.cos(viewangles[1]);
	var sr = Math.sin(viewangles[2]);
	var cr = Math.cos(viewangles[2]);
	var viewMatrix = [
		cr * cy + sr * sp * sy, cp * sy, -sr * cy + cr * sp * sy,
		cr * -sy + sr * sp * cy, cp * cy, -sr * -sy + cr * sp * cy,
		sr * cp, -sp, cr * cp
	];

	if (v.cvr.gamma.value < 0.2)
		cvar.setValue('gamma', 0.2);
	else if (v.cvr.gamma.value > 1.0)
		cvar.setValue('gamma', 1.0);

	GL.unbindProgram();
	var i, program;
	for (i = 0; i < GL.state.programs.length; ++i) {
		program = GL.state.programs[i];
		gl.useProgram(program.program);
		if (program.uniforms.uViewOrigin != null)
			gl.uniform3fv(program.uniforms.uViewOrigin, state.refdef.vieworg);
		if (program.uniforms.uViewAngles != null)
			gl.uniformMatrix3fv(program.uniforms.uViewAngles, false, viewMatrix);
		if (program.uniforms.uPerspective != null)
			gl.uniformMatrix4fv(program.uniforms.uPerspective, false, state.perspective);
		if (program.uniforms.uGamma != null)
			gl.uniform1f(program.uniforms.uGamma, v.cvr.gamma.value);
	}
};

export const setupGL = function () {
	const gl = GL.getContext()
	if (state.dowarp === true) {
		gl.bindFramebuffer(gl.FRAMEBUFFER, state.warpbuffer);
		gl.clear(gl.COLOR_BUFFER_BIT + gl.DEPTH_BUFFER_BIT);
		gl.viewport(0, 0, state.warpwidth, state.warpheight);
	}
	else {
		var vrect = state.refdef.vrect;
		var pixelRatio = scr.state.devicePixelRatio;
		gl.viewport((vrect.x * pixelRatio) >> 0, ((vid.state.height - vrect.height - vrect.y) * pixelRatio) >> 0, (vrect.width * pixelRatio) >> 0, (vrect.height * pixelRatio) >> 0);
	}
	perspective();
	gl.enable(gl.DEPTH_TEST);
};

// let array = []
// let lastREport = 0
// const perf = (start, end) => {
// 	let ms = end - start
// 	if(array.length> 50) {
// 		array.pop()
// 	}
// 	array.push(ms)
// 	if (end - lastREport > 1000) {
// 		lastREport = end
// 		console.log('Performance: ' + ((array.reduce((partialSum, a) => partialSum + a, 0)) / array.length).toFixed(2))
// 	}
// }
export const renderScene = function () {
	const gl = GL.getContext()
	animateLight();
	vec.angleVectors(state.refdef.viewangles, state.vpn, state.vright, state.vup);
	state.viewleaf = mod.pointInLeaf(state.refdef.vieworg, cl.clState.worldmodel);
	v.setContentsColor(state.viewleaf.contents);
	v.calcBlend();
	state.dowarp = (cvr.waterwarp.value !== 0) && (state.viewleaf.contents <= mod.CONTENTS.water);
	setFrustum();
	setupGL();
	markSurfaces();
	cullSurfaces(cl.clState.worldmodel, TexChain.world)
	gl.enable(gl.CULL_FACE);
	drawSkyBox();
	drawViewModel();
	drawTextureChains(gl, cl.clState.worldmodel, null, TexChain.world);
	drawEntitiesOnList(false);
	drawTextureChains_water(gl, cl.clState.worldmodel, null, TexChain.world);
	drawEntitiesOnList(true);
	gl.disable(gl.CULL_FACE);
	renderDlights();
	drawParticles();
};

export const renderView = function () {
	const gl = GL.getContext()
	gl.finish();
	var time1;
	if (cvr.speeds.value !== 0)
		time1 = sys.floatTime();
	state.c_brush_verts = 0;
	state.c_alias_polys = 0;
	gl.clear(gl.COLOR_BUFFER_BIT + gl.DEPTH_BUFFER_BIT);
	renderScene();
	if (cvr.speeds.value !== 0) {
		var time2 = Math.floor((sys.floatTime() - time1) * 1000.0);
		var c_brush_polys = state.c_brush_verts / 3;
		var c_alias_polys = state.c_alias_polys;
		var message = ((time2 >= 100) ? '' : ((time2 >= 10) ? ' ' : '  ')) + time2 + ' ms  ';
		message += ((c_brush_polys >= 1000) ? '' : ((c_brush_polys >= 100) ? ' ' : ((c_brush_polys >= 10) ? '  ' : '   '))) + c_brush_polys + ' wpoly ';
		message += ((c_alias_polys >= 1000) ? '' : ((c_alias_polys >= 100) ? ' ' : ((c_alias_polys >= 10) ? '  ' : '   '))) + c_alias_polys + ' epoly\n';
		con.print(message);
	}
};

// misc

export const initTextures = function () {
	const gl = GL.getContext()
	var data = new Uint8Array(new ArrayBuffer(256));
	var i, j;
	for (i = 0; i < 8; ++i) {
		for (j = 0; j < 8; ++j) {
			data[(i << 4) + j] = data[136 + (i << 4) + j] = 255;
			data[8 + (i << 4) + j] = data[128 + (i << 4) + j] = 0;
		}
	}
	state.notexture_mip = tx.createNoTexture(gl)
	tx.bind(0, state.notexture_mip.texturenum);
	tx.upload(data, 16, 16);

	state.solidskytexture = gl.createTexture();
	tx.bind(0, state.solidskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	state.alphaskytexture = gl.createTexture();
	tx.bind(0, state.alphaskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

	state.null_texture = gl.createTexture();
	tx.bind(0, state.null_texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
};

export const init = function () {
	const gl = GL.getContext()
	batchRender.init(gl)
	initTextures();

	cmd.addCommand('timerefresh', timeRefresh_f);
	cmd.addCommand('pointfile', readPointFile_f);

	cvr.waterwarp = cvar.registerVariable('r_waterwarp', '1');
	cvr.fullbright = cvar.registerVariable('r_fullbright', '0');
	cvr.drawentities = cvar.registerVariable('r_drawentities', '1');
	cvr.drawviewmodel = cvar.registerVariable('r_drawviewmodel', '1');
	cvr.novis = cvar.registerVariable('r_novis', '0');
	cvr.speeds = cvar.registerVariable('r_speeds', '0');
	cvr.polyblend = cvar.registerVariable('gl_polyblend', '1');
	cvr.flashblend = cvar.registerVariable('gl_flashblend', '0');
	cvr.nocolors = cvar.registerVariable('gl_nocolors', '0');
	cvr.overbright = cvar.registerVariable('gl_overbright', '0');
	cvr.fullbrights = cvar.registerVariable('gl_fullbrights', '1');
	cvr.oldskyleaf = cvar.registerVariable('oldskyleaf', '0')
	cvr.flatlightstyles = cvar.registerVariable('r_flatlightstyles', '0')
  cvr.wateralpha = cvar.registerVariable('r_wateralpha', '1')
  cvr.lavaalpha = cvar.registerVariable('r_lavaalpha', '0')
  cvr.telealpha = cvar.registerVariable('r_telealpha', '0')
  cvr.slimealpha = cvar.registerVariable('r_slimealpha', '0')
  cvr.dynamic = cvar.registerVariable('r_dynamic', '1')
  cvr.test = cvar.registerVariable('r_test', '0')

	cvar.registerChangedEvent('r_novis', () => state.vis_changed = true)
	
	initParticles();

	GL.createProgram('Alias',
		['uOrigin', 'uAngles', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uLightVec', 'uGamma', 'uAmbientLight', 'uShadeLight'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3), 
			createAttribParam('aNormal', gl.FLOAT, 3), 
			createAttribParam('aTexCoord', gl.FLOAT, 2)
		],
		['tTexture']);

	GL.createProgram(
		'Brush',
		['uUseFullbrightTex', 'uUseOverbright', 'uUseAlphaTest',
			'uAlpha', 'uPerspective', 'uViewAngles', 'uViewOrigin',
			'uOrigin', 'uAngles', 'uFogDensity', 'uFogColor', 'uGamma'],
		[
			createAttribParam('Vert', gl.FLOAT, 3, false),
			createAttribParam('TexCoords', gl.FLOAT, 2, false),
			createAttribParam('LMCoords', gl.FLOAT, 2, false),
		],
		['Tex', 'LMTex', 'FullbrightTex'])
	GL.createProgram('Dlight',
		['uOrigin', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uRadius', 'uGamma'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3)
		],
		[]);
	GL.createProgram('Player',
		['uOrigin', 'uAngles', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uLightVec', 'uGamma', 'uAmbientLight', 'uShadeLight', 'uTop', 'uBottom'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3), 
			createAttribParam('aNormal', gl.FLOAT, 3), 
			createAttribParam('aTexCoord', gl.FLOAT, 2)
		],
		['tTexture', 'tPlayer']);
	GL.createProgram('Sprite',
		['uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3),
			createAttribParam('aTexCoord', gl.FLOAT, 2)
		],
		['tTexture']);
	GL.createProgram('Turbulent',
		['uOrigin', 'uAngles', 'uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma', 'uTime', 'uAlpha'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3), 
			createAttribParam('aTexCoord', gl.FLOAT, 2)
		],
		['tTexture']);
	GL.createProgram('Warp',
		['uOrtho', 'uTime'],
		[
			createAttribParam('aPosition', gl.FLOAT, 2), 
			createAttribParam('aTexCoord', gl.FLOAT, 2)
		],
		['tTexture']);

	state.warpbuffer = gl.createFramebuffer();
	state.warptexture = gl.createTexture();
	tx.bind(0, state.warptexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	state.warprenderbuffer = gl.createRenderbuffer();
	gl.bindRenderbuffer(gl.RENDERBUFFER, state.warprenderbuffer);
	gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, 0, 0);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	gl.bindFramebuffer(gl.FRAMEBUFFER, state.warpbuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, state.warptexture, 0);
	gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, state.warprenderbuffer);
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);

	state.dlightvecs = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.dlightvecs);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
		0.0, -1.0, 0.0,
		0.0, 0.0, 1.0,
		-0.382683, 0.0, 0.92388,
		-0.707107, 0.0, 0.707107,
		-0.92388, 0.0, 0.382683,
		-1.0, 0.0, 0.0,
		-0.92388, 0.0, -0.382683,
		-0.707107, 0.0, -0.707107,
		-0.382683, 0.0, -0.92388,
		0.0, 0.0, -1.0,
		0.382683, 0.0, -0.92388,
		0.707107, 0.0, -0.707107,
		0.92388, 0.0, -0.382683,
		1.0, 0.0, 0.0,
		0.92388, 0.0, 0.382683,
		0.707107, 0.0, 0.707107,
		0.382683, 0.0, 0.92388,
		0.0, 0.0, 1.0
	]), gl.STATIC_DRAW);

	makeSky();
};

export const newMap = function () {
	const gl = GL.getContext()
	var i;
	for (i = 0; i < 64; ++i)
		lm.state.lightstylevalue[i] = 264;

	clearParticles();
	lm.init()
	mapAlpha.parseWorldspawn()
	fog.parseWorldspawn()

	for (i = 1; i < cl.clState.model_precache.length; ++i) {
		var model = cl.clState.model_precache[i];
		if (model.type !== mod.TYPE.brush)
			continue;
		if (model.name.charCodeAt(0) !== 42) {
			lm.buildLightmaps(gl, model);
			buildSurfaceDisplayLists(model)
		}
	}

	buildModelVertexBuffer(gl)
};

export const timeRefresh_f = function () {
	const gl = GL.getContext()
	gl.finish();
	var i;
	var start = sys.floatTime();
	for (i = 0; i <= 127; ++i) {
		state.refdef.viewangles[1] = i * 2.8125;
		renderView();
	}
	gl.finish();
	var time = sys.floatTime() - start;
	con.print(time.toFixed(6) + ' seconds (' + (128.0 / time).toFixed(6) + ' fps)\n');
};

// part

const PTYPE = {
	tracer: 0,
	grav: 1,
	slowgrav: 2,
	fire: 3,
	explode: 4,
	explode2: 5,
	blob: 6,
	blob2: 7
};

state.ramp1 = [0x6f, 0x6d, 0x6b, 0x69, 0x67, 0x65, 0x63, 0x61];
state.ramp2 = [0x6f, 0x6e, 0x6d, 0x6c, 0x6b, 0x6a, 0x68, 0x66];
state.ramp3 = [0x6d, 0x6b, 6, 5, 4, 3];

export const initParticles = function () {
	const gl = GL.getContext()
	var i = com.checkParm('-particles');
	if (i != null) {
		state.numparticles = q.atoi(com.state.argv[i + 1]);
		if (state.numparticles < 512)
			state.numparticles = 512;
	}
	else
		state.numparticles = 2048;

	state.avelocities = [];
	for (i = 0; i <= 161; ++i)
		state.avelocities[i] = [Math.random() * 2.56, Math.random() * 2.56, Math.random() * 2.56];

	GL.createProgram('Particle',
		['uViewOrigin', 'uViewAngles', 'uPerspective', 'uGamma'],
		[
			createAttribParam('aOrigin', gl.FLOAT, 3),
			createAttribParam('aCoord', gl.FLOAT, 2), 
			createAttribParam('aScale', gl.FLOAT, 1), 
			createAttribParam('aColor', gl.UNSIGNED_BYTE, 3, true)
		],
		[]);
};

export const entityParticles = function (ent: Entity) {
	var allocated = allocParticles(162), i;
	var angle, sp, sy, cp, cy, forward = [];
	for (i = 0; i < allocated.length; ++i) {
		angle = cl.clState.time * state.avelocities[i][0];
		sp = Math.sin(angle);
		cp = Math.cos(angle);
		angle = cl.clState.time * state.avelocities[i][1];
		sy = Math.sin(angle);
		cy = Math.cos(angle);

		state.particles[allocated[i]] = {
			die: cl.clState.time + 0.01,
			color: 0x6f,
			ramp: 0.0,
			type: PTYPE.explode,
			org: [
				ent.origin[0] + state.avertexnormals[i][0] * 64.0 + cp * cy * 16.0,
				ent.origin[1] + state.avertexnormals[i][1] * 64.0 + cp * sy * 16.0,
				ent.origin[2] + state.avertexnormals[i][2] * 64.0 + sp * -16.0
			],
			vel: [0.0, 0.0, 0.0]
		};
	}
};

export const clearParticles = function () {
	var i;
	state.particles = [];
	for (i = 0; i < state.numparticles; ++i)
		state.particles[i] = { die: -1.0 };
};

export const readPointFile_f = async function () {
	if (sv.state.server.active !== true)
		return;
	var name = 'maps/' + pr.getString(pr.state.globals_int[pr.globalvars.mapname]) + '.pts';
	var f = await com.loadTextFile(name);
	if (f == null) {
		con.print('couldn\'t open ' + name + '\n');
		return;
	}
	con.print('Reading ' + name + '...\n');
	var flines = f.split('\n');
	var c, org, p;
	for (c = 0; c < flines.length;) {
		org = flines[c].split(' ');
		if (org.length !== 3)
			break;
		++c;
		p = allocParticles(1);
		if (p.length === 0) {
			con.print('Not enough free particles\n');
			break;
		}
		state.particles[p[0]] = {
			die: 99999.0,
			color: -c & 15,
			type: PTYPE.tracer,
			vel: [0.0, 0.0, 0.0],
			org: [q.atof(org[0]), q.atof(org[1]), q.atof(org[2])],
			ramp: 0
		};
	}
	con.print(c + ' points read\n');
};

export const parseParticleEffect = function () {
	var org: V3 = [msg.readCoord(), msg.readCoord(), msg.readCoord()];
	var dir: V3 = [msg.readChar() * 0.0625, msg.readChar() * 0.0625, msg.readChar() * 0.0625];
	var msgcount = msg.readByte();
	var color = msg.readByte();
	if (msgcount === 255)
		particleExplosion(org);
	else
		runParticleEffect(org, dir, color, msgcount);
};

export const particleExplosion = function (org: V3) {
	var allocated = allocParticles(1024), i;
	for (i = 0; i < allocated.length; ++i) {
		state.particles[allocated[i]] = {
			die: cl.clState.time + 5.0,
			color: state.ramp1[0],
			ramp: Math.floor(Math.random() * 4.0),
			type: ((i & 1) !== 0) ? PTYPE.explode : PTYPE.explode2,
			org: [
				org[0] + Math.random() * 32.0 - 16.0,
				org[1] + Math.random() * 32.0 - 16.0,
				org[2] + Math.random() * 32.0 - 16.0
			],
			vel: [Math.random() * 512.0 - 256.0, Math.random() * 512.0 - 256.0, Math.random() * 512.0 - 256.0]
		};
	}
};

export const particleExplosion2 = function (org: V3, colorStart: number, colorLength: number) {
	var allocated = allocParticles(512), i, colorMod = 0;
	for (i = 0; i < allocated.length; ++i) {
		state.particles[allocated[i]] = {
			die: cl.clState.time + 0.3,
			color: colorStart + (colorMod++ % colorLength),
			type: PTYPE.blob,
			org: [
				org[0] + Math.random() * 32.0 - 16.0,
				org[1] + Math.random() * 32.0 - 16.0,
				org[2] + Math.random() * 32.0 - 16.0
			],
			ramp: 0,
			vel: [Math.random() * 512.0 - 256.0, Math.random() * 512.0 - 256.0, Math.random() * 512.0 - 256.0]
		};
	}
};

export const blobExplosion = function (org: V3) {
	var allocated = allocParticles(1024), i, p;
	for (i = 0; i < allocated.length; ++i) {
		p = state.particles[allocated[i]] as Particle;
		p.die = cl.clState.time + 1.0 + Math.random() * 0.4;
		if ((i & 1) !== 0) {
			p.type = PTYPE.blob;
			p.color = 66 + Math.floor(Math.random() * 7.0);
		}
		else {
			p.type = PTYPE.blob2;
			p.color = 150 + Math.floor(Math.random() * 7.0);
		}
		p.org = [
			org[0] + Math.random() * 32.0 - 16.0,
			org[1] + Math.random() * 32.0 - 16.0,
			org[2] + Math.random() * 32.0 - 16.0
		];
		p.vel = [Math.random() * 512.0 - 256.0, Math.random() * 512.0 - 256.0, Math.random() * 512.0 - 256.0];
	}
};

export const runParticleEffect = function (org: V3, dir: V3, color: number, count: number) {
	var allocated = allocParticles(count), i;
	for (i = 0; i < allocated.length; ++i) {
		state.particles[allocated[i]] = {
			die: cl.clState.time + 0.6 * Math.random(),
			color: (color & 0xf8) + Math.floor(Math.random() * 8.0),
			type: PTYPE.slowgrav,
			org: [
				org[0] + Math.random() * 16.0 - 8.0,
				org[1] + Math.random() * 16.0 - 8.0,
				org[2] + Math.random() * 16.0 - 8.0
			],
			ramp: 0,
			vel: [dir[0] * 15.0, dir[1] * 15.0, dir[2] * 15.0]
		};
	}
};

export const lavaSplash = function (org: V3) {
	var allocated = allocParticles(1024), i: number, j: number, k = 0, p;
	var dir = vec.emptyV3(), vel;
	for (i = -16; i <= 15; ++i) {
		for (j = -16; j <= 15; ++j) {
			if (k >= allocated.length)
				return;
			p = state.particles[allocated[k++]] as Particle;
			p.die = cl.clState.time + 2.0 + Math.random() * 0.64;
			p.color = 224 + Math.floor(Math.random() * 8.0);
			p.type = PTYPE.slowgrav;
			dir[0] = (j + Math.random()) * 8.0;
			dir[1] = (i + Math.random()) * 8.0;
			dir[2] = 256.0;
			p.org = [org[0] + dir[0], org[1] + dir[1], org[2] + Math.random() * 64.0];
			vec.normalize(dir);
			vel = 50.0 + Math.random() * 64.0;
			p.vel = [dir[0] * vel, dir[1] * vel, dir[2] * vel];
		}
	}
};

export const teleportSplash = function (org: V3) {
	var allocated = allocParticles(896), i, j, k, l = 0, p;
	var dir = vec.emptyV3(), vel;
	for (i = -16; i <= 15; i += 4) {
		for (j = -16; j <= 15; j += 4) {
			for (k = -24; k <= 31; k += 4) {
				if (l >= allocated.length)
					return;
				p = state.particles[allocated[l++]] as Particle;
				p.die = cl.clState.time + 0.2 + Math.random() * 0.16;
				p.color = 7 + Math.floor(Math.random() * 8.0);
				p.type = PTYPE.slowgrav;
				dir[0] = j * 8.0;
				dir[1] = i * 8.0;
				dir[2] = k * 8.0;
				p.org = [
					org[0] + i + Math.random() * 4.0,
					org[1] + j + Math.random() * 4.0,
					org[2] + k + Math.random() * 4.0
				];
				vec.normalize(dir);
				vel = 50.0 + Math.random() * 64.0;
				p.vel = [dir[0] * vel, dir[1] * vel, dir[2] * vel];
			}
		}
	}
};

export const rocketTrail = function (start: V3, end: V3, type: number) {
	var _vec = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
	var len = Math.sqrt(_vec[0] * _vec[0] + _vec[1] * _vec[1] + _vec[2] * _vec[2]);
	if (len === 0.0)
		return;
	_vec = [_vec[0] / len, _vec[1] / len, _vec[2] / len];

	var allocated;
	if (type === 4)
		allocated = allocParticles(Math.floor(len / 6.0));
	else
		allocated = allocParticles(Math.floor(len / 3.0));

	var i, p;
	for (i = 0; i < allocated.length; ++i) {
		p = state.particles[allocated[i]] as Particle;
		p.vel = [0.0, 0.0, 0.0];
		p.die = cl.clState.time + 2.0;
		switch (type) {
			case 0:
			case 1:
				p.ramp = Math.floor(Math.random() * 4.0) + (type << 1);
				p.color = state.ramp3[p.ramp];
				p.type = PTYPE.fire;
				p.org = [
					start[0] + Math.random() * 6.0 - 3.0,
					start[1] + Math.random() * 6.0 - 3.0,
					start[2] + Math.random() * 6.0 - 3.0
				];
				break;
			case 2:
				p.type = PTYPE.grav;
				p.color = 67 + Math.floor(Math.random() * 4.0);
				p.org = [
					start[0] + Math.random() * 6.0 - 3.0,
					start[1] + Math.random() * 6.0 - 3.0,
					start[2] + Math.random() * 6.0 - 3.0
				];
				break;
			case 3:
			case 5:
				p.die = cl.clState.time + 0.5;
				p.type = PTYPE.tracer;
				if (type === 3)
					p.color = 52 + ((state.tracercount++ & 4) << 1);
				else
					p.color = 230 + ((state.tracercount++ & 4) << 1);
				p.org = [start[0], start[1], start[2]];
				if ((state.tracercount & 1) !== 0) {
					p.vel[0] = 30.0 * _vec[1];
					p.vel[2] = -30.0 * _vec[0];
				}
				else {
					p.vel[0] = -30.0 * _vec[1];
					p.vel[2] = 30.0 * _vec[0];
				}
				break;
			case 4:
				p.type = PTYPE.grav;
				p.color = 67 + Math.floor(Math.random() * 4.0);
				p.org = [
					start[0] + Math.random() * 6.0 - 3.0,
					start[1] + Math.random() * 6.0 - 3.0,
					start[2] + Math.random() * 6.0 - 3.0
				];
				break;
			case 6:
				p.color = 152 + Math.floor(Math.random() * 4.0);
				p.type = PTYPE.tracer;
				p.die = cl.clState.time + 0.3;
				p.org = [
					start[0] + Math.random() * 16.0 - 8.0,
					start[1] + Math.random() * 16.0 - 8.0,
					start[2] + Math.random() * 16.0 - 8.0
				];
		}
		start[0] += _vec[0];
		start[1] += _vec[1];
		start[2] += _vec[2];
	}
};

export const drawParticles = function () {
	const gl = GL.getContext()
	GL.streamFlush();

	var program = GL.useProgram('Particle');
	gl.depthMask(false);
	gl.enable(gl.BLEND);

	var frametime = cl.clState.time - cl.clState.oldtime;
	var grav = frametime * sv.cvr.gravity.value * 0.05;
	var dvel = frametime * 4.0;
	var scale;

	var coords = [-1.0, -1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
	for (var i = 0; i < state.numparticles; ++i) {
		var p = state.particles[i] as Particle;
		if (p.die < cl.clState.time)
			continue;

		var color = vid.d_8to24table[p.color];
		scale = (p.org[0] - state.refdef.vieworg[0]) * state.vpn[0]
			+ (p.org[1] - state.refdef.vieworg[1]) * state.vpn[1]
			+ (p.org[2] - state.refdef.vieworg[2]) * state.vpn[2];
		if (scale < 20.0)
			scale = 0.375;
		else
			scale = 0.375 + scale * 0.0015;

		GL.streamGetSpace(6);
		for (var j = 0; j < 6; ++j) {
			GL.streamWriteFloat3(p.org[0], p.org[1], p.org[2]);
			GL.streamWriteFloat2(coords[j * 2], coords[j * 2 + 1]);
			GL.streamWriteFloat(scale);
			GL.streamWriteUByte4(color & 0xff, (color >> 8) & 0xff, color >> 16, 255);
		}

		p.org[0] += p.vel[0] * frametime;
		p.org[1] += p.vel[1] * frametime;
		p.org[2] += p.vel[2] * frametime;

		switch (p.type) {
			case PTYPE.fire:
				p.ramp += frametime * 5.0;
				if (p.ramp >= 6.0)
					p.die = -1.0;
				else
					p.color = state.ramp3[Math.floor(p.ramp)];
				p.vel[2] += grav;
				continue;
			case PTYPE.explode:
				p.ramp += frametime * 10.0;
				if (p.ramp >= 8.0)
					p.die = -1.0;
				else
					p.color = state.ramp1[Math.floor(p.ramp)];
				p.vel[0] += p.vel[0] * dvel;
				p.vel[1] += p.vel[1] * dvel;
				p.vel[2] += p.vel[2] * dvel - grav;
				continue;
			case PTYPE.explode2:
				p.ramp += frametime * 15.0;
				if (p.ramp >= 8.0)
					p.die = -1.0;
				else
					p.color = state.ramp2[Math.floor(p.ramp)];
				p.vel[0] -= p.vel[0] * frametime;
				p.vel[1] -= p.vel[1] * frametime;
				p.vel[2] -= p.vel[2] * frametime + grav;
				continue;
			case PTYPE.blob:
				p.vel[0] += p.vel[0] * dvel;
				p.vel[1] += p.vel[1] * dvel;
				p.vel[2] += p.vel[2] * dvel - grav;
				continue;
			case PTYPE.blob2:
				p.vel[0] += p.vel[0] * dvel;
				p.vel[1] += p.vel[1] * dvel;
				p.vel[2] -= grav;
				continue;
			case PTYPE.grav:
			case PTYPE.slowgrav:
				p.vel[2] -= grav;
		}
	}

	GL.streamFlush();

	gl.disable(gl.BLEND);
	gl.depthMask(true);
};

export const allocParticles = function (count: number) {
	var allocated = [], i;
	for (i = 0; i < state.numparticles; ++i) {
		if (count === 0)
			return allocated;
		if (state.particles[i].die < cl.clState.time) {
			allocated[allocated.length] = i;
			--count;
		}
	}
	return allocated;
};

// surf

state.lightmap_modified = [];

const backFaceCull = (surf: Face) => {
	var dot

	switch (surf.plane.type) {
		case def.PLANE.x:
			dot = state.refdef.vieworg[0] - surf.plane.dist;
			break;
		case def.PLANE.y:
			dot = state.refdef.vieworg[1] - surf.plane.dist;
			break;
		case def.PLANE.z:
			dot = state.refdef.vieworg[2] - surf.plane.dist;
			break;
		default:
			dot = vec.dotProductV3(state.refdef.vieworg, surf.plane.normal) - surf.plane.dist;
			break;
	}

	if ((dot < 0) !== !!(surf.flags & def.SURF.planeback))
		return true;

	return false;
}

const cullSurfaces = (model: Model, chain: TexChain) => {
	var i, s, t: Texture
	// ericw -- instead of testing (s->visframe == r_visframecount) on all world
	// surfaces, use the chained surfaces, which is exactly the same set of sufaces
	for (i = 0; i < model.textures.length; i++) {
		t = model.textures[i];

		if (!t || !t.texturechains || !t.texturechains[chain])
			continue;

		for (s = t.texturechains[chain]; s; s = s.texturechain) { 
			if (cullBox(s.mins, s.maxs) && backFaceCull(s)) 
				s.culled = true;
			else {
				s.culled = false;
				// rs_brushpolys++; //count wpolys here // TODO stats
				const texture = model.textures[model.texinfo[s.texinfo].texture]
				if (texture.warpimage)
					texture.update_warp = true;
			}
		}
	}
}

export const textureAnimation = function (model: Model, base: Texture, entFrame: number) {
	var frame = 0;
	if (base.anim_base != null) {
		frame = base.anim_frame;
		base = model.textures[base.anim_base];
	}
	var anims = base.anims;
	if (anims == null)
		return base;
	if ((entFrame !== 0) && (base.alternate_anims.length !== 0))
		anims = base.alternate_anims;
	return model.textures[anims[(Math.floor(cl.clState.time * 5.0) + frame) % anims.length]];
};

const clearTextureChains = (model: Model, chain: TexChain) => {
	// set all chains to null
	for (var i = 0; i < model.textures.length; i++)
		if (model.textures[i] && model.textures[i].texturechains)
			model.textures[i].texturechains[chain] = null;
}

export const drawBrushModel = function (e: Entity) {
	const gl = GL.getContext()
	var clmodel = e.model;

	if (clmodel.submodel === true) {
		if (cullBox(
			[
				e.origin[0] + clmodel.mins[0],
				e.origin[1] + clmodel.mins[1],
				e.origin[2] + clmodel.mins[2]
			],
			[
				e.origin[0] + clmodel.maxs[0],
				e.origin[1] + clmodel.maxs[1],
				e.origin[2] + clmodel.maxs[2]
			]) === true)
			return;
	}
	else {
		if (cullBox(
			[
				e.origin[0] - clmodel.radius,
				e.origin[1] - clmodel.radius,
				e.origin[2] - clmodel.radius
			],
			[
				e.origin[0] + clmodel.radius,
				e.origin[1] + clmodel.radius,
				e.origin[2] + clmodel.radius
			]) === true)
			return;
	}

	clearTextureChains(clmodel, TexChain.model);
	var modelOrg = vec.subtract(state.refdef.vieworg, e.origin)
	if (e.angles[0] || e.angles[1] || e.angles[2]) {
		var temp = vec.emptyV3()
		var forward = vec.emptyV3(), right = vec.emptyV3(), up = vec.emptyV3()
		vec.copy(modelOrg, temp)

		vec.angleVectors(e.angles, forward, right, up);
		modelOrg[0] = vec.dotProductV3(temp, forward);
		modelOrg[1] = -vec.dotProductV3(temp, right);
		modelOrg[2] = vec.dotProductV3(temp, up);
	}
	// firstmodelsurface is not used TODO: Joe Should this be the "first face" on a submodel
	// if (clmodel.firstmodelsurface != 0 && !cvr.flashblend.value) {
	// 	for (var k = 0; k < cl.state.dlights.length; k++) {
	// 		if ((cl.state.dlights[k].die < cl.clState.time) ||
	// 			(!cl.state.dlights[k].radius))
	// 			continue;

	// 		markLights(cl.state.dlights[k], k, cl.clState.worldmodel.nodes[clmodel.hulls[0].firstclipnode]);
	// 	}
	// }

	for (var i = 0; i < clmodel.numfaces; i++) {
		var surf = clmodel.faces[clmodel.firstface + i]
		var pplane = surf.plane;
		var dot = vec.dotProductV3(modelOrg, pplane.normal) - pplane.dist;
		if (((surf.flags & def.SURF.planeback) && (dot < -0.01)) ||
			(!(surf.flags & def.SURF.planeback) && (dot > 0.01))) {
			chainSurface(clmodel, surf, TexChain.model);
		}
	}

	drawTextureChains(gl, e.model, e, TexChain.model)
	drawTextureChains_water(gl, e.model, e, TexChain.model)
};

export const recursiveWorldNode = function (node: NodeLeaf) {
	if (node.contents === mod.CONTENTS.solid)
		return;
	if (node.contents < 0) {
		const leaf = node as Leaf
		if (leaf.markvisframe !== state.visframecount)
			return;
		leaf.visframe = state.visframecount;
		if (leaf.skychain !== leaf.waterchain)
			state.drawsky = true;
		return;
	}
	const _node = node as Node
	recursiveWorldNode(_node.children[0]);
	recursiveWorldNode(_node.children[1]);
};

const waterAlphaForSurface = (surf: Face) => {
	if (surf.flags & def.SURF.drawlava)
		return mapAlpha.state.lava > 0 ? mapAlpha.state.lava : mapAlpha.state.water;
	else if (surf.flags & def.SURF.drawtele)
		return mapAlpha.state.tele > 0 ? mapAlpha.state.tele : mapAlpha.state.water;
	else if (surf.flags & def.SURF.drawslime)
		return mapAlpha.state.slime > 0 ? mapAlpha.state.slime : mapAlpha.state.water;
	else
		return mapAlpha.state.water;
}


/*
================
GL_WaterAlphaForEntitySurface -- ericw
 
Returns the water alpha to use for the entity and surface combination.
================
*/
const waterAlphaForEntitySurface = (ent: Entity, surf: Face) => {
	var entalpha = 1
	if (!ent || ent.alpha == 1)
		entalpha = waterAlphaForSurface(surf);
	else
		entalpha = pr.decodeAlpha(ent.alpha);
	return entalpha;
}

/*
================
R_DrawTextureChains_Water -- johnfitz
================
*/
const drawTextureChains_water = (gl: WebGL2RenderingContext, model: Model, ent: Entity, chain: TexChain) => {

	const turbulentProgram = GL.useProgram('Turbulent')

	// Bind the buffers
	gl.bindBuffer(gl.ARRAY_BUFFER, state.model_vbo);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)// indices come from client memory!

	gl.vertexAttribPointer(turbulentProgram.attributeMap.aPosition.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
	gl.vertexAttribPointer(turbulentProgram.attributeMap.aTexCoord.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 3);

	// set uniforms
	gl.uniform1i(turbulentProgram.uniforms.uUseOverbright, cvr.overbright.value);
	gl.uniform1i(turbulentProgram.uniforms.uUseAlphaTest, 0);

	gl.uniform3f(turbulentProgram.uniforms.uOrigin, 0.0, 0.0, 0.0);
	gl.uniformMatrix3fv(turbulentProgram.uniforms.uAngles, false, GL.identity);
	gl.uniform1f(turbulentProgram.uniforms.uTime, host.state.realtime % (Math.PI * 2.0))

	for (var i = 0; i < model.textures.length; i++) {
		var t = model.textures[i];
		if (!t || !t.texturechains || !t.texturechains[chain] || !(t.texturechains[chain].flags & def.SURF.drawtub))
			continue;
		var animatedTexture = textureAnimation(state.cl_worldmodel, t, ent != null ? ent.frame : 0)
		batchRender.clearBatch();
		var bound = false;
		var entalpha = 0


		for (var s = t.texturechains[chain]; s; s = s.texturechain)
			if (!s.culled) {
				if (!bound) //only bind once we are sure we need this texture
				{
					tx.bind(0, animatedTexture.texturenum);
					bound = true;
				}
				
				var	newalpha = waterAlphaForEntitySurface (ent, s);
				if (newalpha !== entalpha) {
					if (newalpha < 1)
					{
						gl.depthMask(false);
						gl.enable(gl.BLEND);
						gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
					} else {
						gl.depthMask(true);
						gl.disable(gl.BLEND);
					}
					gl.uniform1f(turbulentProgram.uniforms.uAlpha, newalpha);
				}
				entalpha = newalpha

				batchRender.batchSurface(gl, s);
			}

		//R_EndTransparentDrawing (entalpha);
		batchRender.flushBatch(gl)

		if (entalpha < 1)
		{
			gl.depthMask(true);
			gl.disable(gl.BLEND);
		}
	}


	GL.unbindProgram()
}

const drawTextureChains = (gl: WebGL2RenderingContext, model: Model, ent: Entity, chain: TexChain) => {
	var entalpha = ent ? pr.decodeAlpha(ent.alpha) : 1

	// TODO Dynamic LMs
	// ericw -- the mh dynamic lightmap speedup: make a first pass through all
	// surfaces we are going to draw, and rebuild any lightmaps that need it.
	// this also chains surfaces by lightmap which is used by r_lightmap 1.
	// the previous implementation of the speedup uploaded lightmaps one frame
	// late which was visible under some conditions, this method avoids that.
	lm.buildLightmapChains(model, chain);
	lm.uploadLightmaps(gl);

	// R_BeginTransparentDrawing (entalpha);

	// TODO: Missing texture support.
	// R_DrawTextureChains_NoTexture (model, chain);


	// R_EndTransparentDrawing (entalpha);

	var fullbright = null

	// enable blending / disable depth writes
	if (entalpha < 1) {
		gl.depthMask(false);
		gl.enable(gl.BLEND);
	}

	const brushProgram = GL.useProgram('Brush')
	const fogColor = fog.getColor()
	const fogDensity = fog.getDensity()

	// Bind the buffers
	gl.bindBuffer(gl.ARRAY_BUFFER, state.model_vbo);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null) // indices come from client memory!

	gl.vertexAttribPointer(brushProgram.attributeMap.Vert.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
	gl.vertexAttribPointer(brushProgram.attributeMap.TexCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 3);
	gl.vertexAttribPointer(brushProgram.attributeMap.LMCoords.location, 2, gl.FLOAT, false, def.VERTEXSIZE * 4, 4 * 5);

	// set uniforms
	gl.uniform1i(brushProgram.uniforms.uUseFullbrightTex, 0);
	gl.uniform1i(brushProgram.uniforms.uUseOverbright, cvr.overbright.value);
	gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 0);
	gl.uniform1f(brushProgram.uniforms.uAlpha, entalpha);
	gl.uniform1f(brushProgram.uniforms.uFogDensity, fogDensity / 64)
	gl.uniform4f(brushProgram.uniforms.uFogColor, fogColor[0], fogColor[1], fogColor[2], fogColor[3])

	if (ent !== null) {
		var viewMatrix = GL.rotationMatrix(ent.angles[0], ent.angles[1], ent.angles[2]);

		gl.uniform3fv(brushProgram.uniforms.uOrigin, ent.origin);
		gl.uniformMatrix3fv(brushProgram.uniforms.uAngles, false, viewMatrix);

	} else {
		gl.uniform3f(brushProgram.uniforms.uOrigin, 0.0, 0.0, 0.0);
		gl.uniformMatrix3fv(brushProgram.uniforms.uAngles, false, GL.identity);
	}

	for (var i = 0; i < model.textures.length; i++) {
		var t = model.textures[i];

		if (!t || !t.texturechains || !t.texturechains[chain] || t.texturechains[chain].flags & (def.SURF.drawtiled | def.SURF.notexture | def.SURF.drawtub))
			continue;

		var animatedTexture = textureAnimation(model, t, ent != null ? ent.frame : 0)
		// Enable/disable TMU 2 (fullbrights)
		// FIXME: Move below to where we bind GL_TEXTURE0
		// full bright is never set.
		// if (cvr.fullbrights.value && (fullbright = animatedTexture.fullbright)) {
		// 	tx.bind(2, fullbright);
		// 	gl.uniform1i(brushProgram.uUseFullbrightTex, 1);
		// }
		// else {
			gl.uniform1i(brushProgram.uniforms.uUseFullbrightTex, 0);
			tx.bind(2, tx.state.null_texture)
		//}

		batchRender.clearBatch();

		var bound = false;
		var lastlightmap = 0;

		for (var s = t.texturechains[chain]; !!s; s = s.texturechain)
			if (!s.culled) {
				if (!bound) //only bind once we are sure we need this texture
				{
					tx.bind(0, animatedTexture.texturenum);

					if (t.texturechains[chain].flags & def.SURF.drawfence)
						gl.uniform1i(brushProgram.uniforms.uUseAlphaTest, 1);

					bound = true;
					lastlightmap = s.lightmaptexturenum;
				}

				if (s.lightmaptexturenum !== lastlightmap)
					batchRender.flushBatch(gl);

				tx.bind(1, tx.state.lightmap_textures[s.lightmaptexturenum].texnum);
				lastlightmap = s.lightmaptexturenum;
				batchRender.batchSurface(gl, s);

				// rs_brushpasses++; // stats
			}

		batchRender.flushBatch(gl);

		if (bound && t.texturechains[chain].flags & def.SURF.drawfence)
			gl.uniform1i(brushProgram.uniforms.useAlphaTest, 0); // Flip alpha test back off
	}

	GL.unbindProgram()

	if (entalpha < 1) {
		gl.depthMask(true);
		gl.disable(gl.BLEND);
	}
}

export const markLeaves = function () {
	if ((state.oldviewleaf === state.viewleaf) && (cvr.novis.value === 0))
		return;
	++state.visframecount;
	state.oldviewleaf = state.viewleaf;
	var vis = (cvr.novis.value !== 0) ? mod.novis : mod.leafPVS(state.viewleaf, cl.clState.worldmodel);
	var i, node;
	for (i = 0; i < cl.clState.worldmodel.leafs.length; ++i) {
		if ((vis[i >> 3] & (1 << (i & 7))) === 0)
			continue;
		for (node = cl.clState.worldmodel.leafs[i + 1]; node != null; node = node.parent) {
			if (node.markvisframe === state.visframecount)
				break;
			node.markvisframe = state.visframecount;
		}
	}
	do {
		if (cvr.novis.value !== 0)
			break;
		var p = [state.refdef.vieworg[0], state.refdef.vieworg[1], state.refdef.vieworg[2]];
		var leaf;
		if (state.viewleaf.contents <= mod.CONTENTS.water) {
			leaf = mod.pointInLeaf([state.refdef.vieworg[0], state.refdef.vieworg[1], state.refdef.vieworg[2] + 16.0], cl.clState.worldmodel);
			if (leaf.contents <= mod.CONTENTS.water)
				break;
		}
		else {
			leaf = mod.pointInLeaf([state.refdef.vieworg[0], state.refdef.vieworg[1], state.refdef.vieworg[2] - 16.0], cl.clState.worldmodel);
			if (leaf.contents > mod.CONTENTS.water)
				break;
		}
		if (leaf === state.viewleaf)
			break;
		vis = mod.leafPVS(leaf, cl.clState.worldmodel);
		for (i = 0; i < cl.clState.worldmodel.leafs.length; ++i) {
			if ((vis[i >> 3] & (1 << (i & 7))) === 0)
				continue;
			for (node = cl.clState.worldmodel.leafs[i + 1]; node != null; node = node.parent) {
				if (node.markvisframe === state.visframecount)
					break;
				node.markvisframe = state.visframecount;
			}
		}
	} while (false);
	state.drawsky = false;
	recursiveWorldNode(cl.clState.worldmodel.nodes[0]);
};

const noVisPVS = (model: Model) => {
	const pvsbytes = (model.numleafs + 7) >> 3;
	if (!state.mod_novis || pvsbytes > state.mod_novis_capacity) {
		state.mod_novis_capacity = pvsbytes;
		state.mod_novis = new Uint8Array(new ArrayBuffer(state.mod_novis_capacity))
		state.mod_novis.fill(0xFF)
	}
	return state.mod_novis;
}

const leafPVS = (leaf: Leaf, model: Model) => {
	if (leaf == model.leafs[0])
		return noVisPVS(model);
	return mod.decompressVis(leaf.visofs, model);
}

// The PVS must include a small area around the client to allow head bobbing
// or other small motion on the client side.  Otherwise, a bob might cause an
// entity that should be visible to not show up, especially when the bob
// crosses a waterline.

const addToFatPVS = (org: V3, node: NodeLeaf, worldmodel: Model) => { // johnfitz -- added worldmodel as a parameter

	while (1) {
		// if this is a leaf, accumulate the pvs bits
		if (node.contents < 0) {
			const leaf = node as Leaf;
			if (node.contents !== mod.CONTENTS.solid) {
				const pvs = leafPVS(leaf, worldmodel); //johnfitz -- worldmodel as a parameter
				for (var i = 0; i < state.fatbytes; i++)
					state.fatpvs[i] |= pvs[i];
			}
			return;
		}

		const _node = node as Node;
		const plane = _node.plane;
		const d = vec.dotProductV3(org, plane.normal) - plane.dist;
		if (d > 8)
			node = _node.children[0];
		else if (d < -8)
			node = _node.children[1];
		else {	// go down both
			addToFatPVS(org, _node.children[0], worldmodel); //johnfitz -- worldmodel as a parameter
			node = _node.children[1];
		}
	}
}

// Calculates a PVS that is the inclusive or of all leafs within 8 pixels of the
// given point.
const fatPVS = (org: V3, worldmodel: Model) => //johnfitz -- added worldmodel as a parameter
{
	state.fatbytes = (worldmodel.numleafs + 7) >> 3; // ericw -- was +31, assumed to be a bug/typo
	if (!state.fatpvs || state.fatbytes > state.fatpvs_capacity) {
		state.fatpvs_capacity = state.fatbytes;
		state.fatpvs = new Uint8Array(new ArrayBuffer(state.fatpvs_capacity)).fill(0)
	}
	addToFatPVS(org, worldmodel.nodes[0], worldmodel); //johnfitz -- worldmodel as a parameter
	return state.fatpvs;
}

const chainSurface = (model: Model, surf: Face, chain: TexChain) => {
	const texture = model.textures[model.texinfo[surf.texinfo].texture]
	surf.texturechain = texture.texturechains[chain];
	texture.texturechains[chain] = surf;
}

const markSurfaces = () => {
	var vis: Uint8Array 
	const worldmodel = cl.clState.worldmodel
	// check this leaf for water portals
	// TODO: loop through all water surfs and use distance to leaf cullbox
	var nearwaterportal = false;
	for (var i = 0, mark = state.viewleaf.firstmarksurface; i < state.viewleaf.nummarksurfaces; i++ , mark++)
		if (worldmodel.faces[worldmodel.marksurfaces[mark]].flags & def.SURF.drawtub)
			nearwaterportal = true;

	// choose vis data
	if (cvr.novis.value || state.viewleaf.contents === mod.CONTENTS.solid || state.viewleaf.contents === mod.CONTENTS.sky)
		vis = noVisPVS(worldmodel);
	else if (nearwaterportal)
		vis = fatPVS(state.refdef.vieworg, worldmodel);
	else
		vis = leafPVS(state.viewleaf, worldmodel);

	// if surface chains don't need regenerating, just add static entities and return
	if (state.oldviewleaf == state.viewleaf && !state.vis_changed && !nearwaterportal) {
		for (i = 0; i < worldmodel.numleafs; i++) {
			var leaf = worldmodel.leafs[i + 1];
			if (vis[i>>3] & (1<<(i&7)))
				if (leaf.efrags)
					storeEfrags (leaf.efrags);
		}
		return;
	}

	state.vis_changed = false
	state.visframecount++;
	state.oldviewleaf = state.viewleaf

	// iterate through leaves, marking surfaces
	for (i = 0; i < worldmodel.numleafs; i++) {
		var leaf = worldmodel.leafs[i + 1];
		if (vis[i >> 3] & (1 << (i & 7))) {
			if (cvr.oldskyleaf.value || leaf.contents != mod.CONTENTS.sky)
				for (var j = 0; j < leaf.nummarksurfaces; j++) {
					const surf = worldmodel.faces[worldmodel.marksurfaces[leaf.firstmarksurface + j]]
					surf.visframe = state.visframecount;
				}

			// add static models
			if (leaf.efrags)
				storeEfrags (leaf.efrags);
		}
	}

	// set all chains to null
	for (i = 0; i < cl.clState.worldmodel.textures.length; i++)
		if (cl.clState.worldmodel.textures[i] && cl.clState.worldmodel.textures[i].texturechains)
			cl.clState.worldmodel.textures[i].texturechains[TexChain.world] = null;

	// rebuild chains
	//iterate through surfaces one node at a time to rebuild chains
	//need to do it this way if we want to work with tyrann's skip removal tool
	//becuase his tool doesn't actually remove the surfaces from the bsp surfaces lump
	//nor does it remove references to them in each leaf's marksurfaces list
	for (i = 0; i < cl.clState.worldmodel.nodes.length; i++)
		for (j = 0; j < cl.clState.worldmodel.nodes[i].numfaces; j++) {
			var surf = cl.clState.worldmodel.faces[cl.clState.worldmodel.nodes[i].firstface + j]
			if (surf.visframe === state.visframecount) {
				chainSurface(cl.clState.worldmodel, surf, TexChain.world);
			}
		}
	state.drawsky = true
}

const buildSurfaceDisplayLists = (model: Model) => {
	for (var i = 0; i < model.numfaces; i++) {

		if ((model.faces[i].flags & def.SURF.drawtiled) && !(model.faces[i].flags & def.SURF.drawtub))
			continue;

		var fa = model.faces[i]
		fa.polys = {
			next: fa.polys,
			numverts: fa.numedges,
			verts: []
		}

		const texInfo = model.texinfo[fa.texinfo]
		const texture = model.textures[texInfo.texture]

		for (var j = 0; j < fa.numedges; j++) {
			var lindex = model.surfedges[fa.firstedge + j];
			var _vec, s, t
			if (lindex > 0) {
				_vec = model.vertexes[model.edges[lindex][0]];
			}
			else {
				_vec = model.vertexes[model.edges[-lindex][1]];
			}
			//@ts-ignore
			s = vec.dotProductV3(_vec, texInfo.vecs[0]) + texInfo.vecs[0][3];
			s /= texture.width;
			//@ts-ignore
			t = vec.dotProductV3(_vec, texInfo.vecs[1]) + texInfo.vecs[1][3];
			t /= texture.height;

			fa.polys.verts[j] = [0,0,0,0,0,0,0]

			//@ts-ignore
			vec.copy(_vec, fa.polys.verts[j]);
			fa.polys.verts[j][3] = s;
			fa.polys.verts[j][4] = t;

			//
			// lightmap texture coordinates
			//
			//@ts-ignore
			s = vec.dotProductV3(_vec, texInfo.vecs[0]) + texInfo.vecs[0][3];
			s -= fa.texturemins[0];
			s += fa.light_s * 16;
			s += 8;
			s /= lm.LM_BLOCK_WIDTH * 16; //fa->texinfo->texture->width;

			//@ts-ignore
			t = vec.dotProductV3(_vec, texInfo.vecs[1]) + texInfo.vecs[1][3];
			t -= fa.texturemins[1];
			t += fa.light_t * 16;
			t += 8;
			t /= lm.LM_BLOCK_HEIGHT * 16; //fa->texinfo->texture->height;

			fa.polys.verts[j][5] = s;
			fa.polys.verts[j][6] = t;
		}

		//johnfitz -- removed gl_keeptjunctions code
	}
}

const buildModelVertexBuffer = (gl: WebGLRenderingContext) => {
	var v_buffer = []
	var v_index = 0

	for (var midx = 1; midx < cl.clState.model_precache.length; ++midx) {
		var model = cl.clState.model_precache[midx];
		if (!model || model.name[0] == '*' || model.type != mod.TYPE.brush)
			continue;

		for (var i = 0; i < model.faces.length; i++) {
			const surf = model.faces[i]
			surf.vbo_firstvert = v_index
			for (var j = 0; j < surf.polys.verts.length; j++)
				for (var k = 0; k < 7; k++)
					v_buffer.push(surf.polys.verts[j][k] || 0)

			v_index += surf.polys.verts.length
		}
	}

	state.model_vbo = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.model_vbo);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v_buffer), gl.STATIC_DRAW);
}

export const freeResources = () => {
	const gl = GL.getContext()
	gl.deleteFramebuffer(state.warpbuffer)
	gl.deleteBuffer(state.model_vbo)
	gl.deleteBuffer(state.skyvecs)
	gl.deleteBuffer(state.dlightvecs)
	gl.deleteRenderbuffer(state.warprenderbuffer)

	gl.deleteTexture(state.notexture_mip && state.notexture_mip.texturenum)
	gl.deleteTexture(state.warptexture)
	gl.deleteTexture(state.solidskytexture)
	gl.deleteTexture(state.alphaskytexture)
	gl.deleteTexture(state.null_texture)
}

// scan

export const warpScreen = function () {
	const gl = GL.getContext()
	GL.streamFlush();
	gl.finish();
	gl.bindFramebuffer(gl.FRAMEBUFFER, null);
	gl.bindRenderbuffer(gl.RENDERBUFFER, null);
	var program = GL.useProgram('Warp');
	tx.bind(program.textures.tTexture, state.warptexture);
	gl.uniform1f(program.uniforms.uTime, host.state.realtime % (Math.PI * 2.0));
	var vrect = state.refdef.vrect;
	GL.streamDrawTexturedQuad(vrect.x, vrect.y, vrect.width, vrect.height, 0.0, 1.0, 1.0, 0.0);
	GL.streamFlush();
};

// warp

export const makeSky = function () {
	const gl = GL.getContext()
	var sin = [0.0, 0.19509, 0.382683, 0.55557, 0.707107, 0.831470, 0.92388, 0.980785, 1.0];
	var vecs: number[] = [], i, j;

	for (i = 0; i < 7; i += 2) {
		vecs = vecs.concat(
			[
				0.0, 0.0, 1.0,
				sin[i + 2] * 0.19509, sin[6 - i] * 0.19509, 0.980785,
				sin[i] * 0.19509, sin[8 - i] * 0.19509, 0.980785
			]);
		for (j = 0; j < 7; ++j) {
			vecs = vecs.concat(
				[
					sin[i] * sin[8 - j], sin[8 - i] * sin[8 - j], sin[j],
					sin[i] * sin[7 - j], sin[8 - i] * sin[7 - j], sin[j + 1],
					sin[i + 2] * sin[7 - j], sin[6 - i] * sin[7 - j], sin[j + 1],

					sin[i] * sin[8 - j], sin[8 - i] * sin[8 - j], sin[j],
					sin[i + 2] * sin[7 - j], sin[6 - i] * sin[7 - j], sin[j + 1],
					sin[i + 2] * sin[8 - j], sin[6 - i] * sin[8 - j], sin[j]
				]);
		}
	}

	GL.createProgram('Sky',
		['uViewAngles', 'uPerspective', 'uScale', 'uGamma', 'uTime'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3)
		],
		['tSolid', 'tAlpha']);
	GL.createProgram('SkyChain',
		['uViewOrigin', 'uViewAngles', 'uPerspective'],
		[
			createAttribParam('aPosition', gl.FLOAT, 3)
		],
		[]);

	state.skyvecs = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, state.skyvecs);
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vecs), gl.STATIC_DRAW);
};

export const drawSkyBox = function () {
	const gl = GL.getContext()
	if (state.drawsky !== true)
		return;

	gl.colorMask(false, false, false, false);
	var clmodel = cl.clState.worldmodel;
	var program = GL.useProgram('SkyChain', false);
	gl.bindBuffer(gl.ARRAY_BUFFER,  state.model_vbo);
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null)
	gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, def.VERTEXSIZE * 4, 0);
	for (var i = 0; i < clmodel.textures.length; i++) {
		var t = clmodel.textures[i];
		if (!t || !t.texturechains || !t.texturechains[TexChain.world] || !(t.texturechains[TexChain.world].flags & def.SURF.drawsky))
			continue;
		for (var s = t.texturechains[TexChain.world]; !!s; s = s.texturechain)
			if (!s.culled) {
				batchRender.batchSurface(gl, s);
			}
	}
	batchRender.flushBatch(gl);

	gl.colorMask(true, true, true, true);

	gl.depthFunc(gl.GREATER);
	gl.depthMask(false);
	gl.disable(gl.CULL_FACE);

	program = GL.useProgram('Sky', false);
	gl.uniform2f(program.uniforms.uTime, (host.state.realtime * 0.125) % 1.0, (host.state.realtime * 0.03125) % 1.0);
	tx.bind(program.textures.tSolid, state.solidskytexture, false);
	tx.bind(program.textures.tAlpha, state.alphaskytexture, false);
	gl.bindBuffer(gl.ARRAY_BUFFER, state.skyvecs);
	gl.vertexAttribPointer(program.attributeMap.aPosition.location, 3, gl.FLOAT, false, 12, 0);

	gl.uniform3f(program.uniforms.uScale, 2.0, -2.0, 1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);
	gl.uniform3f(program.uniforms.uScale, 2.0, -2.0, -1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);

	gl.uniform3f(program.uniforms.uScale, 2.0, 2.0, 1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);
	gl.uniform3f(program.uniforms.uScale, 2.0, 2.0, -1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);

	gl.uniform3f(program.uniforms.uScale, -2.0, -2.0, 1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);
	gl.uniform3f(program.uniforms.uScale, -2.0, -2.0, -1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);

	gl.uniform3f(program.uniforms.uScale, -2.0, 2.0, 1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);
	gl.uniform3f(program.uniforms.uScale, -2.0, 2.0, -1.0);
	gl.drawArrays(gl.TRIANGLES, 0, 180);

	gl.enable(gl.CULL_FACE);
	gl.depthMask(true);
	gl.depthFunc(gl.LESS);
};

export const initSky = function (src: Uint8Array) {
	const gl = GL.getContext()
	var i, j, p;
	var trans = new ArrayBuffer(65536);
	var trans32 = new Uint32Array(trans);

	for (i = 0; i < 128; ++i) {
		for (j = 0; j < 128; ++j)
			trans32[(i << 7) + j] = com.state.littleLong(vid.d_8to24table[src[(i << 8) + j + 128]] + 0xff000000);
	}
	if (gl) {
		tx.bind(0, state.solidskytexture, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
		gl.generateMipmap(gl.TEXTURE_2D);

		for (i = 0; i < 128; ++i) {
			for (j = 0; j < 128; ++j) {
				p = (i << 8) + j;
				if (src[p] !== 0)
					trans32[(i << 7) + j] = com.state.littleLong(vid.d_8to24table[src[p]] + 0xff000000);
				else
					trans32[(i << 7) + j] = 0;
			}
		}
		tx.bind(0, state.alphaskytexture, false);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
		gl.generateMipmap(gl.TEXTURE_2D);
	}
}
