import * as sys from './sys'
import * as vid from './vid'
import * as scr from './scr'
import * as shaders from './shaders'

// @ts-ignore - debug.js is excluded from TypeScript compilation
import * as WebGLDebugUtils from './debug.js'

let gl: WebGL2RenderingContext = null

type GLAttribute = {
  name: string,
  location: number,
  type: number,
  components: number,
  normalized: boolean,
  offset: number
}

type GLAttributeParam = {
  name: string,
  type: number,
  components: number,
  normalized: boolean,
}
type GLProgram = {
  identifier: string,
  program: WebGLProgram,
  attribs: GLAttribute[],
  vertexSize: number, 
  attribBits: number,
  textures: Record<string, number>
  uniforms: Record<string, WebGLUniformLocation>
  attributeMap: Record<string, GLAttribute>
}
  

type GLState = {
  programs: GLProgram[]
  streamArray: ArrayBuffer
  streamArrayBytes: Uint8Array
  streamArrayPosition: number
  streamArrayVertexCount: number
  streamArrayView: DataView
  streamBuffer: WebGLBuffer
  streamBufferPosition: number
  currentProgram: GLProgram
}

export const createAttribParam = (name: string, type: number, components: number, normalized: boolean = false): GLAttributeParam => ({
  name,
  type,
  components,
  normalized
})

export const getContext = () => {
  return gl
}

export const state: GLState = {
  programs: [],
  streamArray: null,
  streamArrayBytes: null,
  streamArrayPosition: 0,
  streamArrayVertexCount: 0,
  streamArrayView: null,
  streamBuffer: null,
  streamBufferPosition: 0,
  currentProgram: null
}

export const ortho = [
  0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.0, 0.0,
  0.0, 0.0, 0.00001, 0.0,
  -1.0, 1.0, 0.0, 1.0
]

export const identity = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]

export const set2D = function()
{
  gl.viewport(0, 0, (vid.state.width * scr.state.devicePixelRatio) >> 0, (vid.state.height * scr.state.devicePixelRatio) >> 0);
  unbindProgram();
  var i, program;
  for (i = 0; i < state.programs.length; ++i)
  {
    program = state.programs[i];
    if (program.uniforms.uOrtho == null)
      continue;
    gl.useProgram(program.program);
    gl.uniformMatrix4fv(program.uniforms.uOrtho, false, ortho);
  }
  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
};

export const createProgram = function(identifier: string, uniforms: string[], attribs: GLAttributeParam[], textures: string[])
{
  var p = gl.createProgram();
  var program: GLProgram =
  {
    identifier: identifier,
    program: p,
    attribs: [],
    vertexSize: 0,
    attribBits: 0,
    textures: {},
    uniforms: {},
    attributeMap: {}
  };

  var vsh = gl.createShader(gl.VERTEX_SHADER);
  // @ts-ignore
  gl.shaderSource(vsh, shaders['vsh' + identifier]);
  gl.compileShader(vsh);
  if (gl.getShaderParameter(vsh, gl.COMPILE_STATUS) !== true)
    sys.error('Error compiling shader: ' + gl.getShaderInfoLog(vsh));

  var fsh = gl.createShader(gl.FRAGMENT_SHADER);
  // @ts-ignore
  gl.shaderSource(fsh, shaders['fsh' + identifier]);
  gl.compileShader(fsh);
  if (gl.getShaderParameter(fsh, gl.COMPILE_STATUS) !== true)
    sys.error('Error compiling shader: ' + gl.getShaderInfoLog(fsh));

  gl.attachShader(p, vsh);
  gl.attachShader(p, fsh);

  gl.linkProgram(p);
  if (gl.getProgramParameter(p, gl.LINK_STATUS) !== true)
    sys.error('Error linking program: ' + gl.getProgramInfoLog(p));

  gl.useProgram(p);

  for (var i = 0; i < uniforms.length; ++i)
    program.uniforms[uniforms[i]] = gl.getUniformLocation(p, uniforms[i]);

  program.vertexSize = 0;
  program.attribBits = 0;
  for (var i = 0; i < attribs.length; ++i)
  {
    var attribParameters = attribs[i];
    var attrib: GLAttribute = {
      ...attribParameters,
      offset: program.vertexSize,
      location: gl.getAttribLocation(p, attribParameters.name),
    }
    program.attribs[i] = attrib;
    program.attributeMap[attrib.name] = attrib;
    if (attrib.type === gl.FLOAT)
      program.vertexSize += attrib.components * 4;
    else if (attrib.type === gl.BYTE || attrib.type === gl.UNSIGNED_BYTE)
      program.vertexSize += 4;
    else
      sys.error('Unknown vertex attribute type');
    program.attribBits |= 1 << attrib.location;
  }

  for (var i = 0; i < textures.length; ++i)
  {
    program.textures[textures[i]] = i;
    gl.uniform1i(gl.getUniformLocation(p, textures[i]), i);
  }

  state.programs[state.programs.length] = program;
  return program;
};

