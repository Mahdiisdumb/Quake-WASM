import * as msg from './msg'
import * as con from './console'
import * as csqc from './csqc'
import * as cvar from './cvar'
import * as com from './com'
import * as cl from './cl'
import * as protocol from './protocol'
import { Client } from './types/Client'

export enum CMD_SOURCE {
	src_client,
	src_command,
	src_server
}
export type Function = {
  name: string;
  // null = no engine handler; the command exists only so CSQC_ConsoleCommand can see it
  // (registercommand #352, QSS pr_ext.c:5961-5965).
  command: (() => any) | null;
  // Client progs gets first refusal; the engine handler runs only if it declines
  // (QSS cmd_function_t::qcinterceptable, cmd.c:866).
  interceptable?: boolean;
  // Servers send this by stufftext (QSS src_server commands). Only these are taken out of the
  // stufftext stream before CSQC_Parse_StuffCmd sees it.
  fromServer?: boolean;
}
export type Alias = {
  name: string;
  value: string
}
export type CmdState = {
  wait: boolean;
  alias: Alias[];
  text: string;
  argv: string[];
  functions: Function[];
  client: Client | null;
  args: string;
  cmdSource: CMD_SOURCE;
  pendingCommand: Promise<unknown> | null;
  // Rejection from pendingCommand, rethrown on the next execute() so it
  // surfaces on the frame path (host error handling + error reporting).
  pendingCommandError: unknown | null;
}

const initState = (): CmdState => {
  return {
    wait: false,
    alias: [],
    text: '',
    argv: [],
    functions: [],
    client: null,
    args: '',
    cmdSource: CMD_SOURCE.src_client,
    pendingCommand: null,
    pendingCommandError: null
  }
}

export let state: CmdState = initState()

const wait_f = function()
{
  state.wait = true;
}

const stuffCmds_f = function()
{
  var i, s = false, build = '', c;
  for (i = 0; i < com.state.argv.length; ++i)
  {
    c = com.state.argv[i].charCodeAt(0);
    if (s === true)
    {
      if (c === 43)
      {
        build += ('\n' + com.state.argv[i].substring(1) + ' ');
        continue;
      }
      if (c === 45)
      {
        s = false;
        build += '\n';
        continue;
      }
      build += (com.state.argv[i] + ' ');
      continue;
    }
    if (c === 43)
    {
      s = true;
      build += (com.state.argv[i].substring(1) + ' ');
    }
  }
  if (build.length !== 0){
    state.text = build + '\n' + state.text;
  }
};

const exec_f = async function()
{
  if (state.argv.length !== 2)
  {
    con.print('exec <filename> : execute a script file\n');
    return;
  }
  var f = await com.loadTextFile(state.argv[1]);
  if (f == null)
  {
    con.print('couldn\'t exec ' + state.argv[1] + '\n');
    return;
  }
  con.print('execing ' + state.argv[1] + '\n');
  state.text = f + state.text;
};

const echo_f = function()
{
  var i;
  for (i = 1; i < state.argv.length; ++i)
    con.print(state.argv[i] + ' ');
  con.print('\n');
};

const alias_f = function()
{
  var i;
  if (state.argv.length <= 1)
  {
    con.print('Current alias commands:\n');
    for (i = 0; i < state.alias.length; ++i)
      con.print(state.alias[i].name + ' : ' + state.alias[i].value + '\n');
  }
  var s = state.argv[1], value = '';
  for (i = 0; i < state.alias.length; ++i)
  {
    if (state.alias[i].name === s)
      break;
  }
  var j;
  for (j = 2; j < state.argv.length; ++j)
  {
    value += state.argv[j];
    if (j !== state.argv.length)
      value += ' ';
  }
  state.alias[i] = {name: s, value: value + '\n'};
};


const tokenizeString = function(text: string)
{
  state.argv = [];
  var i, c;
  for (;;)
  {
    for (i = 0; i < text.length; ++i)
    {
      c = text.charCodeAt(i);
      if ((c > 32) || (c === 10))
        break;
    }
    if (state.argv.length === 1)
      state.args = text.substring(i);
    if ((text.charCodeAt(i) === 10) || (i >= text.length))
      return;
    text = com.parse(text);
    if (text == null)
      return;
    state.argv[state.argv.length] = com.state.token;
  }
};

export const completeCommand = function(partial: string)
{
  if (partial.length === 0)
    return;
  var i;
  for (i = 0; i < state.functions.length; ++i)
  {
    if (state.functions[i].name.substring(0, partial.length) === partial)
      return state.functions[i].name;
  }
};

export const executeString = function(text: string, cmdSource: CMD_SOURCE): void | Promise<unknown>
{
  state.cmdSource = cmdSource;
  tokenizeString(text);
  if (state.argv.length === 0)
    return;
  var name = state.argv[0].toLowerCase();
  var i;
  for (i = 0; i < state.functions.length; ++i)
  {
    if (state.functions[i].name === name)
    {
      // QSS Cmd_ExecuteString (cmd.c:857-899). csqc.consoleCommand leaves the csqc VM switched
      // out before returning, so the engine handler runs outside any VM sandwich.
      const f = state.functions[i];
      if ((f.command != null) && (f.interceptable !== true))
        return f.command();
      if (csqc.consoleCommand(text))
        return;
      if (f.command != null)
        return f.command();
      // Registered by progs that is no longer running: QSS keeps it registered for the session
      // and reports, rather than falling through to aliases/cvars.
      con.print('gamecode not running, cannot "' + name + '"\n');
      return;
    }
  }
  for (i = 0; i < state.alias.length; ++i)
  {
    if (state.alias[i].name === name)
    {
      state.text = state.alias[i].value + state.text;
      return;
    }
  }
  if (cvar.command() !== true)
    con.print('Unknown command "' + name + '"\n');
};

