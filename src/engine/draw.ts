import * as com from './com'
import * as palette from './palette'
import * as sys from './sys'
import * as def from './def'
import * as GL from './GL'
import * as w from './w'
import * as tx from './texture'
import * as vid from './vid'
import * as con from './console'
import { Pic } from './texture'

type DrawState = {
  char_texture: WebGLTexture
  chars: Uint8Array
  conback: tx.Pic
  loading: tx.Pic
  loadingCont: HTMLElement
  loadingElem: HTMLImageElement
  loadingMsg: HTMLElement
  gameContainer: HTMLElement

}

export const state: DrawState = {
  char_texture: null,
  chars: null,
  conback: null,
  loading: null,
  loadingCont: null,
  loadingElem: null,
  loadingMsg: null,
  gameContainer: null
}

export const charToConback = function(num: number, dest: number)
{
  var source = ((num >> 4) << 10) + ((num & 15) << 3);
  var drawline, x;
  for (drawline = 0; drawline < 8; ++drawline)
  {
    for (x = 0; x < 8; ++x)
    {
      if (state.chars[source + x] !== 0)
        state.conback.data[dest + x] = 0x60 + state.chars[source + x];
    }
    source += 128;
    dest += 320;
  }
};

export const init = async function()
{
  var i;

  state.chars = new Uint8Array(w.getLumpName('CONCHARS'));
  
  var trans = new ArrayBuffer(65536);
  var trans32 = new Uint32Array(trans);
  for (i = 0; i < 16384; ++i)
  {
    if (state.chars[i] !== 0)
      trans32[i] = com.state.littleLong(palette.d_8to24table[state.chars[i]]);
  }
  const gl = GL.getContext()
  state.char_texture = gl.createTexture();
  tx.bind(0, state.char_texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 128, 128, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(trans));
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  var cb = await com.loadFile('gfx/conback.lmp');
  if (cb == null)
    sys.error('Couldn\'t load gfx/conback.lmp');
  const size = new Uint32Array(cb, 0, 2)
  
  state.conback = {
    width: size[0],
    height: size[1],
    data: new Uint8Array(cb, 8, size[1] * size[0]),
    texnum: null,
    translate: null
  }

  var ver = '(WebQuake build ' + def.webquake_version + ') 1.09';
  for (i = 0; i < ver.length; ++i)
    charToConback(ver.charCodeAt(i), 59829 - ((ver.length - i) << 3));
  state.conback.texnum = tx.loadPicTexture(state.conback);

  state.loading = await cachePic('loading');
  state.loadingCont = document.getElementById('loading');
  state.loadingElem = state.loadingCont.querySelector('img');
  state.loadingElem.src = picToDataURL(state.loading);
  state.loadingMsg = state.loadingCont.querySelector('.loading-message');
  state.gameContainer = document.querySelector('.game-container')

  state.gameContainer.style.backgroundImage = 'url("' + picToDataURL(picFromWad('BACKTILE')) + '")';

  GL.createProgram('Fill',
    ['uOrtho'],
    [
      GL.createAttribParam('aPosition', gl.FLOAT, 2),
      GL.createAttribParam('aColor', gl.UNSIGNED_BYTE, 4, true)
    ],
    []);
  GL.createProgram('Pic',
    ['uOrtho'],
    [
      GL.createAttribParam('aPosition', gl.FLOAT, 2), 
      GL.createAttribParam('aTexCoord', gl.FLOAT, 2)
    ],
    ['tTexture']);
  GL.createProgram('PicTranslate',
    ['uOrtho', 'uTop', 'uBottom'],
    [
      GL.createAttribParam('aPosition', gl.FLOAT, 2), 
      GL.createAttribParam('aTexCoord', gl.FLOAT, 2)
    ],
    ['tTexture', 'tTrans']);
};

export const char = function(x: number, y: number, num: number, size: number)
{
  GL.streamDrawTexturedQuad(x, y, size, size,
    (num & 15) * 0.0625, (num >> 4) * 0.0625,
    ((num & 15) + 1) * 0.0625, ((num >> 4) + 1) * 0.0625);
}

export const character = function(x: number, y: number, num: number, size = con.cvr.textsize.value)
{
  var program = GL.useProgram('Pic', true);
  tx.bind(program.textures.tTexture, state.char_texture, true);
  char(x, y, num, size);
};

export const string = function(x: number, y: number, str: string, size = con.cvr.textsize.value)
{
  var program = GL.useProgram('Pic', true);
  tx.bind(program.textures.tTexture, state.char_texture, true);
  for (var i = 0; i < str.length; ++i)
  {
    char(x, y, str.charCodeAt(i), size);
    x += size;
  }
};

