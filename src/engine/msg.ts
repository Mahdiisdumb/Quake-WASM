import * as sz from './sz'
import * as net from './net'
import * as q from './q'
import IDatagram from './interfaces/net/IDatagram'

export const state = {

} as any

export const writeChar = function(message: IDatagram, c: number)
{
	(new DataView(message.data)).setInt8(sz.getSpace(message, 1), c);
};

export const writeByte = function(message: IDatagram, c: number)
{
	(new DataView(message.data)).setUint8(sz.getSpace(message, 1), c);
};

export const writeShort = function(message: IDatagram, c: number)
{
	(new DataView(message.data)).setInt16(sz.getSpace(message, 2), c, true);
};

export const writeLong = function(message: IDatagram, c: number)
{
	(new DataView(message.data)).setInt32(sz.getSpace(message, 4), c, true);
};

export const writeFloat = function(message: IDatagram, f: number)
{
	(new DataView(message.data)).setFloat32(sz.getSpace(message, 4), f, true);
};

export const writeString = function(message: IDatagram, s: string)
{
	if (s != null)
		sz.write(message, new Uint8Array(q.strmem(s)), s.length);
	writeChar(message, 0)
};

export const writeCoord = function(message: IDatagram, f: number)
{
	writeShort(message, f * 8.0);
};

export const writeAngle = function(message: IDatagram, f: number)
{
	writeByte(message, ((f >> 0) * (256.0 / 360.0)) & 255);
};

export const writeAngle16 = function(message: IDatagram, f: number)
{
	writeShort(message, ((f >> 0) * (65536.0 / 360.0)) & 65535);
};

export const beginReading = function()
{
	state.readcount = 0;
	state.badread = false;
};

export const readChar = function()
{
	const count = state.readcount
	if (count >= net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = (new Int8Array(net.state.message.data, count, 1))[0];
	++state.readcount;
	return c;
};

export const readByte = function()
{
	if (state.readcount >= net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = (new Uint8Array(net.state.message.data, state.readcount, 1))[0];
	++state.readcount;
	return c;
};

export const readShort = function()
{
	if ((state.readcount + 2) > net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = (new DataView(net.state.message.data)).getInt16(state.readcount, true);
	state.readcount += 2;
	return c;
};

export const readLong = function()
{
	if ((state.readcount + 4) > net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var c = (new DataView(net.state.message.data)).getInt32(state.readcount, true);
	state.readcount += 4;
	return c;
};

export const readFloat = function()
{
	if ((state.readcount + 4) > net.state.message.cursize)
	{
		state.badread = true;
		return -1;
	}
	var f = (new DataView(net.state.message.data)).getFloat32(state.readcount, true);
	state.readcount += 4;
	return f;
};

export const readString = function()
{
	var string = [], l, c;
	for (l = 0; l < 2048; ++l)
	{
		c = readByte();
		if (c <= 0)
			break;
		string[l] = String.fromCharCode(c);
	}
	return string.join('');
};

export const readCoord = function()
{
	return readShort() * 0.125;
};

export const readAngle = function()
{
	return readChar() * 1.40625;
};

export const readAngle16 = function()
{
	return readShort() * (360.0 / 65536);;
};