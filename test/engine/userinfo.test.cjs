// Run with: node --test test/engine/userinfo.test.cjs (after npm ci).
// Run the real engine without browser/game assets. The test loader exposes private
// startup helpers only to these tests; it does not change production exports.
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const ts = require('typescript');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../../src/engine');
const setupExports = {
  [resolve(root, 'host.ts')]: '\nexports.testSetup = { initCommands, findMaxClients };',
  [resolve(root, 'sv.ts')]: '\nexports.testSetup = { connectClient, sendServerinfo };'
};
require.extensions['.ts'] = (module, filename) => {
  const result = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  });
  module._compile(result.outputText + (setupExports[filename] || ''), filename);
};
const engine = name => require(resolve(root, name + '.ts'));
const host = engine('host'), sv = engine('sv'), cl = engine('cl');
const cmd = engine('cmd'), pf = engine('pf'), pr = engine('pr');
const msg = engine('msg'), sz = engine('sz'), net = engine('net');
const sys = engine('sys'), com = engine('com'), cvar = engine('cvar');
const protocol = engine('protocol'), def = engine('def'), q = engine('q');
let clients, packets;

beforeEach(async () => {
  await sys.init('', {
    init() {}, print() {}, error(s) { throw Error(s); },
    quit() {}, floatTime() { return 1; }, getExternalCommand() { return ''; }
  });
  q.state.isNaN = Number.isNaN; // The platform supplies this during normal startup.
  host.state.dedicated = true;
  host.cvr.developer = { value: 0 };
  cvar.vars.length = 0;
  com.state.argv = ['userinfo-test'];
  cmd.init();
  host.testSetup.initCommands();
  host.testSetup.findMaxClients();
  sv.state.svs.maxclients = 2;
  clients = sv.state.svs.clients.slice(0, 2);
  host.state.client = clients[0];
  pr.switchVM(pr.vms.ssqc);
  pr.clearStack(pr.state);
  pr.state.globals = new ArrayBuffer(1024);
  pr.state.globals_int = new Int32Array(pr.state.globals);
  pr.state.globals_float = new Float32Array(pr.state.globals);
  pr.state.strings = [0];
  pr.state.string_temp = pr.newString('', 128);
  pr.state.netnames = pr.newString('', 64);
  pr.state.entityfields = 128;
  pr.state.foreigndefs = false;
  sv.state.server.time = 1;
  sv.state.server.protocol = protocol.netquake;
  sv.state.server.protocolFlags = 0;
  sv.state.server.spawnKind = 'map';
  sv.state.server.lightstyles = Array(64).fill('m');
  sv.state.server.model_precache = [''];
  sv.state.server.edicts = Array.from({ length: 3 }, (_, num) => {
    const v = new ArrayBuffer(512);
    return { num, v_int: new Int32Array(v), v_float: new Float32Array(v) };
  });
  pr.state.edicts = sv.state.server.edicts;
  for (const client of clients) {
    client.active = true;
    client.spawned = false;
    client.netconnection = { driver: 0, disconnected: false, connecttime: 0, address: 'test' };
    client.edict = sv.state.server.edicts[client.num + 1];
    client.ping_times = Array(16).fill(0);
    client.spawn_parms = Array(16).fill(0);
  }
  // Tiny QC fixture: connection hooks call the actual infokey builtin and save
  // a comparison immediately, before another tempstring can overwrite it.
  // SV_ParseClientCommand increments a counter. Vanilla opcodes are
  // executed by the real QC VM, rather than replacing its connection callbacks.
  const statement = (op, a = 0, b = 0, c = 0) => ({ op, a, b, c });
  const query = result => [
    statement(34, pr.globalvars.self, 4), // STORE_ENT self -> PARM0
    statement(33, 205, 7),               // STORE_S "*ver" -> PARM1
    statement(53, 204),                  // CALL2 infokey
    statement(12, 1, 206, result),       // EQ_S RETURN == expected -> result
    statement(0)
  ];
  pr.state.statements = [statement(0), ...query(200), ...query(201), statement(6, 202, 203, 202), statement(0)];
  const fn = (name, first_statement) => ({ name: pr.newString(name, name.length + 1),
    first_statement, parm_start: 0, locals: 0, numparms: 0, parm_size: [], profile: 0 });
  pr.state.functions = [fn('', 0), fn('ClientConnect', 1), fn('PutClientInServer', 6),
    fn('SV_ParseClientCommand', 11), fn('infokey', -1), fn('SetNewParms', 0)];
  pr.state.builtins = [null, pf.infokey];
  pr.state.globals_int[pr.globalvars.ClientConnect] = 1;
  pr.state.globals_int[pr.globalvars.PutClientInServer] = 2;
  pr.state.globals_int[pr.globalvars.SetNewParms] = 5;
  pr.state.globals_int[204] = 4;
  pr.state.globals_int[205] = pr.newString('*ver', 5);
  const expected = `WebQuake ${def.webquake_version}`;
  pr.state.globals_int[206] = pr.newString(expected, expected.length + 1);
  pr.state.globals_float[203] = 1;
  packets = new Map();
  net.state.drivers = [{ getMessage(socket) {
    const packet = packets.get(socket);
    if (!packet) return 0;
    packets.delete(socket);
    net.state.message = packet;
    return 1;
  }, close() {} }];
});

