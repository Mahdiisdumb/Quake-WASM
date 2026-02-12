import ISocket from '../../../engine/interfaces/net/ISocket'
import IDatagram from '../../../engine/interfaces/net/IDatagram'
import * as net from '../../../engine/net'
import { print } from '../sys'
import { QConnectStatus } from '../../../engine/interfaces/net/INetworkDriver'
import { defaultConfiguration } from '../../../engine/webrtc/configuration'
import { FTEBroker } from '../../../engine/webrtc/FTEBroker'
import { Signaling } from '../../../engine/webrtc/signaling'
import { IWebRTCBroker } from '../../../engine/webrtc/IWebRTCBroker'
import { RoomBroker } from '../../../engine/webrtc/RoomBroker'
import * as sys from '../sys'

export const name: string = "webrtc"
export var initialized: boolean = false;
export var available: boolean = false;

const brokerAddress = 'ws://master.frag-net.com:27950'

let websocket: WebSocket = null

type Role = 'client' | 'server'

type WebRTCHostState = {
	currentRole: 'server'
	broker: IWebRTCBroker
	acceptSockets: WebRTCDriver[],
	webRtcClients: Record<string, WebRTCDriver>
}
type WebRTCState = {
	currentRole: Role
	broker: IWebRTCBroker,

	// As Client
	webRtcDriver: WebRTCDriver | null

	// As Server
	acceptSockets: WebRTCDriver[],
	webRtcClients: Record<string, WebRTCDriver>
}

const state: WebRTCState = {
	currentRole: 'client',
	broker: null,
  acceptSockets: [],
  webRtcClients: {},
	webRtcDriver: null
}

const createSignaling = (ws: WebSocket): Signaling => {
	let eventToMessageHandler: (event: MessageEvent) => void
	return { 
		send: (data: Uint8Array | string) => {
			ws.send(data)
		},
		onmessage: (messageHandler: (data: Uint8Array | string) => void) => {
			eventToMessageHandler = (event: MessageEvent) => messageHandler(event.data)
			ws.addEventListener('message', eventToMessageHandler)
		},
		close: () => {
			if (eventToMessageHandler){
				ws.removeEventListener('message', eventToMessageHandler)
			}
		}
	}
}

export type WebRTCDriver = {
	rtc: RTCPeerConnection
	channel: RTCDataChannel
	identifier: string
	candidateCache: RTCIceCandidate[]
	clientAddress?: string
}

export const supportedAddress = (connectionAddress: string) => { 
	return connectionAddress.substring(0, 6) === 'rtc://'
}

export const init = () => { 
	if(typeof window === "undefined")
		return
	if (window['WebSocket'] == null)
		return;

	available = true;
	initialized = true
	return true;
};


export const listen = () => {
	state.currentRole = 'server'
	if (sys.state.initArgs.isHost && sys.state.initArgs.socket) {
		// For now require injection of the args from the frontend.
		initBroker(
			new RoomBroker(createSignaling(sys.state.initArgs.socket), sys.state.initArgs.playerId))
	} else {
		const wsHost = `${brokerAddress}/FTE-Quake/${net.cvr.hostname.string}`
		websocket = new WebSocket(wsHost, ['rtc_host'])
		websocket.binaryType = "arraybuffer";

		initBroker(new FTEBroker(createSignaling(websocket)))
	}
	state.broker.sendReady('0')
}


