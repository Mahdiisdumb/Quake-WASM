import * as cmd from './cmd'
import * as con from './console'
import * as cl from './cl'
import * as complete from './complete'
import * as csqc from './csqc'
import * as cvar from './cvar'
import * as m from './m'

export const KEY = {
  tab: 9,
  enter: 13,
  escape: 27,
  space: 32,
  
  backspace: 127,
  uparrow: 128,
  downarrow: 129,
  leftarrow: 130,
  rightarrow: 131,
  
  alt: 132,
  ctrl: 133,
  shift: 134,
  f1: 135,
  f2: 136,
  f3: 137,
  f4: 138,
  f5: 139,
  f6: 140,
  f7: 141,
  f8: 142,
  f9: 143,
  f10: 144,
  f11: 145,
  f12: 146,
  ins: 147,
  del: 148,
  pgdn: 149,
  pgup: 150,
  home: 151,
  end: 152,
  
  command: 170,
  pause: 255,
  
  mouse1: 200,
  mouse2: 201,
  mouse3: 202,

  mwheelup: 239,
  mwheeldown: 240,

  mouse4: 241,
  mouse5: 242
};

export const KEY_DEST = {
  game: 0,
  console: 1,
  message: 2,
  menu: 3
}

type KeyState = {
  lines: string[],
  edit_line: string,
  // Cursor position within edit_line; chars insert/delete here.
  edit_pos: number,
  history_line: number,
  bindings: string[],
  down: boolean[],
  consolekeys: boolean[],
  shift: number[],
  chat_buffer: string,
  dest: number
  team_message: boolean,
  shift_down: boolean

}
export const state: KeyState = {
  lines: [''],
  edit_line: '',
  edit_pos: 0,
  history_line: 1,
  bindings: [],
  down: [],
  consolekeys: [],
  shift: [],
  chat_buffer: '',
  dest: KEY_DEST.game,
  team_message: false,
  shift_down: false
}

// Replaces the edit line, cursor at the end. Every non-cursor-aware write goes through here.
export const setEditLine = function(text: string)
{
  state.edit_line = text;
  state.edit_pos = text.length;
};

// Inserts at the cursor.
export const insertEditLine = function(text: string)
{
  state.edit_line = state.edit_line.substring(0, state.edit_pos) + text + state.edit_line.substring(state.edit_pos);
  state.edit_pos += text.length;
};

// Console history survives reloads in localStorage; absent on the node server build.
const HISTORY_KEY = 'nq.console_history';
const HISTORY_MAX = 128;

const loadHistory = function()
{
  if (typeof localStorage === 'undefined')
    return;
  var raw = localStorage.getItem(HISTORY_KEY);
  if (raw == null)
    return;
  var lines;
  try
  {
    lines = JSON.parse(raw);
  }
  catch (e)
  {
    return;
  }
  if (Array.isArray(lines) !== true)
    return;
  var i;
  for (i = 0; i < lines.length; ++i)
  {
    if ((typeof lines[i] === 'string') && (lines[i].length !== 0))
      state.lines[state.lines.length] = lines[i];
  }
  state.history_line = state.lines.length;
};

const saveHistory = function()
{
  if (typeof localStorage === 'undefined')
    return;
  var lines = state.lines.filter(function(line) {return line.length !== 0;});
  if (lines.length > HISTORY_MAX)
    lines = lines.slice(lines.length - HISTORY_MAX);
  try
  {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(lines));
  }
  catch (e)
  {
  }
};

