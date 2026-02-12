import {state as comState} from './com'
import { d_8to24table, d_8to24table_fbright_fence, d_8to24table_fbright, 
  d_8to24table_conchars, d_8to24table_nobright, d_8to24table_nobright_fence,
  setPalette
} from './palette'
import * as defs from './def'
import * as GL from './GL'
import * as con from './console'
import * as cmd from './cmd'
import * as com from './com'
import * as cvar from './cvar'
import { Model, TexChain, Texture } from './types/Model'

type GLMode = 'GL_NEAREST' | 'GL_LINEAR' | 'GL_NEAREST_MIPMAP_NEAREST' | 'GL_LINEAR_MIPMAP_NEAREST' | 'GL_NEAREST_MIPMAP_LINEAR' | 'GL_LINEAR_MIPMAP_LINEAR'
type GLModeDef = [GLMode, number, number]
export type GLTexture = {
  owner: Model
  texnum: WebGLTexture
  identifier: string
  width: number
  height: number
}

type TextureState = {
  maxtexturesize: number
  activetexture: number
  currenttextures: WebGLTexture[],
  filter_max: number
  filter_min: number
  textures: GLTexture[],
  notexture_mip: Texture | null,
  solidskytexture: WebGLTexture | null,
  alphaskytexture: WebGLTexture | null,
  lightmap_textures: GLTexture[],
  lightstyle_texture: WebGLTexture | null,
  null_texture: WebGLTexture | null,
  fullbright_texture: WebGLTexture | null,
  modes: GLModeDef[]
}


export const createNoTexture = (gl: WebGL2RenderingContext): Texture => ({
  name: 'notexture',
  width: 16,
  height: 16,
  texturenum: gl.createTexture(),
  texturechains: {[TexChain.world]: null, [TexChain.model]: null},
  sky: false,
  turbulent: false,
  anims: [],
  alternate_anims: [],
  anim_base: 0,
  anim_frame: 0
})

export const state: TextureState = {
  maxtexturesize: -1,
  activetexture: -1,
  currenttextures: [],
  filter_max: -1,
  filter_min: -1,
  textures: [],
  notexture_mip: null,
  solidskytexture: null,
  alphaskytexture: null,
  lightmap_textures: [],
  lightstyle_texture: null,
  null_texture: null,
  fullbright_texture: null,
  modes: []
}

let gl: any = null

export type Pic = {
  width: number
  height: number
  data: Uint8Array
  texnum: WebGLTexture
  translate: WebGLTexture
}
export const getContext = () => {
  return gl
}

export const cvr = {

} as any

export const textureMode_f = function()
{
  const gl = GL.getContext();
  var i;
  if (cmd.state.argv.length <= 1)
  {
    for (i = 0; i < state.modes.length; ++i)
    {
      if (state.filter_min === state.modes[i][1])
      {
        con.print(state.modes[i][0] + '\n');
        return;
      }
    }
    con.print('current filter is unknown???\n');
    return;
  }
  var name = cmd.state.argv[1].toUpperCase();
  for (i = 0; i < state.modes.length; ++i)
  {
    if (state.modes[i][0] === name)
      break;
  }
  if (i === state.modes.length)
  {
    con.print('bad filter name\n');
    return;
  }
  state.filter_min = state.modes[i][1];
  state.filter_max = state.modes[i][2];
  for (i = 0; i < state.textures.length; ++i)
  {
    bind(0, state.textures[i].texnum);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, state.filter_min);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, state.filter_max);
  }
};

export const resampleTexture = function(data: Uint8Array, inwidth: number, inheight: number, outwidth: number, outheight: number)
{
  var outdata = new ArrayBuffer(outwidth * outheight);
  var out = new Uint8Array(outdata);
  var xstep = inwidth / outwidth, ystep = inheight / outheight;
  var src, dest = 0, y;
  var i, j;
  for (i = 0; i < outheight; ++i)
  {
    src = Math.floor(i * ystep) * inwidth;
    for (j = 0; j < outwidth; ++j)
      out[dest + j] = data[src + Math.floor(j * xstep)];
    [src + Math.floor(j * xstep)];
    dest += outwidth;
  }
  return out;
}

