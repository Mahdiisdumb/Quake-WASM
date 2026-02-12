// import * as mod from './mod'
// import * as con from './console'
// import * as com from './com'
// import * as q from './q'
// import { Model } from './types'
// // type BspxLump = {
// //   char lumpname[24]; // up to 23 chars, zero-padded
// //   int fileofs;  // from file start
// //   int filelen;
// // } bspx_lump_t;
// // typedef struct {
// //   char id[4];  // 'BSPX'
// //   int numlumps;
// // bspx_lump_t lumps[1];
// // } bspx_header_t;
// // static char *bspxbase;
// // static bspx_header_t *bspxheader;
// const HEADER_LUMPS =	15
// //supported lumps:
// //RGBLIGHTING (.lit)
// //LMSHIFT (.lit2)
// //LMOFFSET (LMSHIFT helper)
// //LMSTYLE (LMSHIFT helper)

// //unsupported lumps ('documented' elsewhere):
// //BRUSHLIST (because hulls suck)
// //LIGHTINGDIR (.lux)
// //LIGHTING_E5BGR9 (hdr lighting)
// //VERTEXNORMALS (smooth shading with dlights/rtlights)

// export const state: {
//   bspxheader: ArrayBufferLike | null,
//   bspxbase: ArrayBufferLike | null
// } = {
//   bspxheader: null,
//   bspxbase: null
// }

// export type LumpLocation = {
//   offset: number,
//   size: number
// }
// export const findLump = (lumpname: string): LumpLocation | null => 
// {
//   if (state.bspxheader === null)
//     return null
  
//   const view = new DataView(state.bspxheader)
//   const numlumps = view.getUint32(4)

//   for (var i = 0; i < numlumps; i++)
//   {
//     const lumpName = q.memstr(new Uint8Array(state.bspxheader, (i * 32) + 8, 24))
//     if (lumpName === lumpName)
//     {
//       var fileofs = view.getUint32(8 + (i * 32) + 24, true);
//       var filelen = view.getUint32(8 + (i * 32) + 28, true);
//       return {
//         offset: fileofs,
//         size: filelen
//       }
//     }
//   }
//   return null
// }

// export const setup = (mod: Model, buffer: ArrayBuffer) => 
// {
// 	let offs = 0;
// 	let misaligned = false;

// 	state.bspxbase = buffer;
// 	state.bspxheader = null;

//   var view = new DataView(buffer);
// 	for (var i = 0; i < HEADER_LUMPS; i++)
// 	{
//     const fileofs = view.getUint32((i << 3) + 4, true);
//     const filelen = view.getUint32((i << 3) + 8, true);
// 		if ((fileofs & 3) && i != mod.lum.entities)
// 			misaligned = true;
// 		if (offs < fileofs + filelen)
// 			offs = fileofs + filelen;
// 	}
// 	if (misaligned)
// 		con.dPrint(`${mod.name} contains misaligned lumps\n`);
// 	offs = (offs + 3) & ~3;
// 	if (offs + 40 > buffer.byteLength)
// 		return; /*no space for it*/

//   /// bspx_lump = 24 name, 4: fileofs, 4 filelen (32 bytes)
//   /// bspx_header = 4 bytes: BSPX, 4 bytes: num lumps,  (8 + (numlumps * 32))
// 	//h = (bspx_header_t*)(filebase + offs);
//   const LUMP_SIZE = 32 // bytes
// 	const numLumps = com.state.littleLong(view.getInt32(offs + 4));
//   const lumpOffset = offs + 8
// 	/*verify the header*/
//   if (q.memstr(new Uint8Array(buffer, offs, 32)) !== 'BSPX'
//     || i < 0 ||
//     lumpOffset + (LUMP_SIZE * numLumps) > buffer.byteLength) {
//       console.log('BSPX overflow')
//       return
//     }
  
// 	for( i = numLumps; i >= 0; i--)
// 	{
//     const fileofs = com.state.littleLong(view.getUint32(8 + (i * LUMP_SIZE) + 24, true));
//     const filelen = com.state.littleLong(view.getUint32(8 + (i * LUMP_SIZE) + 28, true));
//     view.setUint32(8 + (i * LUMP_SIZE) + 24, fileofs, true)
//     view.setUint32(8 + (i * LUMP_SIZE) + 28, filelen, true)
// 		if (fileofs & 3)
// 			con.dPrint(`${mod.name} contains misaligned bspx lump ${q.memstr(new Uint8Array(buffer, lumpOffset + (i * LUMP_SIZE), 24))}\n`);
// 		if (fileofs + filelen > buffer.byteLength){
//       console.log('BSPX Lump overflow')
//       return
//     }
// 	}

// 	state.bspxheader = new Uint8Array(buffer, offs, buffer.byteLength - offs)
// }