const keyNames = [
  {name: 'TAB', keynum: KEY.tab},
  {name: 'ENTER', keynum: KEY.enter},
  {name: 'ESCAPE', keynum: KEY.escape},
  {name: 'SPACE', keynum: KEY.space},
  {name: 'BACKSPACE', keynum: KEY.backspace},
  {name: 'UPARROW', keynum: KEY.uparrow},
  {name: 'DOWNARROW', keynum: KEY.downarrow},
  {name: 'LEFTARROW', keynum: KEY.leftarrow},
  {name: 'RIGHTARROW', keynum: KEY.rightarrow},
  {name: 'ALT', keynum: KEY.alt},
  {name: 'CTRL', keynum: KEY.ctrl},
  {name: 'SHIFT', keynum: KEY.shift},
  {name: 'F1', keynum: KEY.f1},
  {name: 'F2', keynum: KEY.f2},
  {name: 'F3', keynum: KEY.f3},
  {name: 'F4', keynum: KEY.f4},
  {name: 'F5', keynum: KEY.f5},
  {name: 'F6', keynum: KEY.f6},
  {name: 'F7', keynum: KEY.f7},
  {name: 'F8', keynum: KEY.f8},
  {name: 'F9', keynum: KEY.f9},
  {name: 'F10', keynum: KEY.f10},
  {name: 'F11', keynum: KEY.f11},
  {name: 'F12', keynum: KEY.f12},
  {name: 'INS', keynum: KEY.ins},
  {name: 'DEL', keynum: KEY.del},
  {name: 'PGDN', keynum: KEY.pgdn},
  {name: 'PGUP', keynum: KEY.pgup},
  {name: 'HOME', keynum: KEY.home},
  {name: 'END', keynum: KEY.end},
  {name: 'COMMAND', keynum: KEY.command},
  {name: 'MOUSE1', keynum: KEY.mouse1},
  {name: 'MOUSE2', keynum: KEY.mouse2},
  {name: 'MOUSE3', keynum: KEY.mouse3},
  {name: 'MOUSE4', keynum: KEY.mouse4},
  {name: 'MOUSE5', keynum: KEY.mouse5},
  {name: 'PAUSE', keynum: KEY.pause},
  {name: 'MWHEELUP', keynum: KEY.mwheelup},
  {name: 'MWHEELDOWN', keynum: KEY.mwheeldown},
  {name: 'SEMICOLON', keynum: 59}
];

