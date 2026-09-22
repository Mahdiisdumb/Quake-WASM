// CSQC builtin tables (QSS pr_csqcbuiltins, pr_cmds.c:2160-2249). The classic #1-78 layout matches
// the server's: VM-generic slots reuse the ssqc impl, slots with a client counterpart (sound,
// precaches, lightstyle, particle) run the client one, and the network ones (Write*, stuffcmd,
// bprint) are noCSQC stubs. Also here: the EXT_CSQC 2D drawing block (pr_ext.c:5480-5660), which
// draws in a virtual canvas — see vmScale. The scene/view block lives in pfcl_scene.ts.
import * as cl from './cl'
import * as cmd from './cmd'
import * as con from './console'
import * as def from './def'
import * as draw from './draw'
import * as ed from './ed'
import * as msg from './msg'
import * as protocol from './protocol'
import * as pr from './pr'
import * as pf from './pf'
import * as scene from './pfcl_scene'
import * as r from './r'
import * as s from './s'
import * as scr from './scr'
import * as sys from './sys'
import * as vec from './vec'
import * as vid from './vid'
import * as w from './w'
import { V3 } from './types'
import { Edict } from './types/Edict'
import { Sound } from './types/Sound'
import { Pic } from './texture'

const PARM0 = 4
const PARM1 = 7
const PARM2 = 10
const PARM3 = 13
const PARM4 = 16
const PARM5 = 19
const PARM6 = 22
const RETURN = 1

// The ssqc impl of a VM-generic builtin, looked up by name in pf's extension table.
const shared = function (name: string): pr.Builtin {
  const entry = pf.ebfs_builtins.find(b => b.name === name);
  if (entry == null) {
    sys.error('PFCL: no shared builtin named ' + name);
    return unimplemented;
  }
  return entry.fn;
};

// Builtins the client VM must never reach (QSS PF_NoCSQC); named, warned once per name per session.
const warned = new Set<string>();
const noCSQC = function (name: string): pr.Builtin {
  // Tagged per name so pr_scanprogs can tell a stub from a working binding.
  return pr.markStub(function () {
    if (warned.has(name))
      return;
    warned.add(name);
    con.print('CSQC: builtin ' + name + ' is not available to client progs\n');
  }, name);
};

// One line per key per session, for a builtin that does run but with something dropped or reduced.
const warnOnce = function (key: string, message: string) {
  if (warned.has(key))
    return;
  warned.add(key);
  con.print(message);
};

// The table's first entry, and every builtin number the progs asked for that we don't
// implement (QSS PF_Fixme).
const unimplemented: pr.Builtin = pr.markStub(function () {
  con.dPrint('CSQC: unimplemented builtin\n');
});

// The CSQC 2D canvas scale (QSS PR_GetVMScale, pr_ext.c:30-41): csqc draws in a virtual (width/s,
// height/s) space. QSS bakes it into a canvas ortho matrix; draw.* stays raw-pixel here, so every
// draw builtin scales at the call site.
export const vmScale = function (): number {
  const v = scr.cvr.sbarscale.value;
  const max = vid.state.width / 320.0;
  return (v > max) ? max : ((v < 1) ? 1 : v);
};

// Pics named by QC (QSS qcpics[]). Missing = never asked for; null = loading or failed. Delta from
// QSS: our file-pic loader is async, so a pic drawn on the frame it is first named no-ops.
const qcpics = new Map<string, Pic>();

// PICFLAG_WAD: the name is a wad lump rather than a file (pr_ext.c:5380).
const PICFLAG_WAD = 1

// QSS DrawQC_CachePic (pr_ext.c:5387): wad lump when asked for one, or when the name looks like DP's
// "gfx/<lump>" convention (gfx/ prefix, no extension); a .lmp/file pic otherwise.
const cachePic = function (name: string, flags: number): Pic {
  const hit = qcpics.get(name);
  if (hit !== undefined)
    return hit;
  if (name.length === 0)
    return null;
  qcpics.set(name, null);

  const gfx = name.startsWith('gfx/');
  if (((flags & PICFLAG_WAD) !== 0) || (gfx && (name.indexOf('.', 4) < 0))) {
    const lump = (gfx ? name.substring(4) : name).toUpperCase();
    if (w.hasLumpName(lump)) {
      const pic = draw.picFromWad(lump);
      qcpics.set(name, pic);
      return pic;
    }
  }
  draw.cachePicPath(name).then(pic => {
    if (pic != null) {
      qcpics.set(name, pic);
      return null;
    }
    // No .lmp: fall through to the truecolor image formats, as FTE's pic registration does.
    return draw.cacheImagePic(name);
  }).then(pic => {
    if (pic != null) {
      qcpics.set(name, pic);
      return;
    }
    if (qcpics.get(name) != null)
      return;   // an earlier rung already resolved it - don't overwrite with the lump
    // Last resort: a gfx.wad lump, where FTE's general texture load also ends (image.c:14596-14608,
    // W_GetTexture on the extension-stripped name).
    const bare = name.startsWith('gfx/') ? name.substring(4) : name;
    if ((bare.indexOf('.') < 0) && (bare.indexOf('/') < 0)) {
      const lump = bare.toUpperCase();
      if (w.hasLumpName(lump))
        qcpics.set(name, draw.picFromWad(lump));
    }
  });
  return null;
};

// Sounds named by QC. Decode is async, so the first play of a sound the server never precached is
// dropped, as QSS's S_StartSound skips a sound whose cache isn't loaded yet.
const qcsounds = new Map<string, Sound>();

const cacheSound = function (name: string): Sound {
  const hit = qcsounds.get(name);
  if (hit !== undefined)
    return hit;
  if (name.length === 0)
    return null;
  qcsounds.set(name, null);
  s.precacheSound(name).then(sfx => {
    if (sfx != null)
      qcsounds.set(name, sfx);
  });
  return null;
};

// Scratch for the sound/particle vector args; every consumer copies out or reads immediately.
const sndorigin: V3 = [0, 0, 0]
const partorigin: V3 = [0, 0, 0]
const partdir: V3 = [0, 0, 0]

// EXT_CSQC #339: like dprint, but unconditional.
const print = function () {
  con.print(pf.varString(0));
};

// EXT_CSQC #352 registercommand(cmdname): a console command with no engine handler, so
// cmd.executeString routes it to CSQC_ConsoleCommand (QSS PF_cl_registercommand, pr_ext.c:5961).
// A name the engine already owns is silently ignored; nothing ever unregisters the command.
const registercommand = function () {
  const name = pr.getString(pr.state.globals_int[PARM0]);
  if ((name.length === 0) || cmd.exists(name))
    return;
  cmd.addCommand(name, null);
};

// EXT_CSQC #338: the csqc side of centerprint.
const cprint = function () {
  scr.centerPrint(pf.varString(0));
};

// ---- EXT_CSQC stats (QSS pr_ext.c:5328-5361) ----
// No gameaccess gate: stats are HUD data, readable by simple csqc same as full.

// #330 getstati(stnum) -> int. getstati_punf is a QC-side macro over this, not its own builtin.
const getstati = function () {
  const stnum = pr.state.globals_float[PARM0] >> 0;
  pr.state.globals_int[RETURN] = ((stnum < 0) || (stnum >= def.MAX_CL_STATS)) ? 0 : cl.clState.stats[stnum];
};

// #331 getstatf(stnum[, firstbit, bitcount]) -> float. With firstbit/bitcount, extracts that
// bitfield out of the *int* stat (e.g. STAT_ITEMS' packed items/items2/serverflags).
const getstatf = function () {
  const g = pr.state.globals_float;
  const stnum = g[PARM0] >> 0;
  if ((stnum < 0) || (stnum >= def.MAX_CL_STATS)) {
    g[RETURN] = 0;
    return;
  }
  if (pr.state.argc > 1) {
    const firstbit = g[PARM1] >> 0;
    const bitcount = g[PARM2] >> 0;
    g[RETURN] = (cl.clState.stats[stnum] >> firstbit) & ((1 << bitcount) - 1);
  } else {
    g[RETURN] = cl.clState.statsf[stnum];
  }
};

