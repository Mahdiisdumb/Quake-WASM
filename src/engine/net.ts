import * as sys from './sys'
import * as con from './console'
import * as cl from './cl'
import * as host from './host'
import * as sv from './sv'
import * as cvar from './cvar'
import * as cmd from './cmd'
import * as com from './com'
import * as def from './def'
import * as q from './q'
import * as msg from './msg'
import ISocket from './interfaces/net/ISocket'
import IDatagram from './interfaces/net/IDatagram'
import INetworkDriver from './interfaces/net/INetworkDriver'
import { CVars } from './cvar'

const NQ_NETCHAN_GAMENAME			= "QUAKE"
const NQ_NETCHAN_VERSION			= 3
const NQ_NETCHAN_VERSION_QEX		= 4	//the rerelease's id, used for nqish-over dtls.

const NETFLAG_LENGTH_MASK				= 0x0000ffff
const NETFLAG_DATA						= 0x00010000
const NETFLAG_ACK						= 0x00020000
const NETFLAG_NAK						= 0x00040000
const NETFLAG_EOM						= 0x00080000
const NETFLAG_UNRELIABLE				= 0x00100000
const NETFLAG_ZLIB						= 0x00200000	//QEx - payload contains the real (full) packet
const NETFLAG_CTL						= 0x80000000

const CCREQ_CONNECT					= 0x01
const CCREQ_SERVER_INFO				= 0x02
const CCREQ_PLAYER_INFO				= 0x03
const CCREQ_RULE_INFO				= 0x04
const CCREQ_PROQUAKE_RCON			= 0x05

const QW_GETCHALLENGE = "\xff\xff\xff\xffgetchallenge\n"

export const activeSockets: ISocket[] = [];

export const cvr: CVars = {}

interface NetState {
	listening: boolean,
	message: IDatagram,
	activeconnections: number,
	drivers: INetworkDriver[],
	time: number,
	driverlevel: number,
	newsocket: ISocket,
	reps: number,
	start_time: number,
	hostport: number,
	state: boolean
}

export let state: NetState = {
	listening: false,
	drivers: [],
  message: {data: new ArrayBuffer(def.max_message), cursize: 0},
	activeconnections: 0,
	time: 0,
	driverlevel: 0,
	newsocket: null,
	reps: 0,
	start_time: 0,
	hostport: 26000,
	state: false
}

export const initState = () => {
	state = {
		listening: false,
		drivers: [],
		message: {data: new ArrayBuffer(def.max_message), cursize: 0},
		activeconnections: 0,
		time: 0,
		driverlevel: 0,
		newsocket: null,
		reps: 0,
		start_time: 0,
		hostport: 26000,
		state: false
	}
}

export const newQSocket = function()
{
	var i;
	for (i = 0; i < activeSockets.length; ++i)
	{
		if (activeSockets[i].disconnected === true)
			break;
	}

	activeSockets[i] = {
		connecttime: state.time,
		lastMessageTime: state.time,
		driver: state.driverlevel,
		address: 'UNSET ADDRESS',
		disconnected: false,
		canSend: false,
		receiveMessage: null,
		receiveMessageLength: 0,
		driverdata: null,
		sendMessage: null,
		sendMessageLength: 0,
		lastSendTime: 0,
		ackSequence: 0,
		sendSequence: 0,
		unreliableSendSequence: 0,
		receiveSequence: 0,
		unreliableReceiveSequence: 0,
		addr: null,
		messages: null,
		sendNext: false
	};
	return activeSockets[i];
};