const _console = function(key: number)
{
  if (key === KEY.enter)
  {
    var picked = complete.selection();
    if (picked != null)
    {
      setEditLine(complete.lineFor(picked) + ' ');
      complete.dismiss();
      complete.update(state.edit_line);
      return;
    }
    cmd.state.text += state.edit_line + '\n';
    con.print(']' + state.edit_line + '\n');
    state.lines[state.lines.length] = state.edit_line;
    if (state.edit_line.length !== 0)
      saveHistory();
    setEditLine('');
    state.history_line = state.lines.length;
    return;
  }

  if (key === KEY.tab)
  {
    complete.update(state.edit_line);
    if (complete.state.matches.length === 0)
      return;
    if ((complete.state.matches.length === 1) && (complete.state.active !== true))
    {
      setEditLine(complete.lineFor(complete.state.matches[0]) + ' ');
      complete.update(state.edit_line);
      return;
    }
    var prefix = complete.commonPrefix();
    if ((complete.state.active !== true) && (prefix !== state.edit_line))
    {
      setEditLine(prefix);
      complete.hold(state.edit_line);
      return;
    }
    setEditLine(complete.lineFor(complete.cycle(state.shift_down === true ? -1 : 1)));
    complete.hold(state.edit_line);
    return;
  }

  if (key === KEY.backspace)
  {
    if (state.edit_pos > 0)
    {
      state.edit_line = state.edit_line.substring(0, state.edit_pos - 1) + state.edit_line.substring(state.edit_pos);
      --state.edit_pos;
    }
    return;
  }

  if (key === KEY.del)
  {
    state.edit_line = state.edit_line.substring(0, state.edit_pos) + state.edit_line.substring(state.edit_pos + 1);
    return;
  }

  if (key === KEY.leftarrow)
  {
    if (state.edit_pos > 0)
      --state.edit_pos;
    return;
  }

  if (key === KEY.rightarrow)
  {
    if (state.edit_pos < state.edit_line.length)
      ++state.edit_pos;
    return;
  }

  if (key === KEY.uparrow)
  {
    complete.update(state.edit_line);
    if (complete.state.active === true)
    {
      setEditLine(complete.lineFor(complete.cycle(-1)));
      complete.hold(state.edit_line);
      return;
    }
    if (--state.history_line < 0)
      state.history_line = 0;
    setEditLine(state.lines[state.history_line]);
    return;
  }

  if (key === KEY.downarrow)
  {
    complete.update(state.edit_line);
    if (complete.state.active === true)
    {
      setEditLine(complete.lineFor(complete.cycle(1)));
      complete.hold(state.edit_line);
      return;
    }
    if (state.history_line >= state.lines.length)
      return;
    if (++state.history_line >= state.lines.length)
    {
      state.history_line = state.lines.length;
      setEditLine('');
      return;
    }
    setEditLine(state.lines[state.history_line]);
    return;
  }

  if (key === KEY.pgup || key === KEY.mwheelup)
  {
    con.state.backscroll += 2;
    if (con.state.backscroll > con.state.text.length)
      con.state.backscroll = con.state.text.length;
    return;
  }

  if (key === KEY.pgdn || key === KEY.mwheeldown)
  {
    con.state.backscroll -= 2;
    if (con.state.backscroll < 0)
      con.state.backscroll = 0;
    return;
  }

  if (key === KEY.home)
  {
    if (state.down[KEY.ctrl] === true)
    {
      con.state.backscroll = con.state.text.length - 10;
      if (con.state.backscroll < 0)
        con.state.backscroll = 0;
      return;
    }
    state.edit_pos = 0;
    return;
  }

  if (key === KEY.end)
  {
    if (state.down[KEY.ctrl] === true)
    {
      con.state.backscroll = 0;
      return;
    }
    state.edit_pos = state.edit_line.length;
    return;
  }

  if ((key < 32) || (key > 127))
    return;

  insertEditLine(String.fromCharCode(key));
};

export const message = function(key: number)
{
  if (key === KEY.enter)
  {
    if (state.team_message === true)
      cmd.state.text += 'say_team "' + state.chat_buffer + '"\n';
    else
      cmd.state.text += 'say "' + state.chat_buffer + '"\n';
    state.dest = KEY_DEST.game;
    state.chat_buffer = '';
    return;
  }
  if (key === KEY.escape)
  {
    state.dest = KEY_DEST.game;
    state.chat_buffer = '';
    return;
  }
  if ((key < 32) || (key > 127))
    return;
  if (key === KEY.backspace)
  {
    if (state.chat_buffer.length !== 0)
      state.chat_buffer = state.chat_buffer.substring(0, state.chat_buffer.length - 1);
    return;
  }
  if (state.chat_buffer.length >= 54)
    return;
  state.chat_buffer = state.chat_buffer + String.fromCharCode(key);
};

export const stringToKeynum = function(str: string)
{
  if (str.length === 1)
    return str.charCodeAt(0);
  str = str.toUpperCase();
  var i;
  for (i = 0; i < keyNames.length; ++i)
  {
    if (keyNames[i].name === str)
      return keyNames[i].keynum;
  }
};

export const keynumToString = function(keynum: number)
{
  if ((keynum > 32) && (keynum < 127))
    return String.fromCharCode(keynum);
  var i;
  for (i = 0; i < keyNames.length; ++i)
  {
    if (keyNames[i].keynum === keynum)
      return keyNames[i].name;
  }
  return '<UNKNOWN KEYNUM>';
};

// Native->QC key codes that differ; the 0..KEY.end range already matches DarkPlaces
// (QSS Key_NativeToQC/Key_QCToNative, keys.c:181/332).
const qc_keys: [number, number][] = [
  [KEY.pause, 153],
  [KEY.mouse1, 512],
  [KEY.mouse2, 513],
  [KEY.mouse3, 514],
  [KEY.mwheelup, 515],
  [KEY.mwheeldown, 516],
  [KEY.mouse4, 517],
  [KEY.mouse5, 518]
];