// #332 getstats(stnum) -> string, as a tempstring. Separate pool from the numeric stats.
const getstats = function () {
  const stnum = pr.state.globals_float[PARM0] >> 0;
  const val = ((stnum < 0) || (stnum >= def.MAX_CL_STATS)) ? undefined : cl.clState.statss[stnum];
  if (val === undefined) {
    pr.state.globals_int[RETURN] = 0;
    return;
  }
  pr.tempString(val);
  pr.state.globals_int[RETURN] = pr.state.string_temp;
};

// ---- EXT_CSQC message reads (QSS PF_cl_read*, pr_ext.c:6029-6078) ----
// These read at the engine's live parse cursor, so they are only meaningful inside an entry point
// the parse called (today: CSQC_Ent_Update). The wire has no length prefix: the progs must consume
// EXACTLY the bytes its .SendEntity wrote, or every svc after it in the message parses as garbage.

// #360 readbyte
const readbyte = function () {
  pr.state.globals_float[RETURN] = msg.readByte();
};

// #361 readchar - signed, unlike readbyte
const readchar = function () {
  pr.state.globals_float[RETURN] = msg.readChar();
};

// #362 readshort - signed 16-bit, as MSG_ReadShort is
const readshort = function () {
  pr.state.globals_float[RETURN] = msg.readShort();
};

// #363 readlong
const readlong = function () {
  pr.state.globals_float[RETURN] = msg.readLong();
};

// #364 readcoord - decoded with the negotiated protocol flags, the ones WriteCoord encoded with
const readcoord = function () {
  pr.state.globals_float[RETURN] = msg.readCoord(cl.clState.protocolFlags);
};

// #365 readangle - likewise
const readangle = function () {
  pr.state.globals_float[RETURN] = msg.readAngle(cl.clState.protocolFlags);
};

// #366 readstring -> tempstring
const readstring = function () {
  pr.tempString(msg.readString());
  pr.state.globals_int[RETURN] = pr.state.string_temp;
};

// #367 readfloat
const readfloat = function () {
  pr.state.globals_float[RETURN] = msg.readFloat();
};

// #368 readentitynum (QSS MSG_ReadEntity, common.c:1321). Plain unsigned-short form; the wider
// PEXT2_REPLACEMENTDELTAS escape is not implemented.
const readentitynum = function () {
  pr.state.globals_float[RETURN] = msg.readShort() & 0xffff;
};

// ---- EXT_CSQC client->server events (QSS PF_cl_sendevent, pr_ext.c:6081-6138) ----

// #359 sendevent(evname, evargs, ...) - stage a clcfte_qcrequest for the server's
// CSEv_<evname>_<evargs>. `evargs` types each following argument, one letter each: s string,
// f float, v vector, e entity (its SERVER entnum), i int, u uint; six arguments max, and an
// unrecognised letter silently drops its argument.
const sendevent = function () {
  // Delta from QSS: QSS emits this unconditionally, but a server that never negotiated PEXT1_CSQC
  // drops the client on the unknown clc byte (QSS sv_user.c:772).
  if ((cl.clState.protocol_pext1 & protocol.PEXT1_CSQC) === 0) {
    con.dPrint('CSQC: sendevent ignored, the server did not negotiate PEXT1_CSQC\n');
    return;
  }
  const message = cl.cls.message;
  const g_float = pr.state.globals_float, g_int = pr.state.globals_int;
  const evname = pr.getString(g_int[PARM0]);
  const evargs = pr.getString(g_int[PARM1]);

  msg.writeByte(message, protocol.CLC.fte_qcrequest);
  for (var a = 2; (a < 8) && (a - 2 < evargs.length); ++a) {
    const ofs = PARM0 + a * 3;
    switch (evargs.charAt(a - 2)) {
      case 's':
        msg.writeByte(message, pr.ETYPE.ev_string);
        msg.writeString(message, pr.getString(g_int[ofs]));
        break;
      case 'f':
        msg.writeByte(message, pr.ETYPE.ev_float);
        msg.writeFloat(message, g_float[ofs]);
        break;
      case 'i':
        msg.writeByte(message, pr.ETYPE.ev_ext_integer);
        msg.writeLong(message, g_int[ofs]);
        break;
      case 'u':
        msg.writeByte(message, pr.ETYPE.ev_ext_uint32);
        msg.writeLong(message, g_int[ofs]);
        break;
      case 'v':
        msg.writeByte(message, pr.ETYPE.ev_vector);
        msg.writeFloat(message, g_float[ofs]);
        msg.writeFloat(message, g_float[ofs + 1]);
        msg.writeFloat(message, g_float[ofs + 2]);
        break;
      case 'e': {
        // The .entnum the entity stream stamped on this edict, looked up per call as QSS does
        // (ED_FindFieldOffset, pr_ext.c:6132); 0 when undeclared or not from the stream.
        const e = pr.state.edicts[g_int[ofs]];
        const d = ed.findField('entnum');
        msg.writeByte(message, pr.ETYPE.ev_entity);
        msg.writeShort(message, ((e != null) && (d != null)) ? e.v_float[d.ofs] : 0);
        break;
      }
    }
  }
  msg.writeByte(message, pr.ETYPE.ev_void);   // argument terminator
  msg.writeString(message, evname);
};

// ---- ^-markup (QSS PR_Markup_Begin/PR_Markup_Parse, pr_ext.c:95-251) ----
// Module-scope so drawstring/stringwidth allocate nothing per frame. Delta from QSS: the ^U / ^{
// unicode escapes and the ^[ link syntax are not decoded and draw literally.
const q3rgb = [
  0.00, 0.00, 0.00, 1.0,
  1.00, 0.33, 0.33, 1.0,
  0.00, 1.00, 0.33, 1.0,
  1.00, 1.00, 0.33, 1.0,
  0.33, 0.33, 1.00, 1.0,
  0.33, 1.00, 1.00, 1.0,
  1.00, 0.33, 1.00, 1.0,
  1.00, 1.00, 1.00, 1.0,
  1.00, 1.00, 1.00, 0.5,
  0.50, 0.50, 0.50, 1.0
]

const markup = {
  txt: '',
  pos: 0,
  // 128 = the "alternate charset" bit ORed into every glyph (a leading \1 or \2, or ^a / ^m).
  mask: 0,
  // The whole-string colour the builtin was called with, and the current glyph's colour.
  tintR: 1, tintG: 1, tintB: 1, tintA: 1,
  r: 1, g: 1, b: 1, a: 1
}

const isHex = function (c: number): boolean {
  return ((c >= 48) && (c <= 57)) || ((c >= 97) && (c <= 102)) || ((c >= 65) && (c <= 70));
};

const deHex = function (c: number): number {
  if (c <= 57)
    return c - 48;
  return (c & 0xdf) - 55;
};

const markupBegin = function (text: string, r: number, g: number, b: number, a: number) {
  const lead = text.charCodeAt(0);
  markup.mask = ((lead === 1) || (lead === 2)) ? 128 : 0;
  markup.pos = (markup.mask !== 0) ? 1 : 0;
  markup.txt = text;
  markup.tintR = markup.r = r;
  markup.tintG = markup.g = g;
  markup.tintB = markup.b = b;
  markup.tintA = markup.a = a;
};