export const useProgram = function(identifier: string, flushStream = false)
{
  var currentProgram = state.currentProgram;
  if (currentProgram != null)
  {
    if (currentProgram.identifier === identifier)
      return currentProgram;
    if (flushStream === true)
      streamFlush();
  }

  var program = null;
  for (var i = 0; i < state.programs.length; ++i)
  {
    if (state.programs[i].identifier === identifier)
    {
      program = state.programs[i];
      break;
    }
  }
  if (program == null)
    return null;

  var enableAttribs = program.attribBits, disableAttribs = 0;
  if (currentProgram != null)
  {
    enableAttribs &= ~currentProgram.attribBits;
    disableAttribs = currentProgram.attribBits & ~program.attribBits;
  }
  state.currentProgram = program;
  gl.useProgram(program.program);
  for (var attrib = 0; enableAttribs !== 0 || disableAttribs !== 0; ++attrib)
  {
    var mask = 1 << attrib;
    if ((enableAttribs & mask) !== 0)
      gl.enableVertexAttribArray(attrib);
    else if ((disableAttribs & mask) !== 0)
      gl.disableVertexAttribArray(attrib);
    enableAttribs &= ~mask;
    disableAttribs &= ~mask;
  }

  return program;
};

export const unbindProgram = function()
{
  if (state.currentProgram == null)
    return;
  streamFlush();
  var i;
  for (i = 0; i < state.currentProgram.attribs.length; ++i)
    gl.disableVertexAttribArray(state.currentProgram.attribs[i].location);
  state.currentProgram = null;
};


export const rotationMatrix = function(pitch: number, yaw: number, roll: number)
{
  pitch *= Math.PI / -180.0;
  yaw *= Math.PI / 180.0;
  roll *= Math.PI / 180.0;
  var sp = Math.sin(pitch);
  var cp = Math.cos(pitch);
  var sy = Math.sin(yaw);
  var cy = Math.cos(yaw);
  var sr = Math.sin(roll);
  var cr = Math.cos(roll);
  return [
    cy * cp,          sy * cp,          -sp,
    -sy * cr + cy * sp * sr,  cy * cr + sy * sp * sr,    cp * sr,
    -sy * -sr + cy * sp * cr,  cy * -sr + sy * sp * cr,  cp * cr
  ];
};

export const streamFlush = function()
{
  if (state.streamArrayVertexCount === 0)
    return;
  var program = state.currentProgram;
  if (program != null)
  {
    gl.bindBuffer(gl.ARRAY_BUFFER, state.streamBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, state.streamBufferPosition,
      state.streamArrayBytes.subarray(0, state.streamArrayPosition));
    var attribs = program.attribs;
    for (var i = 0; i < attribs.length; ++i)
    {
      var attrib = attribs[i];
      gl.vertexAttribPointer(attrib.location,
        attrib.components, attrib.type, attrib.normalized,
        program.vertexSize, state.streamBufferPosition + attrib.offset);
    }
    gl.drawArrays(gl.TRIANGLES, 0, state.streamArrayVertexCount);
    state.streamBufferPosition += state.streamArrayPosition;
  }
  state.streamArrayPosition = 0;
  state.streamArrayVertexCount = 0;
}

export const streamGetSpace = function(vertexCount: number)
{
  var program = state.currentProgram;
  if (program == null)
    return;
  var length = vertexCount * program.vertexSize;
  if ((state.streamBufferPosition + state.streamArrayPosition + length) > state.streamArray.byteLength)
  {
    streamFlush();
    state.streamBufferPosition = 0;
  }
  state.streamArrayVertexCount += vertexCount;
}

