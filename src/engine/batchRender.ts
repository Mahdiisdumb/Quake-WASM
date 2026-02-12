import { Face } from "./types/Model"

const MAX_BATCH_SIZE = 4096

export type BatchRenderState = {
	vbo_indices: Uint32Array,
	num_vbo_indices: number,
	vbo_buffer: WebGLBuffer
}
const state: BatchRenderState = {
  vbo_indices: new Uint32Array(new ArrayBuffer(MAX_BATCH_SIZE * 4)),
  num_vbo_indices: 0,
  vbo_buffer: null
}

export const init = (gl: WebGLRenderingContext) => {
  state.vbo_buffer = gl.createBuffer()
	gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.vbo_buffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, MAX_BATCH_SIZE * 4, gl.DYNAMIC_DRAW)  
}
/*
================
R_ClearBatch
================
*/
export const clearBatch = () => {
	state.num_vbo_indices = 0;
}

/*
================
R_FlushBatch

Draw the current batch if non-empty and clears it, ready for more R_BatchSurface calls.
================
*/
export const flushBatch = (gl: WebGLRenderingContext) => {
	if (state.num_vbo_indices > 0)
	{
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.vbo_buffer);
		gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0,
		state.vbo_indices.subarray(0, state.num_vbo_indices));
    	gl.drawElements (gl.TRIANGLES, state.num_vbo_indices, gl.UNSIGNED_INT, null);
    
		state.num_vbo_indices = 0;
	}
}

const numTriangleIndicesForSurf = (s: Face) => {
	return 3 * (s.numedges - 2)
}

const triangleIndicesForSurf = (s: Face) => {

	for (var i = 2; i < s.numedges; i++)
	{
    state.vbo_indices[state.num_vbo_indices++] = s.vbo_firstvert
		state.vbo_indices[state.num_vbo_indices++] = s.vbo_firstvert + i - 1
		state.vbo_indices[state.num_vbo_indices++] = s.vbo_firstvert + i
	}
}

/*
================
R_BatchSurface

Add the surface to the current batch, or just draw it immediately if we're not
using VBOs.
================
*/
export const batchSurface = (gl: WebGL2RenderingContext, s: Face) => {
	var num_surf_indices = numTriangleIndicesForSurf (s);
	
	if (state.num_vbo_indices + num_surf_indices > MAX_BATCH_SIZE)
		flushBatch(gl)
	
	triangleIndicesForSurf(s)
}