const initBroker = (broker: IWebRTCBroker) => {
	state.broker = broker
	state.broker.on('greeting', ({gameName}) => {
		print(`WebRTC: Connected to broker for ${gameName}\n`)
	})
	
	state.broker.on('newPeer', async ({ clientId, iceServers, clientAddress }) => {
		
		if (state.currentRole === 'server') {
			acceptNewConnection(clientId, iceServers, clientAddress)
		} else {
			if (iceServers) {
				state.webRtcDriver.rtc.setConfiguration({
					...defaultConfiguration,
					iceServers
				})
			}
			state.webRtcDriver.identifier = clientId
			const offer = await state.webRtcDriver.rtc.createOffer()
			await state.webRtcDriver.rtc.setLocalDescription(offer)
			state.broker.sendOffer(state.webRtcDriver.identifier, offer as RTCSessionDescription)
		}
	})

	state.broker.on('offer', async ({clientId, offerOrAnswer}) => {
		let driver: WebRTCDriver
		if (state.currentRole === 'server') {
			driver = state.webRtcClients[clientId]
			if (!driver) {
				print(`WebRTC: Could not find client for ${clientId}\n`)
				return
			}

			await driver.rtc.setRemoteDescription(offerOrAnswer)
			const answer = await driver.rtc.createAnswer()
			await driver.rtc.setLocalDescription(answer)
			
			state.broker.sendOffer(clientId, answer as RTCSessionDescription)
		} else {
			driver = state.webRtcDriver

			await driver.rtc.setRemoteDescription(offerOrAnswer)
		}
		if (driver.rtc.remoteDescription) {
			for (let i = 0; i < driver.candidateCache.length; i++) {
				await driver.rtc.addIceCandidate(driver.candidateCache[i])	
			}
			driver.candidateCache = []
		}
	})

	state.broker.on('candidate', async ({clientId, candidate}) => {
		if (!candidate) return
		const driver = state.currentRole === 'server' ? state.webRtcClients[clientId] : state.webRtcDriver;
		if (!driver) {
			print(`WebRTC: Could not find client for ${clientId}\n`)
			return
		}
		if (!driver.rtc.remoteDescription) {
			driver.candidateCache.push(candidate)
		}

		try {
			await driver.rtc.addIceCandidate(candidate)
		} catch(e) {
			print('WebRTC: Failed to add ice candidate: ' + e.message)
		}
	})
}

export const connect = async (host: string): Promise<QConnectStatus> =>
{
	const isRoom = host === 'rtc://netquake.io/room'
	if (isRoom && !sys.state.initArgs.socket) {
		print('Can only join a room game from the room page.')
		return 'failed'
	}

	if (host.length <= 5)
		return 'failed'
	if (host.charCodeAt(6) === 47)
		return 'failed'

	state.currentRole = 'client'
		
	var sock = net.newQSocket();
	sock.disconnected = true;
	sock.receiveMessage = []
	sock.address = host;

	if (isRoom) {
		initBroker(new RoomBroker(createSignaling(sys.state.initArgs.socket), sys.state.initArgs.playerId))
	} else {
		const hostName = host.substring(6)
		try
		{
			websocket = new WebSocket(brokerAddress + '/FTE-Quake/' + hostName, ['rtc_client'])
			websocket.binaryType = "arraybuffer";
		}
		catch (e)
		{
			debugger
			return 'failed'
		}
		initBroker(new FTEBroker(createSignaling(websocket)))
	}

	state.webRtcDriver = createDriver(sock)
	sock.driverdata = state.webRtcDriver
	net.state.newsocket = sock;
	
	state.broker.sendReady('0')

	return 'connected';
};

export const acceptNewConnection = async (identifier: string, iceServers?: RTCIceServer[], clientAddress?: string) => {
	const rtcPeer = new RTCPeerConnection({
		...defaultConfiguration,
		// Non Standard API config options
		// only for node-rtc
		iceServers: iceServers || []
	})

	rtcPeer.onicecandidate = (event) => {
		if(event.candidate && state.broker) {
			state.broker.sendCandidate(identifier, event.candidate)
		}
	}

	const driver: WebRTCDriver = {
		rtc: rtcPeer,
		channel: null,  
		identifier,
		candidateCache: [],
		clientAddress: clientAddress
	}
	
	rtcPeer.ondatachannel = ({channel}) => {
		driver.channel = channel
	}

	state.webRtcClients[identifier] = driver
	state.acceptSockets.push(driver)
} 

const createDriver = (sock: ISocket) => {
   const rtcPeer = new RTCPeerConnection(
		defaultConfiguration
	)
	const channel = rtcPeer.createDataChannel('quake')
	channel.onmessage = (ev) => {
		sock.receiveMessage.push(ev.data)
	}
	
	channel.onclose = () => {
		print('SERVER - WebRTC: Data channel closed')
		close(sock)
	}

	rtcPeer.onicecandidate = (event) => {
		if(event.candidate && state.broker) {
			state.broker.sendCandidate(driver.identifier, event.candidate)
		}
	}

	const driver: WebRTCDriver = {
		rtc: rtcPeer,
		channel, 
		identifier: '0',
		candidateCache: [] 
	}

	return driver
}