export const loadSky = (gl: WebGLRenderingContext, src: Uint8Array) => {
	var i, j, p;
	var trans = new ArrayBuffer(65536);
	var trans32 = new Uint32Array(trans);

	for (i = 0; i < 128; ++i)
	{
		for (j = 0; j < 128; ++j)
			trans32[(i << 7) + j] = comState.littleLong(d_8to24table[src[(i << 8) + j + 128]]);
	}
  bind(0, state.solidskytexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.generateMipmap(gl.TEXTURE_2D);

  for (i = 0; i < 128; ++i)
  {
    for (j = 0; j < 128; ++j)
    {
      p = (i << 8) + j;
      if (src[p] !== 0)
        trans32[(i << 7) + j] = comState.littleLong(d_8to24table[src[p]]);
      else
        trans32[(i << 7) + j] = 0;
    }
  }
  bind(0, state.alphaskytexture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.generateMipmap(gl.TEXTURE_2D);
}

export const init = async () => {
  const gl = GL.getContext()
  state.modes = [
    ['GL_NEAREST', gl.NEAREST, gl.NEAREST],
    ['GL_LINEAR', gl.LINEAR, gl.LINEAR],
    ['GL_NEAREST_MIPMAP_NEAREST', gl.NEAREST_MIPMAP_NEAREST, gl.NEAREST],
    ['GL_LINEAR_MIPMAP_NEAREST', gl.LINEAR_MIPMAP_NEAREST, gl.LINEAR],
    ['GL_NEAREST_MIPMAP_LINEAR', gl.NEAREST_MIPMAP_LINEAR, gl.NEAREST],
    ['GL_LINEAR_MIPMAP_LINEAR', gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR]
  ];
  state.filter_min = gl.LINEAR_MIPMAP_NEAREST;
  state.filter_max = gl.LINEAR;

  cvr.picmip = cvar.registerVariable('gl_picmip', '0', true);
  cvr.glTexturemode = cvar.registerVariable('gl_texturemode', 'GL_LINEAR_MIPMAP_NEAREST', true);
  cvar.registerChangedEvent('gl_texturemode', textureMode_f);

  state.maxtexturesize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
	var data = new Uint8Array(new ArrayBuffer(256));
	var i, j;
	for (i = 0; i < 8; ++i)
	{
		for (j = 0; j < 8; ++j)
		{
			data[(i << 4) + j] = data[136 + (i << 4) + j] = 255;
			data[8 + (i << 4) + j] = data[128 + (i << 4) + j] = 0;
		}
  }
  
  await setPalette();
  
	state.notexture_mip = createNoTexture(gl);
	bind(0, state.notexture_mip.texturenum);
  upload(data, 16, 16);
  
	state.solidskytexture = gl.createTexture();
	bind(0, state.solidskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  
	state.alphaskytexture = gl.createTexture();
	bind(0, state.alphaskytexture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  state.lightmap_textures = []
  for (i = 0; i < 4; i++) {
    // TODO - does this change break?
    // state.lightmap_textures[i] = gl.createTexture();
    // bind(0, state.lightmap_textures[i]);
    // Above changed to:
    bind(0, gl.createTexture());

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    
  }
	state.lightstyle_texture = gl.createTexture();
	bind(0, state.lightstyle_texture);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);


	state.fullbright_texture = gl.createTexture();
	bind(0, state.fullbright_texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 0, 0, 0]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  
	state.null_texture = gl.createTexture();
	bind(0, state.null_texture);
	gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
}

export const bind = (target: number, texnum: WebGLTexture, flushStream = false) => {
  const gl = GL.getContext()
  if (state.currenttextures[target] !== texnum)
  {
    if (flushStream)
      GL.streamFlush();

    if (state.activetexture !== target)
    {
      state.activetexture = target;
      gl.activeTexture(gl.TEXTURE0 + target);
    }
    state.currenttextures[target] = texnum;
    gl.bindTexture(gl.TEXTURE_2D, texnum);
  }
}

export const loadPicTexture = function(pic: Pic)
{
  const gl = GL.getContext()
  var data = pic.data, scaled_width = pic.width, scaled_height = pic.height;
  if (((pic.width & (pic.width - 1)) !== 0) || ((pic.height & (pic.height - 1)) !== 0))
  {
    --scaled_width ;
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
  if (scaled_width > state.maxtexturesize)
    scaled_width = state.maxtexturesize;
  if (scaled_height > state.maxtexturesize)
    scaled_height = state.maxtexturesize;
  if ((scaled_width !== pic.width) || (scaled_height !== pic.height))
    data = resampleTexture(data, pic.width, pic.height, scaled_width, scaled_height);

  var texnum = gl.createTexture();
  bind(0, texnum);
  var trans = new ArrayBuffer((scaled_width * scaled_height) << 2)
  var trans32 = new Uint32Array(trans);
  var i;
  for (i = scaled_width * scaled_height - 1; i >= 0; --i)
  {
    if (data[i] !== 255)
      trans32[i] = com.state.littleLong(d_8to24table[data[i]] + 0xff000000);
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, scaled_width, scaled_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return texnum;
};

export const upload = function(data: Uint8Array, width: number, height: number, flags = 0)
{
  const gl = GL.getContext()
  var scaled_width = width, scaled_height = height;
  if (((width & (width - 1)) !== 0) || ((height & (height - 1)) !== 0))
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
  if (scaled_width > state.maxtexturesize)
    scaled_width = state.maxtexturesize;
  if (scaled_height > state.maxtexturesize)
    scaled_height = state.maxtexturesize;
  if ((scaled_width !== width) || (scaled_height !== height))
    data = resampleTexture(data, width, height, scaled_width, scaled_height);
  var trans = new ArrayBuffer((scaled_width * scaled_height) << 2)
  var trans32 = new Uint32Array(trans);
  var pal = d_8to24table
  var padbyte = 255

	// choose palette and padbyte
	if (flags & defs.TEXPREF.fullbright)
	{
		if (flags & defs.TEXPREF.alpha)
			pal = d_8to24table_fbright_fence;
		else
      pal = d_8to24table_fbright;
		padbyte = 0;
	}
	else if (flags & defs.TEXPREF.nobright && false)//gl_fullbrights.value)
	{
		if (flags & defs.TEXPREF.alpha)
			pal = d_8to24table_nobright_fence;
		else
			pal = d_8to24table_nobright;
		padbyte = 0;
	}
	else if (flags & defs.TEXPREF.conchars)
	{
		pal = d_8to24table_conchars;
		padbyte = 0;
  }
  
  for (var i = scaled_width * scaled_height - 1; i >= 0; --i)
  {
    trans32[i] = comState.littleLong(pal[data[i]]);
    // if (data[i] >= 224)
    //   trans32[i] &= 0xffffff;
  }

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, scaled_width, scaled_height, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, state.filter_min);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, state.filter_max);
}


export const loadTexture = (owner: Model, identifier: string, width: number, height: number, data: Uint8Array, flags = 0): GLTexture => {
  var glt, i;
  const gl = GL.getContext()
  if (identifier.length !== 0)
  {
    for (i = 0; i < state.textures.length; ++i)
    {
      glt = state.textures[i];
      if (glt.identifier === identifier)
      {
        if ((width !== glt.width) || (height !== glt.height))
          con.print('TX.LoadTexture: cache mismatch\n')
        return glt
      }
    }
  }
  
  var scaled_width = width, scaled_height = height;
  if (((width & (width - 1)) !== 0) || ((height & (height - 1)) !== 0))
  {
    --scaled_width ;
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
  if (scaled_width > state.maxtexturesize)
    scaled_width = state.maxtexturesize;
  if (scaled_height > state.maxtexturesize)
    scaled_height = state.maxtexturesize;
  scaled_width >>= 0 // TODO cvr.picmip.value;
  if (scaled_width === 0)
    scaled_width = 1;
  scaled_height >>= 0  // TODO cvr.picmip.value;
  if (scaled_height === 0)
    scaled_height = 1;
  if ((scaled_width !== width) || (scaled_height !== height))
    data = resampleTexture(data, width, height, scaled_width, scaled_height);

  glt = {owner, texnum: gl.createTexture(), identifier: identifier, width: width, height: height};
  bind(0, glt.texnum);
  upload(data, scaled_width, scaled_height, flags);
  state.textures[state.textures.length] = glt;
  return glt;
}

export const loadLightmapTexture = (gl: WebGLRenderingContext, lmNum: number, name: string, width: number, height: number, data: Uint8Array) => {
  const glt: GLTexture = {
    texnum: gl.createTexture(), 
    identifier: name, 
    width: width, 
    height: height,
    owner: null
  };
  bind(0, glt.texnum);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  state.lightmap_textures[lmNum] = glt
  return glt
}

export const freeTexture = (glt: GLTexture) => {
  const gl = GL.getContext()
  gl.deleteTexture(glt.texnum)
}

export const freeTextureForOwner = (owner: Model) => {
  for(var i = state.textures.length - 1; i >= 0; i--) {
    const texture = state.textures[i]
    if (texture.owner === owner) {
      freeTexture(texture)
      state.textures.splice(i, 1)
    }
  }
}

export const freeTextures = () => {
  for(var i = state.textures.length - 1; i >= 0; i--) {
    const texture = state.textures[i]
    freeTexture(texture)
    state.textures.splice(i, 1)
  }
}