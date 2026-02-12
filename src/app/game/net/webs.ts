import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as net from '../../../engine/net'
import * as def from '../../../engine/def'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'
import * as con from '../../../engine/console'

enum MESSAGE_TYPE {
	UNRELIABLE,
	RELIABLE = 1,
	ACK = 2,
}

const HEADER_SIZE = 5

export const name: string = "websocket"
export var initialized: boolean = false;
export var available: boolean = false;

export const supportedAddress = (connectionAddress: string) => {
	return connectionAddress.substring(0, 5) === 'ws://' || connectionAddress.substring(0, 6) === 'wss://'
}

export const init = () => { 
	if(typeof window === "undefined")
		return
	if (window['WebSocket'] == null)
		return;
	available = true
	initialized = true
	return true;
};

export const listen = () => {}
export const connect = async (host: string): Promise<QConnectStatus> =>
{
	if (host.length <= 5)
		return 'failed'
	if (host.charCodeAt(6) === 47)
		return 'failed'
	if (host.substring(0, 6) !== 'wss://' && host.substring(0, 5) !== 'ws://')
		return 'failed'
	var sock = net.newQSocket();
	sock.disconnected = true;
	sock.receiveMessage = []
	sock.address = host;
	sock.sendSequence = 0;
	sock.receiveSequence = 0;
	sock.sendMessage = new ArrayBuffer(def.max_message)
	sock.sendMessageLength = 0
	sock.ackSequence = 0;
	sock.sendSequence = 0;
	sock.canSend = true
	try
	{
		sock.driverdata = new WebSocket(host, 'quake');
	}
	catch (e)
	{
		return 'failed';
	}
	sock.driverdata.data_socket = sock;
	sock.driverdata.binaryType = 'arraybuffer';
	sock.driverdata.onerror = onError;
	sock.driverdata.onmessage = onMessage;
	net.state.newsocket = sock;
	
	return 'connected';
};

export const checkNewConnections = (): ISocket => {
	return null
}


// for debug only
// const printAscii = (dec: number) => {
// 	if (dec && dec > 31 && dec < 126) {
// 		return ' ' + String.fromCharCode(dec).padStart(2, ' ')
// 	} else {
// 		return ' 0x' + dec.toString(16).padStart(2, '0')
// 	}
// }
// export const byteArayToString = (bytes: ArrayBuffer) => {
// 	if (bytes[0] === 1) {
// 		return [].map.call(bytes.slice(0, 200), printAscii)
// 	} else {
// 		return [].map.call(bytes.slice(0, 200), x => x.toString(16))
// 	}
// }

export const getMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.readyState !== 1)
		return -1;

	while(sock.receiveMessage.length > 0) {
		const message = sock.receiveMessage.shift();
		const messageType = message[0];
		const sequence = new DataView(message.buffer).getUint32(1)
	
		if (messageType === MESSAGE_TYPE.UNRELIABLE) {
			net.state.message.cursize = message.length - HEADER_SIZE;
			(new Uint8Array(net.state.message.data)).set(message.subarray(HEADER_SIZE));
			return 2;
		} else if (messageType === MESSAGE_TYPE.RELIABLE) {
			const ack = new ArrayBuffer(HEADER_SIZE)
			const ackView = new Uint8Array(ack);
			ackView[0] = MESSAGE_TYPE.ACK
			ackView[1] = sequence >>> 24
			ackView[2] = (sequence & 0xff0000) >>> 16
			ackView[3] = (sequence & 0xff00) >>> 8
			ackView[4] = (sequence & 0xff) >>> 0
			sock.driverdata.send(ackView);
	
			if (sequence !== sock.receiveSequence)
				continue;
			++sock.receiveSequence;
			net.state.message.cursize = message.length - HEADER_SIZE;
			(new Uint8Array(net.state.message.data)).set(message.subarray(HEADER_SIZE));
			return 1
		} else if (messageType === MESSAGE_TYPE.ACK){
			
			if (sequence !== (sock.sendSequence - 1))
			{
				con.dPrint('Stale ACK received\n');
				continue;
			}
			if (sequence === sock.ackSequence)
			{
				if (++sock.ackSequence !== sock.sendSequence)
					con.dPrint('ack sequencing error\n');
			}
			else
			{
				con.dPrint('Duplicate ACK received\n');
				continue;
			}
			sock.sendMessageLength = 0;
			sock.canSend = true;
			continue;
		}
	}

	return 0
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.readyState !== 1)
		return -1;
	
	(new Uint8Array(sock.sendMessage)).set(new Uint8Array((data.data), 0))
	sock.sendMessageLength = data.cursize;

	var buf = new ArrayBuffer(data.cursize + HEADER_SIZE), 
		view = new DataView(buf);
	view.setUint8(0, MESSAGE_TYPE.RELIABLE)
	view.setUint32(1, sock.sendSequence++);
	const tryIt = (new Uint8Array(buf))
	tryIt.set(new Uint8Array(sock.sendMessage, 0, sock.sendMessageLength), HEADER_SIZE);
	sock.driverdata.send(tryIt);
	sock.lastSendTime = net.state.time;

	sock.canSend = false;
	return 1;
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null)
		return -1;
	if (sock.driverdata.readyState !== 1)
		return -1;
	var buf = new ArrayBuffer(data.cursize + HEADER_SIZE), dest = new Uint8Array(buf);
	dest[0] = MESSAGE_TYPE.UNRELIABLE
	dest.set(new Uint8Array(data.data, 0, data.cursize), HEADER_SIZE);
	sock.driverdata.send(buf);
	return 1;
};

export const canSendMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return;
	if (sock.driverdata.readyState === 1)
		return sock.canSend;
};

export const close = function(sock: ISocket)
{
	if (sock.driverdata != null)
		sock.driverdata.close(1000);
};

export const checkForResend = function()
{
	if (net.state.newsocket.driverdata.readyState === 1)
		return 1;
	if (net.state.newsocket.driverdata.readyState !== 0)
		return -1;
};

export const onError = function()
{
	net.close(this.data_socket);
};

export const registerWithMaster = () => {
	// Cannot connect to browser server, no peer to peer.
}

export const onMessage = function(message: MessageEvent)
{
	var data = message.data;
	if (typeof(data) === 'string')
		return;
	if (data.byteLength > def.max_message)
		return;
	this.data_socket.receiveMessage.push(new Uint8Array(data));
};