export const forwardToServer = function()
{
  if (cl.cls.state !== cl.ACTIVE.connected)
  {
    con.print('Can\'t "' + state.argv[0] + '", not connected\n');
    return;
  }
  if (cl.cls.demoplayback === true)
    return;
  var args = String.fromCharCode(protocol.CLC.stringcmd);
  if (state.argv[0].toLowerCase() !== 'cmd')
    args += state.argv[0] + ' ';
  else if (state.args === 'pext' && (cl.cvr.cl_nopext == null || cl.cvr.cl_nopext.value === 0))
  {
    // Answer `cmd pext` with (magic, mask) pairs (QSS Cmd_ForwardToServer, cmd.c:965-973).
    // cl_nopext 1 falls through and forwards a bare `pext`, negotiating nothing.
    args += 'pext';
    if (protocol.PEXT1_SUPPORTED_CLIENT !== 0)
      args += ' 0x' + protocol.PROTOCOL_FTE_PEXT1.toString(16) + ' 0x' + protocol.PEXT1_SUPPORTED_CLIENT.toString(16);
    if (protocol.PEXT2_SUPPORTED_CLIENT !== 0)
      args += ' 0x' + protocol.PROTOCOL_FTE_PEXT2.toString(16) + ' 0x' + protocol.PEXT2_SUPPORTED_CLIENT.toString(16);
    msg.writeString(cl.cls.message, args);
    return;
  }
  if (state.argv.length >= 2)
    args += state.args;
  else
    args += '\n';
  msg.writeString(cl.cls.message, args);
}

export const forwardToServer_string = function(command: string) {
  if (cl.cls.state !== cl.ACTIVE.connected) return
  if (cl.cls.demoplayback === true) return
  msg.writeString(cl.cls.message, String.fromCharCode(protocol.CLC.stringcmd) + command + '\n')
}

export const addCommand = function(name: string, command: (() => any) | null, opts?: { interceptable?: boolean, fromServer?: boolean })
{
  var i;
  for (i = 0; i < cvar.vars.length; ++i)
  {
    if (cvar.vars[i].name === name)
    {
      con.print('cmd.addCommand: ' + name + ' already defined as a var\n');
      return;
    }
  }
  for (i = 0; i < state.functions.length; ++i)
  {
    if (state.functions[i].name === name)
    {
      con.print('cmd.addCommand: ' + name + ' already defined\n');
      return;
    }
  }
  state.functions[state.functions.length] = {
    name: name, command: command,
    interceptable: opts?.interceptable, fromServer: opts?.fromServer
  };
}

// Is `name` a command the engine accepts from a server? QSS asks this through cmd_source: a
// stufftext line matches only Cmd_AddCommand_ServerCommand names, never an alias or cvar
// (cmd.c:851-911). Everything else goes to CSQC_Parse_StuffCmd.
export const isServerCommand = function(name: string): boolean
{
  const lower = name.toLowerCase();
  for (let i = 0; i < state.functions.length; ++i)
  {
    if (state.functions[i].name === lower)
      return state.functions[i].fromServer === true;
  }
  return false;
}

export const init = function()
{
  state = initState()
  
  addCommand('stuffcmds', stuffCmds_f);
  addCommand('exec', exec_f);
  addCommand('echo', echo_f);
  addCommand('alias', alias_f);
  addCommand('cmd', forwardToServer);
  addCommand('wait', wait_f);
  addCommand('set', cvar.set_f)
  addCommand('seta', cvar.set_f)

}

export const execute = function()
{
  if (state.pendingCommandError != null)
  {
    const e = state.pendingCommandError;
    state.pendingCommandError = null;
    throw e;
  }
  if (state.pendingCommand != null)
    return;
  var c, line = '', quotes = false;
  while (state.text.length !== 0)
  {
    c = state.text.charCodeAt(0);
    state.text = state.text.substring(1);
    if (c === 34)
    {
      quotes = !quotes;
      line += '\x22';
      continue;
    }
    if (((quotes === false) && (c === 59)) || (c === 10))
    {
      if (line.length === 0)
        continue;
      const r = executeString(line, CMD_SOURCE.src_command);
      if (r != null && typeof (r as any).then === 'function')
      {
        state.pendingCommand = (r as Promise<unknown>).then(
          () => { state.pendingCommand = null; },
          (e) => { state.pendingCommand = null; state.pendingCommandError = e; }
        );
        return;
      }
      if (state.wait === true)
      {
        state.wait = false;
        return;
      }
      line = '';
      continue;
    }
    line += String.fromCharCode(c);
  }
  if (line.length > 0)
  {
    const r = executeString(line, CMD_SOURCE.src_command);
    if (r != null && typeof (r as any).then === 'function')
    {
      state.pendingCommand = (r as Promise<unknown>).then(
        () => { state.pendingCommand = null; },
        (e) => { state.pendingCommand = null; state.pendingCommandError = e; }
      );
    }
  }
  state.text = '';
};

export const exists = (name: string) => {
  for (let i = 0; i < state.functions.length; ++i)
  {
    if (state.functions[i].name === name)
    {
      return true
    }
  }
  
  return false;
}