export const nativeToQC = function(code: number)
{
  for (var i = 0; i < qc_keys.length; ++i)
  {
    if (qc_keys[i][0] === code)
      return qc_keys[i][1];
  }
  // Keys with no QC code are reported negated, as QSS does.
  return ((code >= 0) && (code <= KEY.end)) ? code : -code;
};

export const qcToNative = function(code: number)
{
  for (var i = 0; i < qc_keys.length; ++i)
  {
    if (qc_keys[i][1] === code)
      return qc_keys[i][0];
  }
  return ((code >= 0) && (code <= KEY.end)) ? code : -1;
};

export const unbind_f = function()
{
  if (cmd.state.argv.length !== 2)
  {
    con.print('unbind <key> : remove commands from a key\n');
    return;
  }
  var b = stringToKeynum(cmd.state.argv[1]);
  if (b == null)
  {
    con.print('"' + cmd.state.argv[1] + '" isn\'t a valid key\n');
    return;
  }
  state.bindings[b] = null;
};

export const unbindall_f = function()
{
  state.bindings = [];
};

export const bind_f = function()
{
  var c = cmd.state.argv.length;
  if ((c !== 2) && (c !== 3))
  {
    con.print('bind <key> [command] : attach a command to a key\n');
    return;
  }
  var b = stringToKeynum(cmd.state.argv[1]);
  if (b == null)
  {
    con.print('"' + cmd.state.argv[1] + '" isn\'t a valid key\n');
    return;
  }
  if (c === 2)
  {
    if (state.bindings[b] != null)
      con.print('"' + cmd.state.argv[1] + '" = "' + state.bindings[b] + '"\n');
    else
      con.print('"' + cmd.state.argv[1] + '" is not bound\n');
    return;
  }

  var i, _cmd = cmd.state.argv[2];
  for (i = 3; i < c; ++i)
  {
    _cmd += ' ' + cmd.state.argv[i];
  }
  state.bindings[b] = _cmd;
};

export const writeBindings = function()
{
  var f = [];
  var i;
  for (i = 0; i < state.bindings.length; ++i)
  {
    if (state.bindings[i] != null)
      f[f.length] = 'bind "' + keynumToString(i) + '" "' + state.bindings[i] + '"\n';
  }
  return f.join('');
};

export const init = function()
{
  var i;

  for (i = 32; i < 128; ++i)
    state.consolekeys[i] = true;
  state.consolekeys[KEY.enter] = true;
  state.consolekeys[KEY.tab] = true;
  state.consolekeys[KEY.leftarrow] = true;
  state.consolekeys[KEY.rightarrow] = true;
  state.consolekeys[KEY.uparrow] = true;
  state.consolekeys[KEY.downarrow] = true;
  state.consolekeys[KEY.backspace] = true;
  state.consolekeys[KEY.del] = true;
  state.consolekeys[KEY.home] = true;
  state.consolekeys[KEY.end] = true;
  state.consolekeys[KEY.pgup] = true;
  state.consolekeys[KEY.pgdn] = true;
  state.consolekeys[KEY.shift] = true;
  state.consolekeys[KEY.mwheelup] = true;
  state.consolekeys[KEY.mwheeldown] = true;
  state.consolekeys[96] = false;
  state.consolekeys[126] = false;

  for (i = 0; i < 256; ++i)
    state.shift[i] = i;
  for (i = 97; i <= 122; ++i)
    state.shift[i] = i - 32;
  state.shift[49] = 33;
  state.shift[50] = 64;
  state.shift[51] = 35;
  state.shift[52] = 36;
  state.shift[53] = 37;
  state.shift[54] = 94;
  state.shift[55] = 38;
  state.shift[56] = 42;
  state.shift[57] = 40;
  state.shift[48] = 41;
  state.shift[45] = 95;
  state.shift[61] = 43;
  state.shift[43] = 60;
  state.shift[46] = 62;
  state.shift[47] = 63;
  state.shift[59] = 58;
  state.shift[39] = 34;
  state.shift[93] = 125;
  state.shift[96] = 126;
  state.shift[92] = 124;

  loadHistory();

  cmd.addCommand('bind', bind_f);
  cmd.addCommand('unbind', unbind_f);
  cmd.addCommand('unbindall', unbindall_f);
};

