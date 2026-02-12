import * as sys from './sys'
import * as con from './console'
import IDatagram from './interfaces/net/IDatagram';

export const getSpace = function(buf: IDatagram, length: number)
{
	if ((buf.cursize + length) > buf.data.byteLength)
	{
		if (buf.allowoverflow !== true)
			sys.error('SZ.GetSpace: overflow without allowoverflow set');
		if (length > buf.data.byteLength)
			sys.error('SZ.GetSpace: ' + length + ' is > full buffer size');
		buf.overflowed = true;
		con.print('SZ.GetSpace: overflow\n');
		buf.cursize = 0;
	}
	var cursize = buf.cursize;
	buf.cursize += length;
	return cursize;
};

export const write = function(message: IDatagram, data:Uint8Array, length: number)
{
	(new Uint8Array(message.data, getSpace(message, length), length)).set(data.subarray(0, length));
};

// Don't think this is used. 
// export const print = function(message: IDatagram, data:Uint8Array)
// {
// 	var buf = new Uint8Array(message.data);
// 	var dest;
// 	if (message.cursize !== 0)
// 	{
// 		if (buf[message.cursize - 1] === 0)
// 			dest = getSpace(message, data.length - 1) - 1;
// 		else
// 			dest = getSpace(message, data.length);
// 	}
// 	else
// 		dest = getSpace(message, data.length);
	
// 	for (let i = 0; i < data.length; ++i)
// 		buf[dest + i] = data.charCodeAt(i);
// };