export const stringWhite = function(x: number, y: number, str: string, size = con.cvr.textsize.value)
{
  var program = GL.useProgram('Pic', true);
  tx.bind(program.textures.tTexture, state.char_texture, true);
  for (var i = 0; i < str.length; ++i)
  {
    char(x, y, str.charCodeAt(i) + 128, size);
    x += size;
  }
};

export const picFromWad = function(name: string): Pic
{
  var buf = w.getLumpName(name);
  var p = {} as any;
  var view = new DataView(buf, 0, 8);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  
  const dat: tx.Pic =  {
    width,
    height,
    data: new Uint8Array(buf, 8, width * height),
    texnum: null,
    translate: null
  }
  dat.texnum = tx.loadPicTexture(dat);
  return dat
};

export const cachePic = async function(path: string)
{
  path = 'gfx/' + path + '.lmp';
  var buf = await com.loadFile(path);
  if (buf == null)
    sys.error('Draw.CachePic: failed to load ' + path);
  var view = new DataView(buf, 0, 8);
  const [width, height] = [view.getUint32(0, true), view.getUint32(4, true)]
  const dat: tx.Pic = {
    width,
    height,
    data: new Uint8Array(buf, 8, width * height),
    texnum: null,
    translate: null
  }
  dat.texnum = tx.loadPicTexture(dat);
  return dat;
};

export const pic = function(x: number, y: number, _pic: Pic, scale = 1)
{
  var program = GL.useProgram('Pic', true);
  tx.bind(program.textures.tTexture, _pic.texnum, true);
  GL.streamDrawTexturedQuad(x, y, _pic.width * scale, _pic.height * scale, 0.0, 0.0, 1.0, 1.0);
};

export const picTranslate = function(x: number, y: number, pic: Pic, top: number, bottom: number, scale: number = 1)
{
  const gl = GL.getContext()
  GL.streamFlush();
  var program = GL.useProgram('PicTranslate');
  tx.bind(program.textures.tTexture, pic.texnum);
  tx.bind(program.textures.tTrans, pic.translate);

  var p = vid.d_8to24table[top];
  var _scale = 1.0 / 191.25;
  gl.uniform3f(program.uniforms.uTop, (p & 0xff) * _scale, ((p >> 8) & 0xff) * _scale, (p >> 16) * _scale);
  p = vid.d_8to24table[bottom];
  gl.uniform3f(program.uniforms.uBottom, (p & 0xff) * _scale, ((p >> 8) & 0xff) * _scale, (p >> 16) * _scale);

  GL.streamDrawTexturedQuad(x, y, pic.width * scale, pic.height * scale, 0.0, 0.0, 1.0, 1.0);

  GL.streamFlush();
};

export const consoleBackground = function(lines: number)
{
  var program = GL.useProgram('Pic', true);
  tx.bind(program.textures.tTexture, state.conback.texnum, true);
  GL.streamDrawTexturedQuad(0, lines - vid.state.height, vid.state.width, vid.state.height, 0.0, 0.0, 1.0, 1.0);
};

export const fill = function(x: number, y: number, w: number, h: number, c: number)
{
  var program = GL.useProgram('Fill', true);
  var color = vid.d_8to24table[c];
  GL.streamDrawColoredQuad(x, y, w, h, color & 0xff, (color >> 8) & 0xff, color >> 16, 255);
};

export const fadeScreen = function()
{
  var program = GL.useProgram('Fill', true);
  GL.streamDrawColoredQuad(0, 0, vid.state.width, vid.state.height, 0, 0, 0, 204);
};

export const beginDisc = function(file: string)
{
  if (state.loadingCont == null)
    return;
  state.loadingCont.style.left = ((vid.state.width - state.loading.width) >> 1) + 'px';
  state.loadingCont.style.top = ((vid.state.height - state.loading.height) >> 1) + 'px';
  state.loadingCont.style.display = 'inline-block';
  state.loadingMsg.innerText = file
};

export const endDisc = function()
{
  if (state.loadingCont != null)
    state.loadingCont.style.display = 'none';
};

export const picToDataURL = function(pic: tx.Pic)
{
  var canvas = document.createElement('canvas');
  canvas.width = pic.width;
  canvas.height = pic.height;
  var ctx = canvas.getContext('2d');
  var data = ctx.createImageData(pic.width, pic.height);
  var trans = new ArrayBuffer(data.data.length);
  var trans32 = new Uint32Array(trans);
  var i;
  for (i = 0; i < pic.data.length; ++i)
    trans32[i] = com.state.littleLong(palette.d_8to24table[pic.data[i]]);
  data.data.set(new Uint8Array(trans));
  ctx.putImageData(data, 0, 0);
  return canvas.toDataURL();
};