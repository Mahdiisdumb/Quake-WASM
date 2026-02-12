import * as com from '../../engine/com'
import * as host from '../../engine/host'
import * as key from '../../engine/key'
import * as vid from '../../engine/vid'
import * as cl from '../../engine/cl'
import * as q from '../../engine/q'
import * as _assetStore from './assetStore'
import * as loop from './net/loop'
import * as webs from './net/webs'
import * as webrtc from './net/webrtc'
import * as input from '../../engine/input'
import IAssetStore from '../../engine/interfaces/store/IAssetStore'
import { stat } from 'fs'

export const assetStore: IAssetStore = _assetStore
type QuitStatus = {quitting: false} | {quitting: true, reason?: string}
export type UIHooks = {
	// Called when the game is quitting
	quit: (reason?: string) => void
	// Initiates the UI to request a pak file
	// Passes a callback to call when finished.
	startRequestPak: (callback: (value: unknown) => void) => void
}

export type InitArgs = {
	playerId: string | null
	isHost: boolean
	socket: WebSocket | null
}

export type SysState = {
	scantokey: number[],
	oldtime: number,
	// Used to signal the event loop to quit on next frame so the game can quit gracefully.
	quitStatus: QuitStatus,
	hooks: Partial<UIHooks>,
	initArgs: null | InitArgs
}

export const state: SysState = {
  scantokey: [],
  oldtime: 0.0,
  quitStatus: {quitting:false},
  hooks: {},
	initArgs: null
}

const onbeforeunload = function()
{
	return 'Are you sure you want to quit?';
};

const oncontextmenu = function(e: MouseEvent)
{
	e.preventDefault();
};

const onfocus = async function()
{
	var i;
	for (i = 0; i < 256; ++i)
	{
		await key.event(i, false);
		key.state.down[i] = false;
	}
};

const onkeydown = async function(e: KeyboardEvent)
{
	var _key = state.scantokey[e.keyCode];
	if (_key == null)
		return;
	await key.event(_key, true);
	e.preventDefault();
};

const onkeyup = async function(e: KeyboardEvent)
{
	var _key = state.scantokey[e.keyCode];
	if (_key == null)
		return;
	await key.event(_key, false);
	e.preventDefault();
};

const onmousedown = async function(e: MouseEvent)
{
	if (!input.hasPointerLock()) {
		return
	}
	var _key;
	switch (e.which)
	{
	case 1:
		_key = key.KEY.mouse1;
		break;
	case 2:
		_key = key.KEY.mouse3;
		break;
	case 3:
		_key = key.KEY.mouse2;
		break;
	default:
		return;
	}
	await key.event(_key, true)
	e.preventDefault();
};

const onmouseup = async function(e: MouseEvent)
{
	if (!input.hasPointerLock()) {
		return
	}
	var _key;
	switch (e.which)
	{
	case 1:
		_key = key.KEY.mouse1;
		break;
	case 2:
		_key = key.KEY.mouse3;
		break;
	case 3:
		_key = key.KEY.mouse2;
		break;
	default:
		return;
	}
	await key.event(_key, false)
	e.preventDefault();
};

const onmousewheel = async function(e: WheelEvent)
{
	var _key = e.deltaY > 0 ? key.KEY.mwheelup : key.KEY.mwheeldown;
	await key.event(_key, true);
	await key.event(_key, false);
	e.preventDefault();
};

const onunload = function()
{
	host.shutdown();
};

const onwheel = async function(e: WheelEvent)
{
	var _key = e.deltaY < 0 ? key.KEY.mwheelup : key.KEY.mwheeldown;
	await key.event(_key, true);
	await key.event(_key, false);
};