export const connect = async function(host: string)
{
	state.time = sys.floatTime();

	if (host === 'local')
	{
		state.driverlevel = 0;
		return state.drivers[state.driverlevel].connect(host);
	}

	var dfunc, ret;
	for (state.driverlevel = 1; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{ 
		dfunc = state.drivers[state.driverlevel];
		if (dfunc.initialized !== true) {
			continue;
		}
		if (!dfunc.supportedAddress(host)) {
			continue
		}
		ret = await dfunc.connect(host);
		if (ret === 'connected')
		{
			cl.cls.state = cl.ACTIVE.connecting;
			con.print('['+ dfunc.name + '] trying...\n');
			state.start_time = state.time;
			state.reps = 0;
			throw 'NET.Connect';
		}
		if (ret != 'failed')
			return ret;
	}
};

export const checkForResend = async function()
{
	state.time = sys.floatTime();
	var dfunc = state.drivers[state.newsocket.driver];
	if (state.reps <= 2)
	{
		if ((state.time - state.start_time) >= (2.5 * (state.reps + 1)))
		{
			con.print('['+ dfunc.name + '] still trying...\n');
			++state.reps;
		}
	}
	else if (state.reps === 3)
	{
		if ((state.time - state.start_time) >= 10.0)
		{
			close(state.newsocket);
			cl.cls.state = cl.ACTIVE.disconnected;
			con.print('No Response\n');
			await host.error('NET.CheckForResend: connect failed\n');
		}
	}
	var ret = dfunc.checkForResend();
	if (ret === 1)
	{
		state.newsocket.disconnected = false;
		cl.connect(state.newsocket);
		
		// // Send CCREQ
		// const dgram: IDatagram = {
		// 	data: new ArrayBuffer(def.max_message),
		// 	cursize: 0
		// }

		// msg.writeLong(dgram, 0); // Reserve space
		// msg.writeByte(dgram, CCREQ_CONNECT);
		// msg.writeString(dgram, NQ_NETCHAN_GAMENAME);
		// msg.writeByte(dgram, NQ_NETCHAN_VERSION)
		
		// msg.writeByte(dgram, 1); /*'mod'*/
		// msg.writeByte(dgram, 34); /*'mod' version*/
		// msg.writeByte(dgram, 0); /*flags*/
		// msg.writeLong(dgram, 0); //pwd); /*password*/

		// (new DataView(dgram.data)).setInt32(0, com.longSwap(NETFLAG_CTL | (dgram.data.byteLength)), true)
		// dfunc.sendMessage(state.newsocket, dgram)

		// dgram.cursize = 0
		// msg.writeString(dgram, QW_GETCHALLENGE)
		// dfunc.sendMessage(state.newsocket, dgram)
		
		// const startTime = host.state.realtime
		// while (host.state.realtime - startTime < 2.5) {
		// 	if (dfunc.getMessage(state.newsocket) === 1) {
		// 		const control = com.longSwap(msg.readLong());
		// 		const test = msg.readString();
		// 		if (test === QW_GETCHALLENGE) {
		// 			const challenge = msg.readString();
		// 			con.print('Challenge: ' + challenge + '\n');
		// 			break;
		// 		}
		// 	}
		// 	await new Promise(resolve => setTimeout(resolve, 10))
		// }
	}
	else if (ret === -1)
	{
		state.newsocket.disconnected = false;
		close(state.newsocket);
		cl.cls.state = cl.ACTIVE.disconnected;
		con.print('Network Error\n');
		await host.error('NET.CheckForResend: connect failed\n');
	}
};

export const checkNewConnections = function()
{
	state.time = sys.floatTime();
	var dfunc, ret;
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		dfunc = state.drivers[state.driverlevel];
		if (dfunc.initialized !== true)
			continue;
		ret = dfunc.checkNewConnections();
		if (ret != null)
			return ret;
	}
};

export const close = function(sock: ISocket)
{
	if (sock == null)
		return;
	// if (sock.disconnected === true)
	// 	return;
	state.time = sys.floatTime();
	state.drivers[sock.driver].close(sock);
	sock.disconnected = true;
};

export const getMessage = function(sock: ISocket)
{
	if (sock == null)
		return -1;
	if (sock.disconnected === true)
	{
		con.print('NET.GetMessage: disconnected socket\n');
		return -1;
	}
	state.time = sys.floatTime();
	var ret = state.drivers[sock.driver].getMessage(sock);
	if (sock.driver !== 0)
	{
		if (ret === 0)
		{
			if ((state.time - sock.lastMessageTime) > cvr.messagetimeout.value)
			{
				close(sock);
				return -1;
			}
		}
		else if (ret > 0)
			sock.lastMessageTime = state.time;
	}
	return ret;
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock == null)
		return -1;
	if (sock.disconnected === true)
	{
		con.print('NET.SendMessage: disconnected socket\n');
		return -1;
	}
	state.time = sys.floatTime();
	return state.drivers[sock.driver].sendMessage(sock, data);
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock == null)
		return -1;
	if (sock.disconnected === true)
	{
		con.print('NET.SendUnreliableMessage: disconnected socket\n');
		return -1;
	}
	state.time = sys.floatTime();
	return state.drivers[sock.driver].sendUnreliableMessage(sock, data);
};

export const canSendMessage = function(sock: ISocket)
{
	if (sock == null)
		return;
	if (sock.disconnected === true)
		return;
	state.time = sys.floatTime();
	return state.drivers[sock.driver].canSendMessage(sock);
};