function receive(packet, client = clients[0]) {
  packets.set(client.netconnection, packet);
  sv.runClients(true);
}
function send(text, client = clients[0]) {
  const packet = sz.newDatagram(4096);
  msg.writeByte(packet, protocol.CLC.stringcmd);
  msg.writeString(packet, text);
  receive(packet, client);
}
function info(client = clients[0], key = '*ver') {
  pr.state.globals_int[4] = client.edict.num;
  pr.state.globals_int[7] = pr.newString(key, key.length + 1);
  pf.infokey();
  return pr.getString(pr.state.globals_int[1]);
}

test('client signon reaches both QC connection hooks with *ver before spawn', () => {
  cl.cls.signon = 2;
  cl.cls.message = sz.newDatagram(4096);
  cl.cls.spawnparms = '';
  cl.cvr.name = { string: 'Browser player' };
  cl.cvr.color = { value: 0x43 };
  cl.signonReply();
  receive(cl.cls.message);
  assert.equal(pr.state.globals_float[200], 1, 'ClientConnect sees the engine identity');
  assert.equal(pr.state.globals_float[201], 1, 'PutClientInServer sees the engine identity');
  assert.equal(pr.state.globals_float[202], 0, 'setinfo must not reach the QC command hook');
  send('begin');
  assert.equal(clients[0].spawned, true);
});

test('setinfo is always claimed, while unknown commands still reach QC', () => {
  for (const text of ['setinfo "*ver" "QSS-M 1.0"', 'setinfo "*spectator" "1"',
    'setinfo "name" "ignored"', 'setinfo "*ver"', 'setinfo "*ver" "x" "extra"']) send(text);
  assert.equal(info(), 'QSS-M 1.0');
  assert.equal(pr.state.globals_float[202], 0);
  send(' \tsetinfo "*ver" "FTE test"');
  assert.equal(info(), 'FTE test');
  send('"setinfo" "*ver" "WebQuake 74"');
  assert.equal(info(), 'WebQuake 74');
  assert.equal(pr.state.globals_float[202], 0);
  send('setinfo_mod_command');
  send('mod_command');
  assert.equal(pr.state.globals_float[202], 2);
});

test('spawned clients cannot change or clear their engine identity', () => {
  send('setinfo "*ver" "WebQuake 74"');
  send('begin');
  send('setinfo "*ver" "spoofed"');
  send('setinfo "*ver" ""');
  assert.equal(info(), 'WebQuake 74');
  assert.equal(pr.state.globals_float[202], 0);
});

test('userinfo is isolated, defaults to empty, and can be cleared before spawn', () => {
  assert.equal(info(), '');
  const world = { edict: sv.state.server.edicts[0] };
  assert.equal(info(world, '*version'), `WebQuake ${def.webquake_version}`);
  assert.equal(info(world, '*ver'), '');
  assert.equal(info(clients[0], '*version'), '');
  send('setinfo "*ver" "WebQuake 74"');
  send('setinfo "*ver" "FTE test"', clients[1]);
  assert.equal(info(clients[0]), 'WebQuake 74');
  assert.equal(info(clients[1]), 'FTE test');
  send('setinfo "*ver" ""');
  assert.equal(info(), '');
  assert.equal(info(clients[1]), 'FTE test');
});

test('malformed or oversized values cannot replace the version', () => {
  send('setinfo "*ver" "WebQuake 74"');
  for (const value of ['a'.repeat(128), 'bad\\value', 'bad;value', 'bad\rvalue', 'bad\x01value', 'bad\x7fvalue', 'bad\x80value'])
    send(`setinfo "*ver" "${value}"`);
  assert.equal(info(), 'WebQuake 74');
  assert.equal(pr.state.globals_float[202], 0);
  send('setinfo "*ver" "' + 'a'.repeat(127) + '"');
  assert.equal(info(), 'a'.repeat(127));
});

test('console and server stufftext cannot overwrite client userinfo', () => {
  send('setinfo "*ver" "WebQuake 74"');
  cmd.executeString('setinfo "*ver" "console"', cmd.CMD_SOURCE.src_command);
  cmd.executeString('setinfo "*ver" "stufftext"', cmd.CMD_SOURCE.src_server);
  assert.equal(info(), 'WebQuake 74');
});

test('disconnect clears userinfo and a reused connection slot starts empty', () => {
  send('setinfo "*ver" "WebQuake 74"');
  host.state.client = clients[0];
  host.dropClient(true);
  assert.equal(clients[0].userinfo?.['*ver'] || '', '');
  clients[0].userinfo = { '*ver': 'previous occupant' };
  clients[0].netconnection = { driver: 0, disconnected: false, connecttime: 0, address: 'replacement' };
  sv.testSetup.connectClient(0);
  assert.equal(info(), '');
  send('setinfo "*ver" "New client"');
  assert.equal(info(), 'New client');
});

test('map signon preserves existing identity and accepts a fresh advertisement', () => {
  send('setinfo "*ver" "WebQuake 74"');
  send('begin');
  clients[0].pextknown = false;
  sv.testSetup.sendServerinfo(clients[0]);
  assert.equal(info(), 'WebQuake 74');
  send('setinfo "*ver" "WebQuake 75"');
  assert.equal(info(), 'WebQuake 75');
});