export const checkNewConnections = (): ISocket => {
	if (state.acceptSockets.length === 0)
		return;
	
	var sock = net.newQSocket();
	var driver = state.acceptSockets.shift();

	if (driver.channel) {
		print('SERVER - WebRTC: Data channel already open')
		driver.channel.onmessage = (ev) => { sock.receiveMessage.push(ev.data)}
		driver.channel.onclose = () => {
			close(sock)
		}
	} else {
		driver.rtc.ondatachannel = ({channel}) => {
			driver.channel = channel
			channel.onmessage = (ev) => {
				sock.receiveMessage.push(ev.data)
			}
			channel.onclose = () => {
				close(sock)
			}
		}
	}
	sock.driverdata = driver
	sock.receiveMessage = [];
	sock.address = driver.clientAddress || "unknown"

	return sock;
}

export const getMessage = function(sock: ISocket)
{
	if (sock.driverdata == null)
		return -1;

	// I had this line removed to fix something but broke the "Left" message. 
	// Not sure what that something was, but it works now.
	// if (sock.driverdata.channel.readyState !== 'open')
	// 	return -1;
	if (sock.receiveMessage.length === 0)
		return 0;
	
	var buffer = sock.receiveMessage.shift()
	var message = new Uint8Array(buffer, 1, buffer.byteLength - 1)
	net.state.message.cursize = message.length;
	(new Uint8Array(net.state.message.data)).set(message);
	return message[0];
};

export const sendMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null || sock.driverdata.channel == null)
		return -1;
	if (sock.driverdata.channel.readyState !== 'open')
		return -1;
	var buf = new ArrayBuffer(data.cursize + 1), dest = new Uint8Array(buf);
	dest[0] = 1;
	dest.set(new Uint8Array(data.data, 0, data.cursize), 1);
	sock.driverdata.channel.send(buf);
	return 1;
};

export const sendUnreliableMessage = function(sock: ISocket, data: IDatagram)
{
	if (sock.driverdata == null || sock.driverdata.channel == null)
		return -1;
	if (sock.driverdata.channel.readyState !== 'open')
		return -1;
	var buf = new ArrayBuffer(data.cursize + 1), dest = new Uint8Array(buf);
	dest[0] = 2;
	dest.set(new Uint8Array(data.data, 0, data.cursize), 1);
	sock.driverdata.channel.send(buf);

	return 1;
};

export const canSendMessage = function(sock: ISocket): boolean| undefined
{
	if (sock.driverdata == null || sock.driverdata.channel == null)
		return;
	if (sock.driverdata.channel.readyState === 'open')
		return true
};

export const close = function(sock: ISocket)
{
	if (sock.driverdata != null){
		const driver = sock.driverdata as WebRTCDriver
		if (driver.channel) {
			if (driver.channel.readyState === 'open') {
				driver.channel.close()
			}
			driver.channel.onmessage = null
			driver.channel = null
		}
		if (driver.rtc) {
			driver.rtc.ondatachannel = null
			driver.rtc.onicecandidate = null
			driver.rtc.close();
			delete driver.rtc
		}
	}

	if (state.currentRole === 'client' && state.broker) {
		state.broker.sendRemove(state.webRtcDriver?.identifier)
		state.broker.close()
		state.broker = null
	}
	sock.driverdata = null;
};

// Returns -1 if disconnected, 0 if connecting, and 1 if connected
export const checkForResend = function()
{
	const peerConnectionState = net.state.newsocket.driverdata.rtc.connectionState
	const channelConnectionState = net.state.newsocket.driverdata.channel.readyState
	if (peerConnectionState === 'connected') {
		if (channelConnectionState === 'open') {
			return 1
		}
		return 0
	}
	if (peerConnectionState !== 'connecting' && peerConnectionState !== 'new')
		return -1;

	
	// 	const msg = 'ccreq_connect'
	// 	const dgram: IDatagram = {
	// 		data: new Uint8Array(),
	// 		cursize: 0
	// 	}
	// 	writeString(dgram, msg)
	// 	sendMessage(sock, dgram)
};

export const registerWithMaster = () => {
	// Cannot connect to browser server, no peer to peer.
}

export const shutdown = () => {
	if (state.broker) {
		state.broker.sendRemove(state.webRtcDriver?.identifier || '0')
		state.broker.close()
		state.broker = null
	}
}