export const sendToAll = async function(data: IDatagram)
{
	var i, 
		count = 0, 
		msg_init = [], 
		msg_sent = [];
	for (i = 0; i < sv.state.svs.maxclients; ++i)
	{
		host.state.client = sv.state.svs.clients[i];
		// Do not send to local clients`
		if (host.state.client.netconnection == null || host.state.client.netconnection.address === 'LOCAL')
			continue;
		if (host.state.client.active !== true)
		{
			msg_init[i] = msg_sent[i] = true;
			continue;
		}
		++count;
		msg_init[i] = msg_sent[i] = false;
	}
	var start = sys.floatTime();
	for (; count !== 0; )
	{
		count = 0;
		for (i = 0; i < sv.state.svs.maxclients; ++i)
		{
			host.state.client = sv.state.svs.clients[i];
			if (host.state.client.netconnection == null)
				continue;
			if (!msg_init[i])
			{
				let canSend = true
				let retry = 0;
				// wait three seconds for each client to process ack and receive reconnect
				while (!(canSend = canSendMessage(host.state.client.netconnection)) && retry++ < 3) {
					getMessage(host.state.client.netconnection);
					con.dPrint('SendToAll - waiting to send\n')
					await new Promise(resolve => setTimeout(resolve, 1000))
				}
				if (canSend)
				{
					msg_init[i] = true;
					sendMessage(host.state.client.netconnection, data);
				} else {
					con.dPrint('SendToAll - could not send to client\n')
				}
				++count;
				continue;
			}
			if (msg_sent[i] !== true)
			{
				if (canSendMessage(host.state.client.netconnection) === true)
					msg_sent[i] = true;
				else
					getMessage(host.state.client.netconnection);
				++count;
			}
		}
		if ((sys.floatTime() - start) > 5.0)
			return count;
	}
	return count;
};

const listen_f = () => {
	if (cmd.state.argv.length !== 2)
	{
		con.print('"listen" is "' + (state.listening === true ? 1 : 0) + '"\n');
		return;
	}
	var listening = (q.atoi(cmd.state.argv[1]) !== 0);
	if (state.listening === listening)
		return;
	state.listening = listening;
	
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		const driver = state.drivers[state.driverlevel]
		driver.init();
		if (driver.initialized === true)
			driver.listen();
	}
}

const maxPlayers_f = function()
{
	if (cmd.state.argv.length !== 2)
	{
		con.print('"maxplayers" is "' + sv.state.svs.maxclients + '"\n');
		return;
	}
	if (sv.state.server.active === true)
	{
		con.print('maxplayers can not be changed while a server is running.\n');
		return;
	}
	var n = q.atoi(cmd.state.argv[1]);
	if (n <= 0)
		n = 1;
	else if (n > sv.state.svs.maxclientslimit)
	{
		n = sv.state.svs.maxclientslimit;
		con.print('"maxplayers" set to "' + n + '"\n');
	}
	if ((n === 1) && (state.listening === true))
		cmd.state.text += 'listen 0\n';
	else if ((n >= 2) && (state.listening !== true))
		cmd.state.text += 'listen 1\n';
	sv.state.svs.maxclients = n;
	if (n === 1)
		cvar.set('deathmatch', '0');
	else
		cvar.set('deathmatch', '1');
};

const port_f = function()
{
	if (cmd.state.argv.length !== 2)
	{
		con.print('"port" is "' + state.hostport + '"\n');
		return;
	}
	var n = q.atoi(cmd.state.argv[1]);
	if ((n <= 0) || (n >= 65535))
	{
		con.print('Bad value, must be between 1 and 65534\n');
		return;
	}
	state.hostport = n;
	if (state.listening === true)
		cmd.state.text += 'listen 0\nlisten 1\n';
};

export const init = (drivers: INetworkDriver[]) => {
	state.time = sys.floatTime();

	cvr.messagetimeout = cvar.registerVariable('net_messagetimeout', '10');
	cvr.hostname = cvar.registerVariable('hostname', com.getCmdParam('hostname') || 'UNNAMED');
	cvr.web_connect_url = cvar.registerVariable('web_connect_url', '');
	cvr.enable_webrtc = cvar.registerVariable('enable_webrtc', com.getCmdDeclaration('webrtc') ? '1' : '0');
	cmd.addCommand('listen', listen_f);
	cmd.addCommand('maxplayers', maxPlayers_f);
	cmd.addCommand('port', port_f);

	state.drivers = drivers;
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		state.drivers[state.driverlevel].init();
	}

	state.listening = com.checkParm('-listen') != null || host.state.dedicated;
	if (state.listening) {
		var i = com.checkParm('-port');
		if (i != null)
		{
			i = q.atoi(com.state.argv[i + 1]);
			if ((i > 0) && (i <= 65534))
				state.hostport = i;
		}
		for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
		{
			const driver = state.drivers[state.driverlevel]
			if (driver.initialized === true)
				driver.listen();
		}
	}
};

export const shutdown = function()
{
	state.time = sys.floatTime();
	for (var i = 0; i < activeSockets.length; ++i)
		close(activeSockets[i]);
	for (state.driverlevel = 0; state.driverlevel < state.drivers.length; ++state.driverlevel)
	{
		const driver = state.drivers[state.driverlevel]
		if (driver.shutdown)
			driver.shutdown();
	}
};

export const registerWithMaster = () => {
	const webSocket = state.drivers.find(drv => drv.name === 'websocket')
	if (webSocket) {
		webSocket.registerWithMaster()
	}
}