export const event = async function(key: number, down: boolean, char?: string)
{
  if (cl.cls.state === cl.ACTIVE.connecting)
    return;
  if (down === true)
  {
    if ((key !== KEY.backspace) && (key !== KEY.pause) && (state.down[key] === true))
      return;
    // if ((key >= 200) && (state.bindings[key] == null))
    //   con.print(keynumToString(key) + ' is unbound, hit F4 to set.\n');
  }
  state.down[key] = down;

  if (key === KEY.shift)
    state.shift_down = down;

  if (key === KEY.escape)
  {
    if (down !== true)
    {
      // Escape-up is delivered but its answer ignored, so a mod that swallowed the down event
      // still sees the release (QSS keys.c:1411-1414).
      csqc.keyEvent(key, down, 0);
      return;
    }
    // csqc gets first refusal on escape-down so a csqc menu can close itself (QSS keys.c:1435).
    if (csqc.keyEvent(key, down, 0))
      return;
    if ((state.dest === KEY_DEST.console) && (complete.state.active === true))
    {
      complete.dismiss();
      return;
    }
    if (state.dest === KEY_DEST.message)
      message(key);
    else if (state.dest === KEY_DEST.menu)
      await m.keydown(key);
    else
      m.toggleMenu_f();
    return;
  }

  // csqc gets first refusal on every other key, ahead of bindings/console/menu; nonzero swallows
  // it (QSS keys.c:1449-1451).
  if (csqc.keyEvent(key, down, ((char != null) && (char.length === 1)) ? char.charCodeAt(0) : 0))
    return;

  var kb;

  if (down !== true)
  {
    kb = state.bindings[key];
    if (kb != null)
    {
      if (kb.charCodeAt(0) === 43)
        cmd.state.text += '-' + kb.substring(1) + ' ' + key + '\n';
    }
    if (state.shift[key] !== key)
    {
      kb = state.bindings[state.shift[key]];
      if (kb != null)
      {
        if (kb.charCodeAt(0) === 43)
          cmd.state.text += '-' + kb.substring(1) + ' ' + key + '\n';
      }
    }
    return;
  }

  if ((cl.cls.demoplayback === true) && (state.consolekeys[key] === true) && (state.dest === KEY_DEST.game))
  {
    m.toggleMenu_f();
    return;
  }

  if (((state.dest === KEY_DEST.menu) && ((key === KEY.escape) || ((key >= KEY.f1) && (key <= KEY.f12))))
    || ((state.dest === KEY_DEST.console) && (state.consolekeys[key] !== true))
    || ((state.dest === KEY_DEST.game) && ((con.state.forcedup !== true) || (state.consolekeys[key] !== true))))
  {
    kb = state.bindings[key];
    if (kb != null)
    {
      if (kb.charCodeAt(0) === 43)
        cmd.state.text += kb + ' ' + key + '\n';
      else
        cmd.state.text += kb + '\n';
    }
    return;
  }

  // For text input use the actual typed character from the browser when available
  // (handles non-US keyboard layouts correctly). Fall back to the US shift table
  // for synthetic key events (touch controls etc.) that don't supply a char.
  let textKey = key;
  if (char && char.length === 1)
    textKey = char.charCodeAt(0);
  else if (state.shift_down === true)
    textKey = state.shift[key];

  if (state.dest === KEY_DEST.message)
    message(textKey);
  else if (state.dest === KEY_DEST.menu)
    await m.keydown(key);
  else
    _console(textKey);
};