// The next glyph (already masked), or 0 at end of string. markup.r/g/b/a carry its colour.
const markupParse = function (): number {
  const txt = markup.txt;
  while (markup.pos < txt.length) {
    const c = txt.charCodeAt(markup.pos);
    if ((c === 94) && pr.cvr.pr_checkextension.value) {   // '^'
      const n = txt.charCodeAt(markup.pos + 1);
      if (n === 94) {                                     // '^^' escape
        ++markup.pos;
      }
      else if ((n >= 48) && (n <= 57)) {                  // ^0..^9
        const i = (n - 48) * 4;
        markup.r = markup.tintR * q3rgb[i];
        markup.g = markup.tintG * q3rgb[i + 1];
        markup.b = markup.tintB * q3rgb[i + 2];
        markup.a = markup.tintA * q3rgb[i + 3];
        markup.pos += 2;
        continue;
      }
      else if (n === 104) {                               // ^h: toggle half alpha
        markup.a = (markup.a !== markup.tintA * 0.5) ? markup.tintA * 0.5 : markup.tintA;
        markup.pos += 2;
        continue;
      }
      else if (n === 100) {                               // ^d: back to defaults
        markup.r = markup.tintR; markup.g = markup.tintG;
        markup.b = markup.tintB; markup.a = markup.tintA;
        markup.mask = 0;
        markup.pos += 2;
      }
      else if ((n === 98) || (n === 115) || (n === 114)) { // ^b blink, ^s push, ^r restore
        markup.pos += 2;
        continue;
      }
      else if ((n === 97) || (n === 109)) {               // ^a / ^m: toggle the mask bit
        markup.mask ^= 128;
        markup.pos += 2;
        continue;
      }
      else if (n === 120) {                               // ^xRGB, 12-bit colour
        const h0 = txt.charCodeAt(markup.pos + 2), h1 = txt.charCodeAt(markup.pos + 3), h2 = txt.charCodeAt(markup.pos + 4);
        if (isHex(h0) && isHex(h1) && isHex(h2)) {
          markup.r = markup.tintR * deHex(h0) / 15.0;
          markup.g = markup.tintG * deHex(h1) / 15.0;
          markup.b = markup.tintB * deHex(h2) / 15.0;
          markup.pos += 5;
          continue;
        }
      }
      else if (n === 38) {                                // ^&xy: fte ansi colours, ignored
        const h0 = txt.charCodeAt(markup.pos + 2), h1 = txt.charCodeAt(markup.pos + 3);
        if ((isHex(h0) || (h0 === 45)) && (isHex(h1) || (h1 === 45))) {
          markup.pos += 4;
          continue;
        }
      }
    }
    ++markup.pos;
    return (c & 0xff) | markup.mask;
  }
  return 0;
};

// #477 strdecolorize(string s) - strip markup/colours (FTE PF_strdecolorize: COM_ParseFunString
// then COM_DeFunString; the markup parser above is our COM_ParseFunString).
const strdecolorize = function () {
  const text = pr.getString(pr.state.globals_int[PARM0]);
  markupBegin(text, 1, 1, 1, 1);
  var out = '', c: number;
  while ((c = markupParse()) !== 0)
    out += String.fromCharCode(c & 0x7f);
  pr.tempString(out);
  pr.state.globals_int[RETURN] = pr.state.string_temp;
};

// ---- EXT_CSQC 2D drawing (QSS pr_ext.c:5480-5660) ----
// Virtual canvas units -> pixels via vmScale() at each call site; scalars only, nothing allocated.

// #320 drawcharacter(pos, charcode, size, rgb, alpha[, flags])
const drawcharacter = function () {
  const g = pr.state.globals_float;
  const c = (g[PARM1] >> 0) & 0xff;
  if (c === 32)
    return;
  const s = vmScale();
  draw.charTinted(g[PARM0] * s, g[PARM0 + 1] * s, g[PARM2] * s, g[PARM2 + 1] * s, c,
    g[PARM3], g[PARM3 + 1], g[PARM3 + 2], g[PARM4]);
};

// #321 drawrawstring(pos, text, size, rgb, alpha[, flags]) - no markup parsing at all.
const drawrawstring = function () {
  const g = pr.state.globals_float;
  const text = pr.getString(pr.state.globals_int[PARM1]);
  if (text.length === 0)
    return;
  const s = vmScale();
  const w = g[PARM2] * s, h = g[PARM2 + 1] * s;
  const y = g[PARM0 + 1] * s;
  var x = g[PARM0] * s;
  for (var i = 0; i < text.length; ++i) {
    draw.charTinted(x, y, w, h, text.charCodeAt(i) & 0xff, g[PARM3], g[PARM3 + 1], g[PARM3 + 2], g[PARM4]);
    x += w;
  }
};

// #326 drawstring(pos, text, size, rgb, alpha[, flags]) - ^-markup recoloured per glyph.
const drawstring = function () {
  const g = pr.state.globals_float;
  const text = pr.getString(pr.state.globals_int[PARM1]);
  if (text.length === 0)
    return;
  markupBegin(text, g[PARM3], g[PARM3 + 1], g[PARM3 + 2], g[PARM4]);
  const s = vmScale();
  const w = g[PARM2] * s, h = g[PARM2 + 1] * s;
  const y = g[PARM0 + 1] * s;
  var x = g[PARM0] * s;
  var c: number;
  while ((c = markupParse()) !== 0) {
    draw.charTinted(x, y, w, h, c, markup.r, markup.g, markup.b, markup.a);
    x += w;
  }
};

// #327 stringwidth(text, usecolours[, fontsize]) - fixed-width font, so fontsize_x * visible glyphs,
// in virtual units (NOT scaled: the QC lays out in the same space it drew in).
const stringwidth = function () {
  const text = pr.getString(pr.state.globals_int[PARM0]);
  var count: number;
  if (pr.state.globals_float[PARM1] === 0)
    count = text.length;
  else {
    markupBegin(text, 0, 0, 0, 1);
    count = 0;
    while (markupParse() !== 0)
      ++count;
  }
  pr.state.globals_float[RETURN] = ((pr.state.argc > 2) ? pr.state.globals_float[PARM2] : 8) * count;
};

// #322 drawpic(pos, picname, size, rgb, alpha[, flags])
const drawpic = function () {
  const g = pr.state.globals_float;
  const pic = cachePic(pr.getString(pr.state.globals_int[PARM1]), 0);
  if (pic == null)
    return;
  const s = vmScale();
  draw.subPic(g[PARM0] * s, g[PARM0 + 1] * s, g[PARM2] * s, g[PARM2 + 1] * s, pic,
    0.0, 0.0, 1.0, 1.0, g[PARM3], g[PARM3 + 1], g[PARM3 + 2], g[PARM4]);
};

// #328 drawsubpic(pos, size, picname, srcpos, srcsize, rgb, alpha[, flags])
const drawsubpic = function () {
  const g = pr.state.globals_float;
  const pic = cachePic(pr.getString(pr.state.globals_int[PARM2]), 0);
  if (pic == null)
    return;
  const s = vmScale();
  draw.subPic(g[PARM0] * s, g[PARM0 + 1] * s, g[PARM1] * s, g[PARM1 + 1] * s, pic,
    g[PARM3], g[PARM3 + 1], g[PARM3] + g[PARM4], g[PARM3 + 1] + g[PARM4 + 1],
    g[PARM5], g[PARM5 + 1], g[PARM5 + 2], g[PARM6]);
};

// #323 drawfill(pos, size, rgb, alpha[, flags])
const drawfill = function () {
  const g = pr.state.globals_float;
  const s = vmScale();
  draw.fillRGBA(g[PARM0] * s, g[PARM0 + 1] * s, g[PARM1] * s, g[PARM1 + 1] * s,
    g[PARM2], g[PARM2 + 1], g[PARM2 + 2], g[PARM3]);
};

// #324 drawsetcliparea(x, y, width, height) - the one place QSS also scales, since the scissor is in
// real pixels either way.
const drawsetcliparea = function () {
  const g = pr.state.globals_float;
  const s = vmScale();
  draw.setClip(g[PARM0] * s, g[PARM1] * s, g[PARM2] * s, g[PARM3] * s);
};

// #325 drawresetcliparea()
const drawresetcliparea = function () {
  draw.resetClip();
};

// #317 precache_pic(name[, flags]) - echoes the name back for convenience.
const precache_pic = function () {
  pr.state.globals_int[RETURN] = pr.state.globals_int[PARM0];
  cachePic(pr.getString(pr.state.globals_int[PARM0]),
    (pr.state.argc > 1) ? (pr.state.globals_float[PARM1] >> 0) : 0);
};

// #316 iscachedpic(name) - a query, so it never starts a load.
const iscachedpic = function () {
  pr.state.globals_float[RETURN] = (qcpics.get(pr.getString(pr.state.globals_int[PARM0])) != null) ? 1 : 0;
};

// #318 drawgetimagesize(name) -> vector. '0 0 0' while the pic is still loading.
const drawgetimagesize = function () {
  const pic = cachePic(pr.getString(pr.state.globals_int[PARM0]), 0);
  const g = pr.state.globals_float;
  g[RETURN] = (pic != null) ? pic.width : 0;
  g[RETURN + 1] = (pic != null) ? pic.height : 0;
  g[RETURN + 2] = 0;
};

