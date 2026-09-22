

import * as cmd from './cmd'
import * as com from './com'
import * as host from './host'
import * as key from './key'
import * as vid from './vid'
import * as cl from './cl'
import * as mod from './mod'
import * as draw from './draw'
import * as sys from './sys'
import * as scr from './scr'
import * as s from './s'
import * as m from './m'
import * as cvar from './cvar'
import * as complete from './complete'
import * as pr from './pr'

export const state = {
  backscroll: 0,
  current: 0,
  text: [],
  debuglog: false
} as any

export const cvr = {

} as any

export const toggleConsole_f = function()
{
  scr.endLoadingPlaque();
  if (key.state.dest === key.KEY_DEST.console)
  {
    if (cl.cls.state !== cl.ACTIVE.connected)
    {
      m.menu_Main_f();
      return;
    }
    key.state.dest = key.KEY_DEST.game;
    key.setEditLine('');
    key.state.history_line = key.state.lines.length;
    return;
  }
  key.state.dest = key.KEY_DEST.console;
};

const clear_f = function()
{
  state.backscroll = 0;
  state.current = 0;
  state.text = [];
};

export const clearNotify = function()
{
  var i = state.text.length - 4;
  if (i < 0)
    i = 0;
  for (; i < state.text.length; ++i)
    state.text[i].time = 0.0;
};

const messageMode_f = function()
{
  key.state.dest = key.KEY_DEST.message;
  key.state.team_message = false;
};

const messageMode2_f = function()
{
  key.state.dest = key.KEY_DEST.message;
  key.state.team_message = true;
};


// Suggestion rows drawn above the input line at once.
const COMPLETE_ROWS = 10;

const completeRow = function(match: complete.Match)
{
  if (match.kind === 'cvar')
  {
    if (match.def != null)
      return match.name + ' "' + match.value + '" (default "' + match.def + '")';
    return match.name + ' "' + match.value + '"';
  }
  if (match.kind === 'alias')
    return match.name + ' (alias)';
  return match.name;
};

const drawCompletions = function(inputY: number)
{
  complete.update(key.state.edit_line);
  var matches = complete.state.matches;
  if (matches.length === 0)
    return;
  var size = cvr.textsize.value;
  var rows = matches.length < COMPLETE_ROWS ? matches.length : COMPLETE_ROWS;
  var fits = Math.floor((inputY - 4) / size);
  if (rows > fits)
    rows = fits;
  var overflow = matches.length > rows;
  if (overflow === true)
    --rows;
  if (rows <= 0)
    return;

  var top = 0;
  if (complete.state.selected >= rows)
    top = complete.state.selected - rows + 1;
  if (top > matches.length - rows)
    top = matches.length - rows;

  var maxChars = Math.floor(vid.state.width / size) - 2;
  var i, text;
  var chars = overflow === true ? 9 + String(matches.length - rows).length : 0;
  for (i = 0; i < rows; ++i)
  {
    text = completeRow(matches[top + i]);
    if (text.length > chars)
      chars = text.length;
  }
  if (chars > maxChars)
    chars = maxChars;
  var height = (rows + (overflow === true ? 1 : 0)) * size;
  var y = inputY - height;
  draw.fillRGBA(12, y - 2, chars * size + 8, height + 4, 0, 0, 0, 178 / 255);

  if (overflow === true)
  {
    draw.string(16, y, '... ' + (matches.length - rows) + ' more');
    y += size;
  }
  var typedLen = complete.state.token.length;
  for (i = 0; i < rows; ++i)
  {
    var match = matches[top + i];
    text = completeRow(match).substring(0, maxChars);
    if ((top + i) === complete.state.selected)
    {
      draw.fillRGBA(12, y, chars * size + 8, size, 96 / 255, 64 / 255, 32 / 255, 204 / 255);
      draw.stringWhite(16, y, text);
    }
    else
    {
      var at = match.at != null ? match.at : 0;
      var end = at + typedLen;
      draw.string(16, y, text.substring(0, at));
      draw.stringWhite(16 + at * size, y, text.substring(at, end));
      draw.string(16 + end * size, y, text.substring(end));
    }
    y += size;
  }
};

const drawInput = function()
{
  if ((key.state.dest !== key.KEY_DEST.console) && (state.forcedup !== true))
    return;
  var y = state.vislines - cvr.textsize.value - 16;
  drawCompletions(y);
  var text = ']' + key.state.edit_line;
  var cursor = 1 + key.state.edit_pos;
  // On the blink phase the cursor glyph replaces the char under it (vanilla Con_DrawInput).
  if ((host.state.realtime * 4.0) & 1)
    text = text.substring(0, cursor) + String.fromCharCode(11) + text.substring(cursor + 1);
  // Scroll horizontally to keep the cursor visible, not just the tail.
  var width = Math.floor(vid.state.width / cvr.textsize.value) - 2;
  var start = cursor >= width ? cursor - width + 1 : 0;
  draw.string(16, y, text.substring(start, start + width));
};

export const drawNotify = function()
{
  var width = (vid.state.width >> 3) - 2;
  var i = state.text.length - 4, v = 0;
  if (i < 0)
    i = 0;
  for (; i < state.text.length; ++i)
  {
    if ((host.state.realtime - state.text[i].time) > cvr.notifytime.value)
      continue;
    draw.string(cvr.textsize.value, v, state.text[i].text.substring(0, width));
    v += cvr.textsize.value;
  }
  const prfix = key.state.team_message ? 'say_team' : 'say'
  if (key.state.dest === key.KEY_DEST.message)
    draw.string(cvr.textsize.value, v, prfix + ': ' + key.state.chat_buffer + String.fromCharCode(10 + ((host.state.realtime * 4.0) & 1)));
};

