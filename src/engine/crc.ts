export const table =
[
  0x0000,  0x1021,  0x2042,  0x3063,  0x4084,  0x50a5,  0x60c6,  0x70e7,
  0x8108,  0x9129,  0xa14a,  0xb16b,  0xc18c,  0xd1ad,  0xe1ce,  0xf1ef,
  0x1231,  0x0210,  0x3273,  0x2252,  0x52b5,  0x4294,  0x72f7,  0x62d6,
  0x9339,  0x8318,  0xb37b,  0xa35a,  0xd3bd,  0xc39c,  0xf3ff,  0xe3de,
  0x2462,  0x3443,  0x0420,  0x1401,  0x64e6,  0x74c7,  0x44a4,  0x5485,
  0xa56a,  0xb54b,  0x8528,  0x9509,  0xe5ee,  0xf5cf,  0xc5ac,  0xd58d,
  0x3653,  0x2672,  0x1611,  0x0630,  0x76d7,  0x66f6,  0x5695,  0x46b4,
  0xb75b,  0xa77a,  0x9719,  0x8738,  0xf7df,  0xe7fe,  0xd79d,  0xc7bc,
  0x48c4,  0x58e5,  0x6886,  0x78a7,  0x0840,  0x1861,  0x2802,  0x3823,
  0xc9cc,  0xd9ed,  0xe98e,  0xf9af,  0x8948,  0x9969,  0xa90a,  0xb92b,
  0x5af5,  0x4ad4,  0x7ab7,  0x6a96,  0x1a71,  0x0a50,  0x3a33,  0x2a12,
  0xdbfd,  0xcbdc,  0xfbbf,  0xeb9e,  0x9b79,  0x8b58,  0xbb3b,  0xab1a,
  0x6ca6,  0x7c87,  0x4ce4,  0x5cc5,  0x2c22,  0x3c03,  0x0c60,  0x1c41,
  0xedae,  0xfd8f,  0xcdec,  0xddcd,  0xad2a,  0xbd0b,  0x8d68,  0x9d49,
  0x7e97,  0x6eb6,  0x5ed5,  0x4ef4,  0x3e13,  0x2e32,  0x1e51,  0x0e70,
  0xff9f,  0xefbe,  0xdfdd,  0xcffc,  0xbf1b,  0xaf3a,  0x9f59,  0x8f78,
  0x9188,  0x81a9,  0xb1ca,  0xa1eb,  0xd10c,  0xc12d,  0xf14e,  0xe16f,
  0x1080,  0x00a1,  0x30c2,  0x20e3,  0x5004,  0x4025,  0x7046,  0x6067,
  0x83b9,  0x9398,  0xa3fb,  0xb3da,  0xc33d,  0xd31c,  0xe37f,  0xf35e,
  0x02b1,  0x1290,  0x22f3,  0x32d2,  0x4235,  0x5214,  0x6277,  0x7256,
  0xb5ea,  0xa5cb,  0x95a8,  0x8589,  0xf56e,  0xe54f,  0xd52c,  0xc50d,
  0x34e2,  0x24c3,  0x14a0,  0x0481,  0x7466,  0x6447,  0x5424,  0x4405,
  0xa7db,  0xb7fa,  0x8799,  0x97b8,  0xe75f,  0xf77e,  0xc71d,  0xd73c,
  0x26d3,  0x36f2,  0x0691,  0x16b0,  0x6657,  0x7676,  0x4615,  0x5634,
  0xd94c,  0xc96d,  0xf90e,  0xe92f,  0x99c8,  0x89e9,  0xb98a,  0xa9ab,
  0x5844,  0x4865,  0x7806,  0x6827,  0x18c0,  0x08e1,  0x3882,  0x28a3,
  0xcb7d,  0xdb5c,  0xeb3f,  0xfb1e,  0x8bf9,  0x9bd8,  0xabbb,  0xbb9a,
  0x4a75,  0x5a54,  0x6a37,  0x7a16,  0x0af1,  0x1ad0,  0x2ab3,  0x3a92,
  0xfd2e,  0xed0f,  0xdd6c,  0xcd4d,  0xbdaa,  0xad8b,  0x9de8,  0x8dc9,
  0x7c26,  0x6c07,  0x5c64,  0x4c45,  0x3ca2,  0x2c83,  0x1ce0,  0x0cc1,
  0xef1f,  0xff3e,  0xcf5d,  0xdf7c,  0xaf9b,  0xbfba,  0x8fd9,  0x9ff8,
  0x6e17,  0x7e36,  0x4e55,  0x5e74,  0x2e93,  0x3eb2,  0x0ed1,  0x1ef0
];

export const block = function(start: Uint8Array)
{
  var crcvalue = 0xffff;
  var i;
  for (i = 0; i < start.length; ++i)
    crcvalue = ((crcvalue << 8) & 0xffff) ^ table[(crcvalue >> 8) ^ start[i]];
  return crcvalue;
};

// MD4 (QSS mdfour.c, Samba's implementation).
const md4_lshift = function(x: number, s: number): number
{
  return ((x << s) | (x >>> (32 - s))) >>> 0;
};