// ---- 2D extras. Both ride draw.polygon2D. The vertex scratch below is deliberately NOT the `poly`
// buffer further down: a drawline between R_BeginPolygon and R_EndPolygon must not disturb the
// polygon the QC is still building. ----

// Four vertices of [x,y,z, u,v, r,g,b,a] - draw.polygon2D's layout.
const quad = new Float32Array(4 * 9)

// One corner of `quad`. u/v are the pic's texture coordinates; untextured draws ignore them.
const quadVert = function (i: number, x: number, y: number, u: number, v: number,
  r: number, g: number, b: number, a: number) {
  const o = i * 9;
  quad[o] = x; quad[o + 1] = y; quad[o + 2] = 0;
  quad[o + 3] = u; quad[o + 4] = v;
  quad[o + 5] = r; quad[o + 6] = g; quad[o + 7] = b; quad[o + 8] = a;
};

// #315 drawline(width, pos1, pos2, rgb, alpha[, flags]) - EXT_CSQC (fte PF_CL_drawline,
// pr_menu.c:1063). Delta from FTE: we have no 2D line primitive, so the segment is expanded into a
// width-thick quad; FTE ignores the width argument, ours honours it.
const drawline = function () {
  const g = pr.state.globals_float;
  const s = vmScale();
  const width = g[PARM0] * s;
  const x1 = g[PARM1] * s, y1 = g[PARM1 + 1] * s;
  const x2 = g[PARM2] * s, y2 = g[PARM2 + 1] * s;
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if ((len === 0) || (width <= 0))
    return;
  const px = (-dy / len) * width * 0.5, py = (dx / len) * width * 0.5;
  const r = g[PARM3], gr = g[PARM3 + 1], b = g[PARM3 + 2], a = g[PARM4];
  quadVert(0, x1 + px, y1 + py, 0, 0, r, gr, b, a);
  quadVert(1, x2 + px, y2 + py, 1, 0, r, gr, b, a);
  quadVert(2, x2 - px, y2 - py, 1, 1, r, gr, b, a);
  quadVert(3, x1 - px, y1 - py, 0, 1, r, gr, b, a);
  draw.polygon2D(null, quad, 4);
};

// drawrotpic(pivot, mins, maxs, pic, rgb, alpha, angle[, flags]) - name-bound only, as in fte
// (PF_CL_drawrotpic, pr_menu.c:643). Corners are mins/maxs along axes rotated `angle` degrees about
// `pivot`, so "rotate about the centre" is mins = -maxs.
const drawrotpicInternal = function (pic: Pic, pvx: number, pvy: number,
  minx: number, miny: number, maxx: number, maxy: number, angle: number,
  r: number, g: number, b: number, a: number) {
  const rad = angle * Math.PI / 180;
  // fte's saxis/taxis: the rotated s (right) and t (down) axes of the pic.
  const sx = Math.cos(rad), sy = Math.sin(rad);
  const tx = -Math.sin(rad), ty = Math.cos(rad);
  quadVert(0, pvx + minx * sx + miny * tx, pvy + minx * sy + miny * ty, 0, 0, r, g, b, a);
  quadVert(1, pvx + maxx * sx + miny * tx, pvy + maxx * sy + miny * ty, 1, 0, r, g, b, a);
  quadVert(2, pvx + maxx * sx + maxy * tx, pvy + maxx * sy + maxy * ty, 1, 1, r, g, b, a);
  quadVert(3, pvx + minx * sx + maxy * tx, pvy + minx * sy + maxy * ty, 0, 1, r, g, b, a);
  draw.polygon2D(pic, quad, 4);
};

// void(vector pivot, vector mins, vector maxs, string pic, vector rgb, float alpha, float angle)
const drawrotpic = function () {
  const g = pr.state.globals_float;
  const pic = cachePic(pr.getString(pr.state.globals_int[PARM3]), 0);
  if (pic == null)
    return;
  const s = vmScale();
  drawrotpicInternal(pic, g[PARM0] * s, g[PARM0 + 1] * s,
    g[PARM1] * s, g[PARM1 + 1] * s, g[PARM2] * s, g[PARM2 + 1] * s, g[PARM6],
    g[PARM4], g[PARM4 + 1], g[PARM4 + 2], g[PARM5]);
  pr.state.globals_float[RETURN] = 1;
};

// #329 drawrotpic_dp(pivot, pic, size, mins, angle, rgb, alpha[, flags]) - DarkPlaces' argument
// order for the same draw (fte PF_CL_drawrotpic_dp, pr_menu.c:762); maxs is size - mins.
const drawrotpic_dp = function () {
  const g = pr.state.globals_float;
  const pic = cachePic(pr.getString(pr.state.globals_int[PARM1]), 0);
  if (pic == null)
    return;
  const s = vmScale();
  const minx = g[PARM3] * s, miny = g[PARM3 + 1] * s;
  drawrotpicInternal(pic, g[PARM0] * s, g[PARM0 + 1] * s, minx, miny,
    g[PARM2] * s - minx, g[PARM2 + 1] * s - miny, g[PARM4],
    g[PARM5], g[PARM5 + 1], g[PARM5 + 2], g[PARM6]);
  pr.state.globals_float[RETURN] = 1;
};

// ---- FTE polygons (#238 + #306-308, fte pr_clcmd.c:943 / pr_csqc.c:1547-1690) ----

// fte pr_common.h:440-446. Bits 0-1 are the blend mode, bit 2 selects the 2D (screen-space) branch.
const DRAWFLAG_2D = 4
const DRAWFLAG_TWOSIDED = 0x400
const DRAWFLAG_LINES = 0x800

// One vertex, in fte's single cl_strisvert* layout (a vec3 position for both branches): x,y,z, u,v,
// r,g,b,a. The 2D layer ignores z; the scene layer (r.scenePolygon) reads all nine.
const POLY_FLOATS = 9
// fte force-flushes the 2D batch at 32768 verts (PF_R_PolygonEnd) — its only cap, so it is ours.
const POLY_MAX_VERTS = 32768

// The in-progress polygon. `open` is fte's csqc_poly_shader != NULL gate: nothing happens unless
// R_BeginPolygon accepted the poly. `textured` tells an unnamed (untextured) shader from a named pic
// that hasn't loaded yet. `twod` picks the R_EndPolygon branch: draw now, or buffer into the scene.
const poly = {
  open: false,
  textured: false,
  twod: true,
  twosided: false,
  pic: null as Pic,
  n: 0,
  verts: new Float32Array(64 * POLY_FLOATS)
}

// fte drops the in-progress poly at both clearscene and renderscene (pr_csqc.c:2068 / 2704).
export const polyReset = function () {
  poly.open = false;
  poly.n = 0;
};

// Shader names in registration order; fte's handle is shader->id+1 (PF_shaderforname,
// pr_clcmd.c:952-956), so ours is the 1-based index into this list. Delta from FTE: a shader is only
// ever a pic here and the defaultbody vararg is ignored — we have no shader language to give a body
// to. See R_EndPolygon for what a name with no image behind it draws.
const shaderNames: string[] = []

const shaderforname = function () {
  const name = pr.getString(pr.state.globals_int[PARM0]);
  if (name.length === 0) {
    pr.state.globals_float[RETURN] = 0;
    return;
  }
  var idx = shaderNames.indexOf(name);
  if (idx < 0) {
    shaderNames.push(name);
    idx = shaderNames.length - 1;
  }
  // Start the (async) pic load now, as fte's R_RegisterSkin does synchronously. Delta from FTE: the
  // handle comes back while the pic is loading, and polys drawn with it are skipped until it lands.
  cachePic(name, 0);
  pr.state.globals_float[RETURN] = idx + 1;
};

// PARM0 of R_BeginPolygon: fte takes the NAME string (PF_R_PolygonBegin, pr_csqc.c:1563), an empty
// one meaning the untextured fill shader. Delta from FTE: a shaderforname handle is accepted too,
// since it would otherwise index the string heap with a float bit pattern.
const polyShader = function () {
  const name = pr.getString(pr.state.globals_int[PARM0]);
  if (name.length !== 0) {
    poly.textured = true;
    poly.pic = cachePic(name, 0);
    return;
  }
  const handle = pr.state.globals_float[PARM0];
  if ((handle >= 1) && (handle <= shaderNames.length) && (handle === (handle >> 0))) {
    poly.textured = true;
    poly.pic = cachePic(shaderNames[handle - 1], 0);
    return;
  }
  poly.textured = false;
  poly.pic = null;
};