export const init = async (argv: string) =>
{
	if ((document.location.protocol !== 'http:') && (document.location.protocol !== 'https:'))
		error('Protocol is ' + document.location.protocol + ', not http: or https:');
	if (Number.isNaN != null)
		q.state.isNaN = Number.isNaN;
	else
		q.state.isNaN = isNaN;

	var i;

	const args = [location.href.substring(0, location.href.length - location.search.length)]
	// var cmdline = decodeURIComponent(document.location.search);
	
	// var location = document.location;
	// var argv = [location.href.substring(0, location.href.length - location.search.length)];

	var text = '';
	var quotes = false;
	var c;
	for (i = 0; i < argv.length; ++i)
	{
		c = argv.charCodeAt(i);
		if ((c < 32) || (c > 127))
			continue;
		if (c === 34)
		{
			quotes = !quotes;
			continue;
		}
		if ((quotes === false) && (c === 32))
		{
			if (text.length === 0)
				continue;
			args.push(text);
			text = '';
			continue;
		}
		text += argv.charAt(i);
	}
	if (text.length !== 0){
		args.push(text);
	}
	com.initArgv(args);

	var elem = document.documentElement;
	vid.state.width = (elem.clientWidth <= 320) ? 320 : elem.clientWidth;
	vid.state.height = (elem.clientHeight <= 200) ? 200 : elem.clientHeight;
	
	state.quitStatus = {quitting:false};
	state.scantokey = [];
	state.scantokey[8] = key.KEY.backspace;
	state.scantokey[9] = key.KEY.tab;
	state.scantokey[13] = key.KEY.enter;
	state.scantokey[16] = key.KEY.shift;
	state.scantokey[17] = key.KEY.ctrl;
	state.scantokey[18] = key.KEY.alt;
	state.scantokey[19] = key.KEY.pause;
	state.scantokey[27] = key.KEY.escape;
	state.scantokey[32] = key.KEY.space;
	state.scantokey[33] = state.scantokey[105] = key.KEY.pgup;
	state.scantokey[34] = state.scantokey[99] = key.KEY.pgdn;
	state.scantokey[35] = state.scantokey[97] = key.KEY.end;
	state.scantokey[36] = state.scantokey[103] = key.KEY.home;
	state.scantokey[37] = state.scantokey[100] = key.KEY.leftarrow;
	state.scantokey[38] = state.scantokey[104] = key.KEY.uparrow;
	state.scantokey[39] = state.scantokey[102] = key.KEY.rightarrow;
	state.scantokey[40] = state.scantokey[98] = key.KEY.downarrow;
	state.scantokey[45] = state.scantokey[96] = key.KEY.ins;
	state.scantokey[46] = state.scantokey[110] = key.KEY.del;
	for (i = 48; i <= 57; ++i)
		state.scantokey[i] = i; // 0-9
	state.scantokey[59] = state.scantokey[186] = 59; // ;
	state.scantokey[61] = state.scantokey[187] = 61; // =
	for (i = 65; i <= 90; ++i)
		state.scantokey[i] = i + 32; // a-z
	state.scantokey[91] = 170; // *
	state.scantokey[106] = 42; // *
	state.scantokey[107] = 43; // +
	state.scantokey[109] = state.scantokey[173] = state.scantokey[189] = 45; // -
	state.scantokey[111] = state.scantokey[191] = 47; // /
	for (i = 112; i <= 123; ++i)
		state.scantokey[i] = i - 112 + key.KEY.f1; // f1-f12
	state.scantokey[188] = 44; // ,
	state.scantokey[190] = 46; // .
	state.scantokey[192] = 96; // `
	state.scantokey[219] = 91; // [
	state.scantokey[220] = 92; // backslash
	state.scantokey[221] = 93; // ]
	state.scantokey[222] = 39; // '

	state.oldtime = Date.now() * 0.001;

	print('Host.Init\n');

	try {
		await host.init(false, assetStore, [loop, webrtc, webs]);
	}
	catch (e) {
		state.hooks.quit(e.message);
		return
	}

  const eventNames = Object.keys(events) as (keyof typeof events)[]
	for (i = 0; i < eventNames.length; ++i){
		window[eventNames[i] as any] = events[eventNames[i]] as any; // @ts-ignore
  }
	const gameLoop: () => void = async () => {
		var timeIn = new Date().getTime()
		try{
			await host.frame();
			if (com.state.inAsync) {
				debugger
			}
		}
		catch(e) {
			if(e && e.message)
			{
				console.log(e && e.message)
				console.log(e && e.stack)
				debugger
				quit(e.message)
			}
		}

		if(state.quitStatus.quitting) {
			var i;
			const eventNames = Object.keys(events)
			for (i = 0; i < eventNames.length; ++i)
				window[eventNames[i] as any] = null; // @ts-ignore
			host.shutdown();
			document.body.style.cursor = 'auto';
			if (state.hooks && state.hooks.quit) {
				state.hooks.quit(state.quitStatus.reason || '');
			}
			return;
		}
		
		// return window.requestAnimationFrame(gameLoop)

		var timeOut = new Date().getTime()
		var putzAroundTime = Math.max((1000.0 / (cl.cvr.maxfps.value || 60)) - (timeOut - timeIn), 1);
		return setTimeout(gameLoop, putzAroundTime);
	}

	gameLoop();
};

const events = {
  onbeforeunload,
  oncontextmenu,
  onfocus,
  onkeydown,
  onkeyup,
  onmousedown,
  onmouseup,
  onmousewheel,
  onunload,
  onwheel
}

export const floatTime = (): number =>
{
	return Date.now() * 0.001 - state.oldtime;
};

export const print = function(text: string)
{
	if (window.console != null)
		console.log(text);
};

export const quit = function(reason? : string)
{
	state.quitStatus = {quitting: true, reason}
};

export const error = function(text: string)
{
	throw new Error(`Error: ${text}`)
};

export const getExternalCommand = (): string => {
	return null
}

export const registerHooks = (hooks: UIHooks) => {
	state.hooks = hooks
}

export const requestPak = () => {
	if (state.hooks && state.hooks.startRequestPak) {
		return new Promise((resolve, reject) => {
			state.hooks.startRequestPak(resolve)
		})
	}
	return Promise.resolve()
}