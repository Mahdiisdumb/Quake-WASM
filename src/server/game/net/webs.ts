import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as sv from '../../../engine/sv'
import * as net from '../../../engine/net'
import * as def from '../../../engine/def'
import * as websocket from 'websocket'
import * as httpServer from './http'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'
import { Server } from 'http'

export const name = "websocket"
export var initialized = false
export var available = true
type WebSocketState = {
	server: websocket.server,
	http: Server,
	acceptsockets: (websocket.connection & {data_socket?: ISocket})[] ,
	colors: string[]
}
export const state: WebSocketState = {
  server: null,
  http: null,
  acceptsockets: [],
  colors: []
}

// not implemented client specific functions
export const connect = async (host: string): Promise<QConnectStatus> => {
  return 'failed'
}
export const checkForResend = (): number => {
  return 0
}
export const canSendMessage = (sock: ISocket) => {
  return true
}

export const supportedAddress = (connectionAddress: string) => {
	return connectionAddress.substring(0, 5) === 'ws://' || connectionAddress.substring(0, 6) === 'wss://'
}

export const init = function()
{
	// var palette = await com.loadFile('gfx/palette.lmp');
	// if (palette == null)
	// 	sys.error('Couldn\'t load gfx/palette.lmp');
	// var pal = new Uint8Array(palette);
	// var pal = new Uint8Array(palette), i, src = 24, c;
	// for (i = 0; i <= 13; ++i)
	// {
	// 	WEBS.colors[i] = pal[src].toString() + ',' + pal[src + 1].toString() + ',' + pal[src + 2].toString();
	// 	src += 48;
	// }

	state.server = new websocket.server;
	state.server.on('request', serverOnRequest);
	
	initialized = true

	return true;
};

export const listen = function()
{
	if (net.state.listening !== true)
	{
		state.server.unmount();
		if (state.http == null)
			return;
		state.http.close();
		state.http = null;
		return;
	}
	try
	{
    	state.http = httpServer.createHttpServer(net.state.hostport)
		state.server.mount({httpServer: state.http, maxReceivedMessageSize: def.max_message});
	}
	catch (e)
	{
		net.state.listening = false;
		return;
	}
};

export const registerWithMaster = () => {
	return httpServer.registerWithMaster()
}

export const checkNewConnections = (): ISocket => {
	if (state.acceptsockets.length === 0)
		return;
	var sock = net.newQSocket();
	var connection = state.acceptsockets.shift();
	sock.driverdata = connection;
	sock.receiveMessage = [];
	sock.address = connection.socket.remoteAddress;
	connection.data_socket = sock;
	connection.on('message', connectionOnMessage);
	connection.on('close', connectionOnClose);
	
	return sock;
};

export const getMessage = (sock: ISocket) => {
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.closeReasonCode !== -1)
		return -1;
	if (sock.receiveMessage.length === 0)
		return 0;
	var src = sock.receiveMessage.shift(), dest = new Uint8Array(net.state.message.data);
	net.state.message.cursize = src.length - 1;
	var i;
	for (i = 1; i < src.length; ++i)
		dest[i - 1] = src[i];
	return src[0];
}

export const sendMessage = (sock: ISocket, data: IDatagram) => {
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.closeReasonCode !== -1)
		return -1;
	var src = new Uint8Array(data.data), dest = Buffer.alloc(data.cursize + 1), i;
	dest[0] = 1;
	var i;
	for (i = 0; i < data.cursize; ++i)
		dest[i + 1] = src[i];
	sock.driverdata.sendBytes(dest);
	return 1;
}

export const sendUnreliableMessage = (sock: ISocket, data: IDatagram) => {
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.closeReasonCode !== -1)
		return -1;
	var src = new Uint8Array(data.data), dest = Buffer.alloc(data.cursize + 1), i;
	dest[0] = 2;
	var i;
	for (i = 0; i < data.cursize; ++i)
		dest[i + 1] = src[i];
	sock.driverdata.sendBytes(dest);
	return 1;
};

export const cnSendMessage = (sock: ISocket) => {
	if (sock.driverdata == null)
		return;
	if (sock.driverdata.closeReasonCode === -1)
		return true;
};

export const close = (sock: ISocket) => {
	if (sock.driverdata == null)
		return;
	if (sock.driverdata.closeReasonCode !== -1)
		return;
	sock.driverdata.drop(1000);
	sock.driverdata = null;
};

const connectionOnMessage = function(message: websocket.Message)
{
	if (message.type !== 'binary')
		return;
	if (message.binaryData.length > def.max_message)
		return;
	this.data_socket.receiveMessage.push(message.binaryData);
};

const connectionOnClose = function()
{
	net.close(this.data_socket);
};


const serverOnRequest = (request: websocket.request) => {
	if (sv.state.server.active !== true)
	{
		request.reject();
		return;
	}
	if ((net.state.activeconnections + state.acceptsockets.length) >= sv.state.svs.maxclients)
	{
		request.reject();
		return;
	}
	if (request.requestedProtocols[0] === 'quake')
	{
		state.acceptsockets.push(request.accept('quake', request.origin));
		return;
	}
	var i, s;
	
	// Joe - Allow clients to join with same IP (clients behind NAT)
	// for (i = 0; i < net.activeSockets.length; ++i)
	// {
	// 	s = net.activeSockets[i];
	// 	if (s.disconnected === true)
	// 		continue;
	// 	if (net.state.drivers[s.driver].name !== "websocket")
	// 		continue;
	// 	if (request.remoteAddress !== s.address)
	// 		continue;
	// 	net.close(s);
	// 	break;
	// }
};