// #306 R_BeginPolygon(string shadername[, float flags[, float is2d]]) (fte pr_csqc.c:1560-1604).
const R_BeginPolygon = function () {
  poly.open = false;
  poly.n = 0;
  const flags = (pr.state.argc > 1) ? (pr.state.globals_float[PARM1] >> 0) : 0;
  // fte: the explicit third arg wins, else DRAWFLAG_2D decides. A non-2D poly is buffered into the
  // scene list and drawn in world space by the next renderscene (r.scenePolygon).
  poly.twod = (pr.state.argc > 2) ? (pr.state.globals_float[PARM2] !== 0) : ((flags & DRAWFLAG_2D) !== 0);
  // fte draws a DRAWFLAG_LINES poly as a line list; we only draw fans, so it is dropped.
  if ((flags & DRAWFLAG_LINES) !== 0) {
    warnOnce('R_BeginPolygon:lines', 'CSQC: line polygons are not implemented - polygon dropped\n');
    return;
  }
  // fte maps flags&3 onto additive/modulate blend states; we have one alpha-blended pipeline per
  // backend, so the poly still draws, blended.
  if ((flags & 3) !== 0)
    warnOnce('R_BeginPolygon:blend', 'CSQC: polygon blend modes are not implemented - drawn alpha-blended\n');
  // BEF_FORCETWOSIDED (pr_csqc.c:1586); only the scene path culls, so only it honours this.
  poly.twosided = (flags & DRAWFLAG_TWOSIDED) !== 0;
  polyShader();
  poly.open = true;
};

// #307 R_PolygonVertex(vector org, vector texcoords, vector rgb, float alpha) (fte pr_csqc.c:1608).
// org is world space on the scene path and virtual canvas units on the 2D one, so only the 2D
// branch scales, and only x/y.
const R_PolygonVertex = function () {
  if (poly.open === false)
    return;
  if (poly.n >= POLY_MAX_VERTS)
    return;
  if (((poly.n + 1) * POLY_FLOATS) > poly.verts.length) {
    // Cold path: settles at the largest poly the mod ever draws.
    const grown = new Float32Array(poly.verts.length * 2);
    grown.set(poly.verts);
    poly.verts = grown;
  }
  const g = pr.state.globals_float;
  const s = (poly.twod === true) ? vmScale() : 1;
  var o = poly.n * POLY_FLOATS;
  poly.verts[o] = g[PARM0] * s;
  poly.verts[o + 1] = g[PARM0 + 1] * s;
  poly.verts[o + 2] = g[PARM0 + 2];
  poly.verts[o + 3] = g[PARM1];
  poly.verts[o + 4] = g[PARM1 + 1];
  poly.verts[o + 5] = g[PARM2];
  poly.verts[o + 6] = g[PARM2 + 1];
  poly.verts[o + 7] = g[PARM2 + 2];
  poly.verts[o + 8] = g[PARM3];
  ++poly.n;
};

// #308 R_EndPolygon() (fte pr_csqc.c:1622-1690). The 2D fan is submitted immediately, as fte's 2D
// branch does; the scene fan goes into the per-frame batch r.renderScene draws (fte's scenetris).
const R_EndPolygon = function () {
  if (poly.open === false)
    return;
  // The shader stays bound (fte pr_csqc.c:1687): only clearscene/renderscene's polyReset closes it.
  const n = poly.n;
  poly.n = 0;
  if (n < 3)
    return;
  if (poly.twod === true) {
    if ((poly.textured === true) && (poly.pic == null))
      return;    // named pic still loading or missing
    draw.polygon2D(poly.pic, poly.verts, n);
    return;
  }
  // Deliberate delta from FTE: a scene poly whose shader has no image behind it draws UNTEXTURED
  // (white, so the QC's per-vertex rgba is the whole colour) instead of being dropped — fte's scene
  // shader can be a body-only script with no image file anywhere.
  r.scenePolygon(poly.pic, poly.pic != null, poly.twosided, poly.verts, n);
};

// ---- client substitutions for the classic table (QSS pr_cmds.c:1901-2150) ----

// #8 sound(entity, channel, sample, volume, attenuation). The csqc edict number goes out negated,
// as QSS does, so csqc channels can't stomp the server entity's channels.
const cl_sound = function () {
  const g = pr.state.globals_float;
  const ent = pr.state.edicts[pr.state.globals_int[PARM0]];
  const sfx = cacheSound(pr.getString(pr.state.globals_int[PARM2]));
  if (sfx == null)
    return;
  // Same origin fixup the server does: the centre of the entity's box.
  sndorigin[0] = ent.v_float[pr.entvars.origin] + 0.5 * (ent.v_float[pr.entvars.mins] + ent.v_float[pr.entvars.maxs]);
  sndorigin[1] = ent.v_float[pr.entvars.origin1] + 0.5 * (ent.v_float[pr.entvars.mins1] + ent.v_float[pr.entvars.maxs1]);
  sndorigin[2] = ent.v_float[pr.entvars.origin2] + 0.5 * (ent.v_float[pr.entvars.mins2] + ent.v_float[pr.entvars.maxs2]);
  // Unscaled, unlike the ssqc builtin: s.startSound takes 0-1 volume and the raw ATTN_ value.
  s.startSound(-ent.num, g[PARM1] >> 0, sfx, sndorigin, g[PARM3], g[PARM4]);
};

// The csqc physics pass's sound sink (QSS World_StartSound's client branch, sv_phys.c:66-76),
// injected into sv.state.csqcStartSound by csqc.init; volume arrives 0-1, entity number negated.
export const worldStartSound = function (ent: Edict, channel: number, sample: string, volume: number, attenuation: number) {
  const sfx = cacheSound(sample);
  if (sfx == null)
    return;
  sndorigin[0] = ent.v_float[pr.entvars.origin] + 0.5 * (ent.v_float[pr.entvars.mins] + ent.v_float[pr.entvars.maxs]);
  sndorigin[1] = ent.v_float[pr.entvars.origin1] + 0.5 * (ent.v_float[pr.entvars.mins1] + ent.v_float[pr.entvars.maxs1]);
  sndorigin[2] = ent.v_float[pr.entvars.origin2] + 0.5 * (ent.v_float[pr.entvars.mins2] + ent.v_float[pr.entvars.maxs2]);
  s.startSound(-ent.num, channel, sfx, sndorigin, volume, attenuation);
};

// #177 localsound(name[, channel, volume]) - unspatialized, on the view entity (pr_ext.c:3249).
const cl_localsound = function () {
  const sfx = cacheSound(pr.getString(pr.state.globals_int[PARM0]));
  if (sfx == null)
    return;
  const channel = (pr.state.argc > 1) ? (pr.state.globals_float[PARM1] >> 0) : -1;
  const volume = (pr.state.argc > 2) ? pr.state.globals_float[PARM2] : 1;
  s.startSound(cl.clState.viewentity, channel, sfx, vec.origin, volume, 0);
};

// #74 ambientsound(pos, sample, volume, attenuation)
const cl_ambientsound = function () {
  const g = pr.state.globals_float;
  const sfx = cacheSound(pr.getString(pr.state.globals_int[PARM1]));
  if (sfx == null)
    return;
  sndorigin[0] = g[PARM0]; sndorigin[1] = g[PARM0 + 1]; sndorigin[2] = g[PARM0 + 2];
  s.staticSound(sfx, sndorigin, g[PARM2], g[PARM3]);
};

// #19/#76 precache_sound(name) - client-side, into the sound cache; echoes the name back.
const cl_precache_sound = function () {
  const name = pr.getString(pr.state.globals_int[PARM0]);
  pr.state.globals_int[RETURN] = pr.state.globals_int[PARM0];
  pr.checkEmptyString(name);
  cacheSound(name);
};

// #20/#75 precache_model(name) - client-side, into the csqc model registry; echoes the name back.
const cl_precache_model = function () {
  const name = pr.getString(pr.state.globals_int[PARM0]);
  pr.state.globals_int[RETURN] = pr.state.globals_int[PARM0];
  pr.checkEmptyString(name);
  scene.precacheModel(name);
};