export const drawConsole = function(lines: number)
{
  if (lines <= 0)
    return;
  lines = Math.floor(lines * vid.state.height * 0.005);
  draw.consoleBackground(lines);
  state.vislines = lines;
  var width = (vid.state.width * cvr.textsize.value) - 2;
  var rows;
  var y = lines - cvr.textsize.value - 16;
  var i;
  for (i = state.text.length - 1 - state.backscroll; i >= 0;)
  {
    if (state.text[i].text.length === 0)
      y -= cvr.textsize.value;
    else
      y -= Math.ceil(state.text[i].text.length / width) * cvr.textsize.value;
    --i;
    if (y <= 0)
      break;
  }
  var j, text;
  for (++i; i < state.text.length - state.backscroll; ++i)
  {
    text = state.text[i].text;
    rows = Math.ceil(text.length / width);
    if (rows === 0)
    {
      y += cvr.textsize.value;
      continue;
    }
    for (j = 0; j < rows; ++j)
    {
      draw.string(16, y, text.substr(j * width, width));
      y += cvr.textsize.value;
    }
  }
  drawInput();
};

export const dPrint = function(_msg: string)
{
  if (host.cvr.developer.value !== 0)
    print(_msg);
};

export const print = async function(_msg: string, skipnotify?: boolean)
{
  if (host.state.dedicated) {
    sys.print(_msg)
    return
  }

  state.backscroll = 0;

  var mask = 0;
  if (_msg.charCodeAt(0) <= 2)
  {
    mask = 128;
    if (_msg.charCodeAt(0) === 1)
      await s.localSound(state.sfx_talk);
    _msg = _msg.substring(1);
  }
  var i, c, n;
  for (i = 0; i < _msg.length; ++i)
  {
    c = _msg.charCodeAt(i);
    // ^-markup, consumed rather than rendered (QSS Con_Print, console.c:413-499); ^[ / ^] links
    // and malformed sequences fall through and draw literally, as QSS's do.
    if ((c === 94) && (pr.cvr.pr_checkextension != null) && (pr.cvr.pr_checkextension.value !== 0))
    {
      n = _msg.charCodeAt(i + 1);
      if (n === 94)                                                       // '^^' escape
        ++i;
      else if (((n >= 48) && (n <= 57)) ||                                // ^0..^9 colours
        (n === 104) || (n === 98) || (n === 100) || (n === 115) || (n === 114)) // ^h ^b ^d ^s ^r
      {
        ++i;
        continue;
      }
      else if ((n === 120) && conHex(i + 2) && conHex(i + 3) && conHex(i + 4)) // ^xRGB
      {
        i += 4;
        continue;
      }
      else if ((n === 38) &&                                              // ^&xy ansi colours
        (conHex(i + 2) || (_msg.charCodeAt(i + 2) === 45)) && (conHex(i + 3) || (_msg.charCodeAt(i + 3) === 45)))
      {
        i += 3;
        continue;
      }
      else if (n === 109)                                                 // ^m: toggle masking
      {
        mask ^= 128;
        ++i;
        continue;
      }
      else if ((n === 85) && conHex(i + 2) && conHex(i + 3) && conHex(i + 4) && conHex(i + 5)) // ^Uxxxx
      {
        c = (conDeHex(i + 2) << 12) | (conDeHex(i + 3) << 8) | (conDeHex(i + 4) << 4) | conDeHex(i + 5);
        i += 5;
        c = conMapCodepoint(c);
      }
      else if (n === 123)                                                 // ^{xxxxxx}
      {
        c = 0;
        i += 2;
        for (; i < _msg.length; ++i)
        {
          if (_msg.charCodeAt(i) === 125)
            break;
          if (!conHex(i))
          {
            --i;    // not part of the sequence: reprocess as a normal glyph (QSS console.c:490)
            break;
          }
          c = (c << 4) | conDeHex(i);
        }
        c = conMapCodepoint(c);
      }
    }
    if (state.text[state.current] == null)
      state.text[state.current] = {text: '', time: skipnotify === true ? -9999 : host.state.realtime};
    else if (skipnotify === true)
      state.text[state.current].time = -9999;
    if (c === 10)
    {
      if (state.text.length >= 1024)
      {
        state.text = state.text.slice(-512);
        state.current = state.text.length;
      }
      else
        ++state.current;
      continue;
    }
    state.text[state.current].text += String.fromCharCode(c + mask);
  }

  function conHex(at: number): boolean
  {
    const h = _msg.charCodeAt(at);
    return ((h >= 48) && (h <= 57)) || ((h >= 97) && (h <= 102)) || ((h >= 65) && (h <= 70));
  }
  function conDeHex(at: number): number
  {
    const h = _msg.charCodeAt(at);
    return (h <= 57) ? h - 48 : (h & 0xdf) - 55;
  }
  // Private-use 0xE0xx is quake's own charset; printable ascii passes; anything else is '?'.
  function conMapCodepoint(cp: number): number
  {
    if ((cp >= 0xe000) && (cp <= 0xe0ff))
      return cp & 0xff;
    if ((cp >= 0x20) && (cp <= 0x7f))
      return cp & 0x7f;
    return 63;
  }
};

export const init = function()
{
  state.backscroll = 0
  state.current = 0
  state.text = []
  state.debuglog = (com.checkParm('-condebug') != null);
  print('Console initialized.\n');

  cvr.textsize = cvar.registerVariable('con_textsize', "16");
  cvr.notifytime = cvar.registerVariable('con_notifytime', '3');
  cmd.addCommand('toggleconsole', toggleConsole_f);
  cmd.addCommand('messagemode', messageMode_f);
  cmd.addCommand('messagemode2', messageMode2_f);
  cmd.addCommand('clear', clear_f);
};