const md4_block = function(st: Uint32Array, X: Uint32Array)
{
  var A = st[0], B = st[1], C = st[2], D = st[3];
  const AA = A, BB = B, CC = C, DD = D;
  const r1 = function(a: number, b: number, c: number, d: number, k: number, s: number): number {
    return md4_lshift((a + (((b & c) | (~b & d)) >>> 0) + X[k]) >>> 0, s);
  };
  const r2 = function(a: number, b: number, c: number, d: number, k: number, s: number): number {
    return md4_lshift((a + (((b & c) | (b & d) | (c & d)) >>> 0) + X[k] + 0x5A827999) >>> 0, s);
  };
  const r3 = function(a: number, b: number, c: number, d: number, k: number, s: number): number {
    return md4_lshift((a + ((b ^ c ^ d) >>> 0) + X[k] + 0x6ED9EBA1) >>> 0, s);
  };

  A = r1(A,B,C,D, 0, 3); D = r1(D,A,B,C, 1, 7); C = r1(C,D,A,B, 2,11); B = r1(B,C,D,A, 3,19);
  A = r1(A,B,C,D, 4, 3); D = r1(D,A,B,C, 5, 7); C = r1(C,D,A,B, 6,11); B = r1(B,C,D,A, 7,19);
  A = r1(A,B,C,D, 8, 3); D = r1(D,A,B,C, 9, 7); C = r1(C,D,A,B,10,11); B = r1(B,C,D,A,11,19);
  A = r1(A,B,C,D,12, 3); D = r1(D,A,B,C,13, 7); C = r1(C,D,A,B,14,11); B = r1(B,C,D,A,15,19);

  A = r2(A,B,C,D, 0, 3); D = r2(D,A,B,C, 4, 5); C = r2(C,D,A,B, 8, 9); B = r2(B,C,D,A,12,13);
  A = r2(A,B,C,D, 1, 3); D = r2(D,A,B,C, 5, 5); C = r2(C,D,A,B, 9, 9); B = r2(B,C,D,A,13,13);
  A = r2(A,B,C,D, 2, 3); D = r2(D,A,B,C, 6, 5); C = r2(C,D,A,B,10, 9); B = r2(B,C,D,A,14,13);
  A = r2(A,B,C,D, 3, 3); D = r2(D,A,B,C, 7, 5); C = r2(C,D,A,B,11, 9); B = r2(B,C,D,A,15,13);

  A = r3(A,B,C,D, 0, 3); D = r3(D,A,B,C, 8, 9); C = r3(C,D,A,B, 4,11); B = r3(B,C,D,A,12,15);
  A = r3(A,B,C,D, 2, 3); D = r3(D,A,B,C,10, 9); C = r3(C,D,A,B, 6,11); B = r3(B,C,D,A,14,15);
  A = r3(A,B,C,D, 1, 3); D = r3(D,A,B,C, 9, 9); C = r3(C,D,A,B, 5,11); B = r3(B,C,D,A,13,15);
  A = r3(A,B,C,D, 3, 3); D = r3(D,A,B,C,11, 9); C = r3(C,D,A,B, 7,11); B = r3(B,C,D,A,15,15);

  st[0] = (A + AA) >>> 0;
  st[1] = (B + BB) >>> 0;
  st[2] = (C + CC) >>> 0;
  st[3] = (D + DD) >>> 0;
};

// Little-endian byte -> word gather (mdfour.c copy64).
const md4_copy64 = function(X: Uint32Array, src: Uint8Array, ofs: number)
{
  for (var i = 0; i < 16; ++i)
    X[i] = ((src[ofs + i * 4 + 3] << 24) | (src[ofs + i * 4 + 2] << 16) |
            (src[ofs + i * 4 + 1] << 8) | src[ofs + i * 4]) >>> 0;
};

// Com_BlockChecksum (QSS mdfour.c:237): MD4 folded to 32 bits; the csprogs identity advertised
// as serverinfo *csprogs.
export const blockChecksum = function(data: Uint8Array): number
{
  const st = blockDigestWords(data);
  return (st[0] ^ st[1] ^ st[2] ^ st[3]) >>> 0;
};

// Raw 128-bit MD4 digest, little-endian per word (FTE hash_md4, crc.c); what digest_hex("MD4") hexes.
export const blockDigest = function(data: Uint8Array): Uint8Array
{
  const st = blockDigestWords(data);
  const out = new Uint8Array(16);
  for (var i = 0; i < 4; ++i)
  {
    out[i * 4] = st[i] & 0xff;
    out[i * 4 + 1] = (st[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (st[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (st[i] >>> 24) & 0xff;
  }
  return out;
};

const blockDigestWords = function(data: Uint8Array): Uint32Array
{
  const st = new Uint32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476]);
  const X = new Uint32Array(16);
  var p = 0, n = data.length, totalN = 0;
  while (n >= 64)
  {
    md4_copy64(X, data, p);
    md4_block(st, X);
    p += 64; n -= 64; totalN += 64;
  }
  // mdfour_tail
  totalN += n;
  const buf = new Uint8Array(128);
  buf.set(data.subarray(p, p + n));
  buf[n] = 0x80;
  const bits = (totalN * 8) >>> 0;    // must wrap at 2^32, as C's uint32 does
  const lenofs = (n <= 55) ? 56 : 120;
  buf[lenofs] = bits & 0xff;
  buf[lenofs + 1] = (bits >>> 8) & 0xff;
  buf[lenofs + 2] = (bits >>> 16) & 0xff;
  buf[lenofs + 3] = (bits >>> 24) & 0xff;
  md4_copy64(X, buf, 0);
  md4_block(st, X);
  if (n > 55)
  {
    md4_copy64(X, buf, 64);
    md4_block(st, X);
  }
  return st;
};