// #35 lightstyle(style, value) - straight into the client's style table, as svc_lightstyle does.
const cl_lightstyle = function () {
  const style = pr.state.globals_float[PARM0] >> 0;
  if ((style < 0) || (style >= 64)) {
    con.dPrint('CSQC: lightstyle ' + style + ' out of range\n');
    return;
  }
  cl.state.lightstyle[style] = pr.getString(pr.state.globals_int[PARM1]);
};

// #48 particle(org, dir, color, count) - the client effect svc_particle runs (r.parseParticleEffect).
const cl_particle = function () {
  const g = pr.state.globals_float;
  partorigin[0] = g[PARM0]; partorigin[1] = g[PARM0 + 1]; partorigin[2] = g[PARM0 + 2];
  partdir[0] = g[PARM1]; partdir[1] = g[PARM1 + 1]; partdir[2] = g[PARM1 + 2];
  const count = g[PARM3] >> 0;
  if (count === 255)
    r.particleExplosion(partorigin);
  else
    r.runParticleEffect(partorigin, partdir, g[PARM2] >> 0, count);
};

// #418 te_gunshot(org[, count]) / #421 te_explosion(org) - the client halves of QSS's te_* pairs
// (pr_ext.c:2899/2917). QSS ignores te_gunshot's count argument (rnd=20).
const cl_te_gunshot = function () {
  const g = pr.state.globals_float;
  partorigin[0] = g[PARM0]; partorigin[1] = g[PARM0 + 1]; partorigin[2] = g[PARM0 + 2];
  r.runParticleEffect(partorigin, vec.origin, 0, 20);
};

const cl_te_explosion = function () {
  const g = pr.state.globals_float;
  partorigin[0] = g[PARM0]; partorigin[1] = g[PARM0 + 1]; partorigin[2] = g[PARM0 + 2];
  r.particleExplosion(partorigin);
  const dl = cl.allocDlight(0);
  dl.origin = [partorigin[0], partorigin[1], partorigin[2]];
  dl.radius = 350.0;
  dl.die = cl.clState.time + 0.5;
  dl.decay = 300.0;
  s.startSound(-1, 0, cl.state.tents.sfx_r_exp3, partorigin, 1.0, 1.0);
};

// The tables, built by init(): they read pf's table at build time, and pf sits in an import cycle
// with host, so they cannot be module initializers.
export let state = {
  // The classic table, indexed by builtin number, in QSS pr_csqcbuiltins order.
  builtin: [] as pr.Builtin[],
  // Extension table: the names QC binds by, resolved into the VM's builtin table per load.
  ebfs_builtins: [] as pr.ExtBuiltin[]
};