export const streamWriteFloat = function(x: number)
{
  state.streamArrayView.setFloat32(state.streamArrayPosition, x, true);
  state.streamArrayPosition += 4;
}

export const streamWriteFloat2 = function(x: number, y: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setFloat32(position, x, true);
  view.setFloat32(position + 4, y, true);
  state.streamArrayPosition += 8;
}

export const streamWriteFloat3 = function(x: number, y: number, z: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setFloat32(position, x, true);
  view.setFloat32(position + 4, y, true);
  view.setFloat32(position + 8, z, true);
  state.streamArrayPosition += 12;
}

export const streamWriteFloat4 = function(x: number, y: number, z: number, w: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setFloat32(position, x, true);
  view.setFloat32(position + 4, y, true);
  view.setFloat32(position + 8, z, true);
  view.setFloat32(position + 12, w, true);
  state.streamArrayPosition += 16;
}

export const streamWriteUByte4 = function(x: number, y: number, z: number, w: number)
{
  var view = state.streamArrayView;
  var position = state.streamArrayPosition;
  view.setUint8(position, x);
  view.setUint8(position + 1, y);
  view.setUint8(position + 2, z);
  view.setUint8(position + 3, w);
  state.streamArrayPosition += 4;
}

export const streamDrawTexturedQuad = function(x: number, y: number, w: number, h: number, u: number, v: number, u2: number, v2: number)
{
  var x2 = x + w, y2 = y + h;
  streamGetSpace(6);
  streamWriteFloat4(x, y, u, v);
  streamWriteFloat4(x, y2, u, v2);
  streamWriteFloat4(x2, y, u2, v);
  streamWriteFloat4(x2, y, u2, v);
  streamWriteFloat4(x, y2, u, v2);
  streamWriteFloat4(x2, y2, u2, v2);
}

export const streamDrawColoredQuad = function(x: number, y: number, w: number, h: number, r: number, g: number, b: number, a: number)
{
  var x2 = x + w, y2 = y + h;
  streamGetSpace(6);
  streamWriteFloat2(x, y);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x, y2);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x2, y);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x2, y);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x, y2);
  streamWriteUByte4(r, g, b, a);
  streamWriteFloat2(x2, y2);
  streamWriteUByte4(r, g, b, a);
}

export const freePrograms = () => {
  for (var i = state.programs.length -1; i >=0; i--) {
    const program = state.programs[i]
    gl.deleteProgram(program.program)
    state.programs.splice(i, 1)
  }
  var numTextureUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  for (var unit = 0; unit < numTextureUnits; ++unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, null);
  }
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  var numAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
  for (var attrib = 0; attrib < numAttributes; ++attrib) {
    gl.vertexAttribPointer(attrib, 1, gl.FLOAT, false, 0, 0);
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  gl.bindRenderbuffer(gl.RENDERBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteBuffer(state.streamBuffer);
}


export const init = function() {
  state.programs = []

  vid.state.mainwindow = document.getElementById('mainwindow') as HTMLCanvasElement;
  const webGlOptions: WebGLContextAttributes = {
    powerPreference: 'high-performance'
  }
  // const onError = (err,fnName, args) => {
  //   debugger
  // }
  try
  {
    const context = vid.state.mainwindow.getContext('webgl2', webGlOptions)
     || vid.state.mainwindow.getContext('webgl', webGlOptions)
     || vid.state.mainwindow.getContext('experimental-webgl', webGlOptions)
    //gl = WebGLDebugUtils.default.makeDebugContext( context, onError, null, null);
    gl = context as WebGL2RenderingContext
  }
  catch (e) {
    debugger
  }

  if (gl == null)
    sys.error('Unable to initialize WebGL. Your browser may not support it.');

  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.cullFace(gl.FRONT);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE);

  state.streamArray = new ArrayBuffer(8192); // Increasing even a little bit ruins all performance on Mali.
  state.streamArrayBytes = new Uint8Array(state.streamArray);
  state.streamArrayPosition = 0;
  state.streamArrayVertexCount = 0;
  state.streamArrayView = new DataView(state.streamArray);
  state.streamBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, state.streamBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, state.streamArray.byteLength, gl.DYNAMIC_DRAW);
  state.streamBufferPosition = 0;

  vid.state.mainwindow.style.display = 'inline-block';
};