export const init = function () {
  const builtin: pr.Builtin[] = [
    unimplemented,
    shared('makevectors'),        // #1
    shared('setorigin'),          // #2
    scene.setmodel,               // #3
    shared('setsize'),            // #4
    unimplemented,                // #5
    shared('break'),              // #6
    shared('random'),             // #7
    cl_sound,                     // #8
    shared('normalize'),          // #9
    shared('error'),              // #10
    shared('objerror'),           // #11
    shared('vlen'),               // #12
    shared('vectoyaw'),           // #13
    shared('spawn'),              // #14
    shared('remove'),             // #15
    shared('traceline'),          // #16
    noCSQC('checkclient'),        // #17
    shared('find'),               // #18
    cl_precache_sound,            // #19
    cl_precache_model,            // #20
    noCSQC('stuffcmd'),           // #21
    shared('findradius'),         // #22
    noCSQC('bprint'),             // #23
    noCSQC('sprint'),             // #24
    shared('dprint'),             // #25
    shared('ftos'),               // #26
    shared('vtos'),               // #27
    shared('coredump'),           // #28
    shared('traceon'),            // #29
    shared('traceoff'),           // #30
    shared('eprint'),             // #31
    shared('walkmove'),           // #32
    unimplemented,                // #33
    shared('droptofloor'),        // #34
    cl_lightstyle,                // #35
    shared('rint'),               // #36
    shared('floor'),              // #37
    shared('ceil'),               // #38
    unimplemented,                // #39
    shared('checkbottom'),        // #40
    shared('pointcontents'),      // #41
    unimplemented,                // #42
    shared('fabs'),               // #43
    noCSQC('aim'),                // #44
    shared('cvar'),               // #45
    shared('localcmd'),           // #46
    shared('nextent'),            // #47
    cl_particle,                  // #48
    shared('ChangeYaw'),          // #49
    unimplemented,                // #50
    shared('vectoangles'),        // #51
    noCSQC('WriteByte'),          // #52
    noCSQC('WriteChar'),          // #53
    noCSQC('WriteShort'),         // #54
    noCSQC('WriteLong'),          // #55
    noCSQC('WriteCoord'),         // #56
    noCSQC('WriteAngle'),         // #57
    noCSQC('WriteString'),        // #58
    noCSQC('WriteEntity'),        // #59
    shared('sin'),                // #60
    shared('cos'),                // #61
    shared('sqrt'),               // #62
    unimplemented,                // #63
    unimplemented,                // #64
    unimplemented,                // #65
    unimplemented,                // #66
    shared('movetogoal'),         // #67
    shared('precache_file'),      // #68
    scene.makestatic,             // #69
    noCSQC('changelevel'),        // #70
    unimplemented,                // #71
    shared('cvar_set'),           // #72
    noCSQC('centerprint'),        // #73 csqc uses cprint (#338)
    cl_ambientsound,              // #74
    cl_precache_model,            // #75
    cl_precache_sound,            // #76
    shared('precache_file2'),     // #77
    noCSQC('setspawnparms')       // #78
  ];

  // loadProgs rebuilds every slot below numbuiltins from the extension table, so a classic builtin
  // missing a name here resolves to the unimplemented stub no matter what the base table says.
  const classic = function (nbr: number, name: string): pr.ExtBuiltin {
    return { defaultFnNbr: nbr, name: name, fn: builtin[nbr] };
  };

  const ebfs_builtins: pr.ExtBuiltin[] = [
    { defaultFnNbr: 0, name: null, fn: unimplemented }, // must be first — PR_LoadProgs fills gaps with it
    classic(1, 'makevectors'),
    classic(2, 'setorigin'),
    classic(3, 'setmodel'),
    classic(4, 'setsize'),
    classic(6, 'break'),
    classic(7, 'random'),
    classic(8, 'sound'),
    classic(9, 'normalize'),
    classic(10, 'error'),
    classic(11, 'objerror'),
    classic(12, 'vlen'),
    classic(13, 'vectoyaw'),
    classic(14, 'spawn'),
    classic(15, 'remove'),
    classic(16, 'traceline'),
    classic(17, 'checkclient'),
    classic(18, 'find'),
    classic(19, 'precache_sound'),
    classic(20, 'precache_model'),
    classic(21, 'stuffcmd'),
    classic(22, 'findradius'),
    classic(23, 'bprint'),
    classic(24, 'sprint'),
    classic(25, 'dprint'),
    classic(26, 'ftos'),
    classic(27, 'vtos'),
    classic(28, 'coredump'),
    classic(29, 'traceon'),
    classic(30, 'traceoff'),
    classic(31, 'eprint'),
    classic(32, 'walkmove'),
    classic(34, 'droptofloor'),
    classic(35, 'lightstyle'),
    classic(36, 'rint'),
    classic(37, 'floor'),
    classic(38, 'ceil'),
    classic(40, 'checkbottom'),
    classic(41, 'pointcontents'),
    classic(43, 'fabs'),
    classic(44, 'aim'),
    classic(45, 'cvar'),
    classic(46, 'localcmd'),
    classic(47, 'nextent'),
    classic(48, 'particle'),
    classic(49, 'ChangeYaw'),
    classic(51, 'vectoangles'),
    classic(52, 'WriteByte'),
    classic(53, 'WriteChar'),
    classic(54, 'WriteShort'),
    classic(55, 'WriteLong'),
    classic(56, 'WriteCoord'),
    classic(57, 'WriteAngle'),
    classic(58, 'WriteString'),
    classic(59, 'WriteEntity'),
    classic(60, 'sin'),
    classic(61, 'cos'),
    classic(62, 'sqrt'),
    classic(67, 'movetogoal'),
    classic(68, 'precache_file'),
    classic(69, 'makestatic'),
    classic(70, 'changelevel'),
    classic(72, 'cvar_set'),
    classic(73, 'centerprint'),
    classic(74, 'ambientsound'),
    classic(75, 'precache_model2'),
    classic(76, 'precache_sound2'),
    classic(77, 'precache_file2'),
    classic(78, 'setspawnparms'),

    // String/math extensions: pure pr.state work, identical on both VMs.
    { defaultFnNbr: 81, name: 'stof', fn: shared('stof') },
    { defaultFnNbr: 94, name: 'fmin', fn: shared('fmin') },
    { defaultFnNbr: 95, name: 'fmax', fn: shared('fmax') },
    { defaultFnNbr: 96, name: 'fbound', fn: shared('fbound') },
    { defaultFnNbr: 97, name: 'fpow', fn: shared('fpow') },
    { defaultFnNbr: 114, name: 'strlen', fn: shared('strlen') },
    { defaultFnNbr: 115, name: 'strcat', fn: shared('strcat') },
    { defaultFnNbr: 116, name: 'substring', fn: shared('substring') },
    { defaultFnNbr: 117, name: 'stov', fn: shared('stov') },
    { defaultFnNbr: 118, name: 'strzone', fn: shared('strzone') },
    { defaultFnNbr: 119, name: 'strunzone', fn: shared('strunzone') },
    { defaultFnNbr: 221, name: 'strstrofs', fn: shared('strstrofs') },
    { defaultFnNbr: 222, name: 'str2chr', fn: shared('str2chr') },
    { defaultFnNbr: 223, name: 'chr2str', fn: shared('chr2str') },
    { defaultFnNbr: 224, name: 'strconv', fn: shared('strconv') },
    { defaultFnNbr: 225, name: 'strpad', fn: shared('strpad') },
    { defaultFnNbr: 228, name: 'strncmp', fn: shared('strncmp') },
    { defaultFnNbr: 229, name: 'strcasecmp', fn: shared('strcasecmp') },
    { defaultFnNbr: 230, name: 'strncasecmp', fn: shared('strncasecmp') },
    { defaultFnNbr: 477, name: 'strdecolorize', fn: strdecolorize },
    { defaultFnNbr: 480, name: 'strtolower', fn: shared('strtolower') },
    { defaultFnNbr: 481, name: 'strtoupper', fn: shared('strtoupper') },
    { defaultFnNbr: 441, name: 'tokenize', fn: shared('tokenize') },
    { defaultFnNbr: 442, name: 'argv', fn: shared('argv') },
    { defaultFnNbr: 514, name: 'tokenize_console', fn: shared('tokenize_console') },
    { defaultFnNbr: 627, name: 'sprintf', fn: shared('sprintf') },
    // One extension registry answers on both VMs, as in QSS (pr_ext.c:7750).
    { defaultFnNbr: 99, name: 'checkextension', fn: pf.checkextension },

    // FRIK_FILE + FTE's file extensions, on the client VM too (FTE pr_csqc.c:7398-7404); the ssqc
    // impls read pr.state.openfiles, which is already per-VM.
    { defaultFnNbr: 110, name: 'fopen', fn: shared('fopen') },
    { defaultFnNbr: 111, name: 'fclose', fn: shared('fclose') },
    { defaultFnNbr: 112, name: 'fgets', fn: shared('fgets') },
    { defaultFnNbr: 113, name: 'fputs', fn: shared('fputs') },
    { defaultFnNbr: 651, name: 'frename', fn: shared('frename') },
    { defaultFnNbr: 652, name: 'fremove', fn: shared('fremove') },
    { defaultFnNbr: 653, name: 'fexists', fn: shared('fexists') },

    // EXT_CSQC 2D drawing (pr_ext.c:7892-7906). Coordinates are virtual canvas units; see vmScale.
    { defaultFnNbr: 177, name: 'localsound', fn: cl_localsound },
    { defaultFnNbr: 316, name: 'iscachedpic', fn: iscachedpic },
    { defaultFnNbr: 317, name: 'precache_pic', fn: precache_pic },
    { defaultFnNbr: 318, name: 'drawgetimagesize', fn: drawgetimagesize },
    { defaultFnNbr: 320, name: 'drawcharacter', fn: drawcharacter },
    { defaultFnNbr: 321, name: 'drawrawstring', fn: drawrawstring },
    { defaultFnNbr: 322, name: 'drawpic', fn: drawpic },
    { defaultFnNbr: 323, name: 'drawfill', fn: drawfill },
    { defaultFnNbr: 324, name: 'drawsetcliparea', fn: drawsetcliparea },
    { defaultFnNbr: 325, name: 'drawresetcliparea', fn: drawresetcliparea },
    { defaultFnNbr: 326, name: 'drawstring', fn: drawstring },
    { defaultFnNbr: 327, name: 'stringwidth', fn: stringwidth },
    { defaultFnNbr: 328, name: 'drawsubpic', fn: drawsubpic },
    // 2D extras (fte pr_csqc.c:6977/6989/6999). drawline is csqc-only in fte too (#315 is
    // PF_Fixme in its ssqc table).
    { defaultFnNbr: 315, name: 'drawline', fn: drawline },
    { defaultFnNbr: 0, name: 'drawrotpic', fn: drawrotpic },
    { defaultFnNbr: 329, name: 'drawrotpic_dp', fn: drawrotpic_dp },

    // EXT_CSQC console command registration (pr_ext.c:7936).
    { defaultFnNbr: 352, name: 'registercommand', fn: registercommand },

    // Cvar access, same impls as the ssqc table (fte spike): DP/FTE numbering.
    { defaultFnNbr: 103, name: 'cvar_string', fn: shared('cvar_string') },
    { defaultFnNbr: 448, name: 'cvar_string_dp', fn: shared('cvar_string_dp') },
    { defaultFnNbr: 93, name: 'registercvar', fn: shared('registercvar') },

    // EXT_CSQC console/screen prints (pr_ext.c #338/#339).
    { defaultFnNbr: 338, name: 'cprint', fn: cprint },
    { defaultFnNbr: 339, name: 'print', fn: print },

    // EXT_CSQC stats (pr_ext.c #330-332).
    { defaultFnNbr: 330, name: 'getstati', fn: getstati },
    { defaultFnNbr: 331, name: 'getstatf', fn: getstatf },
    { defaultFnNbr: 332, name: 'getstats', fn: getstats },

    // EXT_CSQC message reads (pr_ext.c:7944-7957). Names are QSS's, lowercase.
    { defaultFnNbr: 360, name: 'readbyte', fn: readbyte },
    { defaultFnNbr: 361, name: 'readchar', fn: readchar },
    { defaultFnNbr: 362, name: 'readshort', fn: readshort },
    { defaultFnNbr: 363, name: 'readlong', fn: readlong },
    { defaultFnNbr: 364, name: 'readcoord', fn: readcoord },
    { defaultFnNbr: 365, name: 'readangle', fn: readangle },
    { defaultFnNbr: 366, name: 'readstring', fn: readstring },
    { defaultFnNbr: 367, name: 'readfloat', fn: readfloat },
    { defaultFnNbr: 368, name: 'readentitynum', fn: readentitynum },

    // EXT_CSQC client->server event (pr_ext.c:7943).
    { defaultFnNbr: 359, name: 'sendevent', fn: sendevent },

    // EXT_CSQC scene/view (pr_ext.c:7876-7940 + #92/#240/#279/#504). See pfcl_scene.ts.
    { defaultFnNbr: 92, name: 'getlight', fn: scene.getlight },
    { defaultFnNbr: 240, name: 'checkpvs', fn: scene.checkpvs },
    { defaultFnNbr: 279, name: 'touchtriggers', fn: scene.touchtriggers },
    { defaultFnNbr: 300, name: 'clearscene', fn: scene.clearscene },
    { defaultFnNbr: 301, name: 'addentities', fn: scene.addentities },
    { defaultFnNbr: 302, name: 'addentity', fn: scene.addentity },
    { defaultFnNbr: 303, name: 'setproperty', fn: scene.setproperty },
    { defaultFnNbr: 304, name: 'renderscene', fn: scene.renderscene },
    { defaultFnNbr: 305, name: 'dynamiclight_add', fn: scene.dynamiclight_add },
    // FTE polygons (fte pr_csqc.c:6837/6959-6961), 2D canvas and 3D scene both.
    { defaultFnNbr: 238, name: 'shaderforname', fn: shaderforname },
    { defaultFnNbr: 306, name: 'R_BeginPolygon', fn: R_BeginPolygon },
    { defaultFnNbr: 307, name: 'R_PolygonVertex', fn: R_PolygonVertex },
    { defaultFnNbr: 308, name: 'R_EndPolygon', fn: R_EndPolygon },
    { defaultFnNbr: 309, name: 'getproperty', fn: scene.getproperty },
    { defaultFnNbr: 310, name: 'unproject', fn: scene.unproject },
    { defaultFnNbr: 311, name: 'project', fn: scene.project },
    { defaultFnNbr: 333, name: 'setmodelindex', fn: scene.setmodelindex },
    { defaultFnNbr: 334, name: 'modelnameforindex', fn: scene.modelnameforindex },
    { defaultFnNbr: 335, name: 'particleeffectnum', fn: scene.particleeffectnum },
    { defaultFnNbr: 336, name: 'trailparticles', fn: scene.trailparticles },
    { defaultFnNbr: 337, name: 'pointparticles', fn: scene.pointparticles },
    { defaultFnNbr: 340, name: 'keynumtostring', fn: scene.keynumtostring },
    { defaultFnNbr: 341, name: 'stringtokeynum', fn: scene.stringtokeynum },
    { defaultFnNbr: 342, name: 'getkeybind', fn: scene.getkeybind },
    { defaultFnNbr: 343, name: 'setcursormode', fn: scene.setcursormode },
    // getcursormode has no DP number of its own - QSS gives it 0, i.e. name-binding only.
    { defaultFnNbr: 0, name: 'getcursormode', fn: scene.getcursormode },
    // #344 getmousepos is menuqc-only in QSS (PF_NoCSQC, pr_ext.c:7926): "nasty convoluted DP
    // extension... use CSQC_InputEvent for such things in csqc mods".
    { defaultFnNbr: 344, name: 'getmousepos', fn: noCSQC('getmousepos') },
    { defaultFnNbr: 345, name: 'getinputstate', fn: scene.getinputstate },
    { defaultFnNbr: 346, name: 'setsensitivityscaler', fn: scene.setsensitivityscaler },
    { defaultFnNbr: 348, name: 'getplayerkeyvalue', fn: scene.getplayerkeyvalue },
    { defaultFnNbr: 349, name: 'isdemo', fn: scene.isdemo },
    { defaultFnNbr: 350, name: 'isserver', fn: scene.isserver },
    { defaultFnNbr: 351, name: 'SetListener', fn: scene.setlistener },
    { defaultFnNbr: 354, name: 'serverkey', fn: scene.serverkey },
    { defaultFnNbr: 355, name: 'getentitytoken', fn: scene.getentitytoken },
    { defaultFnNbr: 504, name: 'getentity', fn: scene.getentity },

    // ---- The VM-generic half of fte's breadth: fte serves one pr_bgcmd.c set to both VMs at the
    // same numbers, and these impls read nothing but pr.state, so the ssqc registration is reused
    // by name. Numbers cited are pr_csqc.c's. ----
    { defaultFnNbr: 460, name: 'buf_create', fn: shared('buf_create') },
    { defaultFnNbr: 461, name: 'buf_del', fn: shared('buf_del') },
    { defaultFnNbr: 462, name: 'buf_getsize', fn: shared('buf_getsize') },
    { defaultFnNbr: 463, name: 'buf_copy', fn: shared('buf_copy') },
    { defaultFnNbr: 464, name: 'buf_sort', fn: shared('buf_sort') },
    { defaultFnNbr: 465, name: 'buf_implode', fn: shared('buf_implode') },
    { defaultFnNbr: 466, name: 'bufstr_get', fn: shared('bufstr_get') },
    { defaultFnNbr: 467, name: 'bufstr_set', fn: shared('bufstr_set') },
    { defaultFnNbr: 468, name: 'bufstr_add', fn: shared('bufstr_add') },
    { defaultFnNbr: 469, name: 'bufstr_free', fn: shared('bufstr_free') },
    { defaultFnNbr: 535, name: 'buf_loadfile', fn: shared('buf_loadfile') },
    { defaultFnNbr: 536, name: 'buf_writefile', fn: shared('buf_writefile') },
    { defaultFnNbr: 479, name: 'tokenizebyseparator', fn: shared('tokenizebyseparator') },
    { defaultFnNbr: 276, name: 'frameforname', fn: shared('frameforname') },
    { defaultFnNbr: 277, name: 'frameduration', fn: shared('frameduration') },
    { defaultFnNbr: 284, name: 'frametoname', fn: shared('frametoname') },
    { defaultFnNbr: 0, name: 'modelframecount', fn: shared('modelframecount') },
    { defaultFnNbr: 0, name: 'checkbuiltin', fn: shared('checkbuiltin') },
    { defaultFnNbr: 218, name: 'bitshift', fn: shared('bitshift') },
    { defaultFnNbr: 0, name: 'crossproduct', fn: shared('crossproduct') },
    { defaultFnNbr: 245, name: 'mod', fn: shared('mod') },
    { defaultFnNbr: 259, name: 'stoi', fn: shared('stoi') },
    { defaultFnNbr: 260, name: 'itos', fn: shared('itos') },
    { defaultFnNbr: 261, name: 'stoh', fn: shared('stoh') },
    { defaultFnNbr: 262, name: 'htos', fn: shared('htos') },
    { defaultFnNbr: 0, name: 'ftoi', fn: shared('ftoi') },
    { defaultFnNbr: 0, name: 'itof', fn: shared('itof') },
    { defaultFnNbr: 0, name: 'strtrim', fn: shared('strtrim') },
    { defaultFnNbr: 639, name: 'digest_hex', fn: shared('digest_hex') },
    { defaultFnNbr: 384, name: 'memalloc', fn: shared('memalloc') },
    { defaultFnNbr: 385, name: 'memfree', fn: shared('memfree') },
    { defaultFnNbr: 386, name: 'memcpy', fn: shared('memcpy') },
    { defaultFnNbr: 387, name: 'memfill8', fn: shared('memfill8') },
    { defaultFnNbr: 388, name: 'memgetval', fn: shared('memgetval') },
    { defaultFnNbr: 389, name: 'memsetval', fn: shared('memsetval') },
    { defaultFnNbr: 390, name: 'memptradd', fn: shared('memptradd') },
    { defaultFnNbr: 513, name: 'uri_get', fn: shared('uri_get') },

    // VM-generic impls reused from pf.ts by name; te_*/getmodelindex are client-side (QSS pr_ext.c
    // cl halves / FTE PF_getmodelindex).
    { defaultFnNbr: 90, name: 'tracebox', fn: shared('tracebox') },
    { defaultFnNbr: 98, name: 'findfloat', fn: shared('findfloat') },
    { defaultFnNbr: 353, name: 'wasfreed', fn: shared('wasfreed') },
    { defaultFnNbr: 503, name: 'whichpack', fn: shared('whichpack') },
    { defaultFnNbr: 444, name: 'search_begin', fn: shared('search_begin') },
    { defaultFnNbr: 445, name: 'search_end', fn: shared('search_end') },
    { defaultFnNbr: 446, name: 'search_getsize', fn: shared('search_getsize') },
    { defaultFnNbr: 447, name: 'search_getfilename', fn: shared('search_getfilename') },
    { defaultFnNbr: 200, name: 'getmodelindex', fn: scene.getmodelindex },
    { defaultFnNbr: 418, name: 'te_gunshot', fn: cl_te_gunshot },
    { defaultFnNbr: 421, name: 'te_explosion', fn: cl_te_explosion }
  ];

  state.builtin = builtin;
  state.ebfs_builtins = ebfs_builtins;
  pr.registerExtTable('csqc', ebfs_builtins);   // for pr_scanprogs
};
