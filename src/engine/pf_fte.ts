// FTE builtins, all VM-generic: they touch nothing but pr.state (plus the asset store for
// buf_loadfile/writefile), so pf.ts registers them for ssqc and pfcl.ts binds the same functions
// for csqc, as FTE serves one pr_bgcmd.c set to both.
// Numbers and semantics are FTE's, cited per builtin: server/pr_cmds.c and client/pr_csqc.c are
// the ssqc/csqc name-number tables, common/pr_bgcmd.c the shared implementations.
import * as con from './console'
import * as crc from './crc'
import * as mod from './mod'
import * as pr from './pr'
import * as pf from './pf'
import type { AliasFrame, AliasFrameGroup } from './types/Model'

const PARM0 = 4
const PARM1 = 7
const PARM2 = 10
const PARM3 = 13
const PARM4 = 16
const RETURN = 1

const varString = function (first: number): string {
	let out = ''
	for (let i = first; i < pr.state.argc; ++i)
		out += pr.getString(pr.state.globals_int[PARM0 + i * 3])
	return out
}

// ---------------------------------------------------------------------------
// DP_QC_STRINGBUFFERS (FTE pr_bgcmd.c:5126-5620)
// ---------------------------------------------------------------------------

// FTE BUFSTRBASE (pr_bgcmd.c:5127): handles are biased, so QC handle 0 is never a live buffer.
const BUFSTRBASE = 1

// FTE's sanity ceiling on a bufstr_set index (pr_bgcmd.c:5493).
const BUFSTR_MAXINDEX = 1024 * 1024

// The strings of the buffer QC named, or null when the handle is stale/foreign. buf_del nulls the
// slot; the next buf_create takes the first null it finds.
const bufFor = function (handleParm: number): (string | null)[] | null {
	const bufno = (pr.state.globals_float[handleParm] >> 0) - BUFSTRBASE
	if ((bufno < 0) || (bufno >= pr.state.strbufs.length))
		return null
	return pr.state.strbufs[bufno] ?? null
}

// strbuf(optional string type, optional float flags) buf_create = #460 (FTE PF_buf_create,
// pr_bgcmd.c:5260). Only the "string" type exists; anything else is -1. The SAVED flag is
// accepted and ignored - our savegames carry no buffers.
export const buf_create = function () {
	const type = (pr.state.argc > 0) ? pr.getString(pr.state.globals_int[PARM0]) : 'string'
	if ((type.length !== 0) && (type.toLowerCase() !== 'string')) {
		pr.state.globals_float[RETURN] = -1
		return
	}
	let i = pr.state.strbufs.findIndex(b => b == null)
	if (i < 0)
		i = pr.state.strbufs.length
	pr.state.strbufs[i] = []
	pr.state.globals_float[RETURN] = i + BUFSTRBASE
}

// void(strbuf bufhandle) buf_del = #461 (FTE PF_buf_del, pr_bgcmd.c:5299). An unknown handle is
// silently ignored, as in every builtin of this family.
export const buf_del = function () {
	const bufno = (pr.state.globals_float[PARM0] >> 0) - BUFSTRBASE
	if ((bufno < 0) || (bufno >= pr.state.strbufs.length))
		return
	pr.state.strbufs[bufno] = null
}

// float(strbuf bufhandle) buf_getsize = #462 (FTE PF_buf_getsize, pr_bgcmd.c:5318): the `used`
// high-water mark, holes included - not the count of live strings.
export const buf_getsize = function () {
	const buf = bufFor(PARM0)
	if (buf == null)
		return
	pr.state.globals_float[RETURN] = buf.length
}

// void(strbuf from, strbuf to) buf_copy = #463 (FTE PF_buf_copy, pr_bgcmd.c:5331): obliterates
// the destination, holes and all.
export const buf_copy = function () {
	const from = bufFor(PARM0), to = bufFor(PARM1)
	if ((from == null) || (to == null) || (from === to))
		return
	to.length = 0
	for (let i = 0; i < from.length; i++)
		to.push(from[i])
}

// void(strbuf bufhandle, float sortprefixlen, float backward) buf_sort = #464 (FTE PF_buf_sort,
// pr_bgcmd.c:5367). Holes compact out first, then strncmp over sortprefixlen; <= 0 = whole string.
export const buf_sort = function () {
	const buf = bufFor(PARM0)
	if (buf == null)
		return
	let prefix = pr.state.globals_float[PARM1] >> 0
	const backwards = pr.state.globals_float[PARM2] !== 0
	if (prefix <= 0)
		prefix = 0x7fffffff
	const live = buf.filter(s => s != null)
	// strncmp is a byte compare; JS code-unit order agrees for every character a QC string holds.
	live.sort((a, b) => {
		const x = a.substring(0, prefix), y = b.substring(0, prefix)
		return (x < y) ? -1 : ((x > y) ? 1 : 0)
	})
	if (backwards)
		live.reverse()
	buf.length = 0
	for (let i = 0; i < live.length; i++)
		buf.push(live[i])
}

// string(strbuf bufhandle, string glue) buf_implode = #465 (FTE PF_buf_implode, pr_bgcmd.c:5404):
// holes contribute neither text nor a separator.
export const buf_implode = function () {
	const buf = bufFor(PARM0)
	if (buf == null)
		return
	const glue = pr.getString(pr.state.globals_int[PARM1])
	pr.tempString(buf.filter(s => s != null).join(glue))
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// string(strbuf bufhandle, float index) bufstr_get = #466 (FTE PF_bufstr_get, pr_bgcmd.c:5455):
// the null string (QC "") for a bad handle, an out-of-range index, or a hole.
export const bufstr_get = function () {
	pr.state.globals_int[RETURN] = 0
	const buf = bufFor(PARM0)
	if (buf == null)
		return
	const index = pr.state.globals_float[PARM1] >> 0
	if ((index < 0) || (index >= buf.length) || (buf[index] == null))
		return
	pr.tempString(buf[index])
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// void(strbuf bufhandle, float index, string str) bufstr_set = #467 (FTE PF_bufstr_set,
// pr_bgcmd.c:5480): writing past the end grows the buffer with holes behind it.
export const bufstr_set = function () {
	const buf = bufFor(PARM0)
	if (buf == null)
		return
	const index = pr.state.globals_float[PARM1] >> 0
	if (index < 0)
		return
	if (index > BUFSTR_MAXINDEX) {
		con.print('bufstr_set: index outside sanity range\n')
		return
	}
	while (buf.length < index)
		buf.push(null)
	buf[index] = pr.getString(pr.state.globals_int[PARM2])
}

// FTE PF_bufstr_add_internal (pr_bgcmd.c:5512): append at the end, or fill the first hole.
const bufstrAdd = function (buf: (string | null)[], str: string, appendOnEnd: boolean): number {
	let index = buf.length
	if (!appendOnEnd) {
		const hole = buf.findIndex(s => s == null)
		if (hole >= 0)
			index = hole
	}
	while (buf.length < index)
		buf.push(null)
	buf[index] = str
	return index
}

// float(strbuf bufhandle, string str, float ordered) bufstr_add = #468 (FTE PF_bufstr_add,
// pr_bgcmd.c:5551). Returns the index written.
export const bufstr_add = function () {
	const buf = bufFor(PARM0)
	if (buf == null)
		return
	const str = pr.getString(pr.state.globals_int[PARM1])
	pr.state.globals_float[RETURN] =
		bufstrAdd(buf, str, pr.state.globals_float[PARM2] !== 0)
}

// void(strbuf bufhandle, float index) bufstr_free = #469 (FTE PF_bufstr_free, pr_bgcmd.c:5565):
// punches a hole; `used` (buf_getsize) does not shrink.
export const bufstr_free = function () {
	const buf = bufFor(PARM0)
	if (buf == null)
		return
	const index = pr.state.globals_float[PARM1] >> 0
	if ((index < 0) || (index >= buf.length))
		return
	buf[index] = null
}

// float(string filename, strbuf bufhandle) buf_loadfile = #535 (FTE PF_buf_loadfile,
// pr_bgcmd.c:5186): appends the file line by line onto an EXISTING buffer; the return value is
// only "was it readable". Same lookup and data/ policy as FRIK_FILE's fopen.
export const buf_loadfile = function () {
	pr.state.globals_float[RETURN] = 0
	const buf = bufFor(PARM1)
	if (buf == null)
		return
	const text = pf.readQCFileText(pr.getString(pr.state.globals_int[PARM0]))
	if (text == null)
		return
	const lines = text.split(/\r?\n/)
	// A trailing newline ends the last line rather than starting an empty one, as VFS_GETS does.
	if ((lines.length > 0) && (lines[lines.length - 1].length === 0))
		lines.pop()
	for (let i = 0; i < lines.length; i++)
		bufstrAdd(buf, lines[i], true)
	pr.state.globals_float[RETURN] = 1
}

// float(filestream fh, strbuf bufhandle, optional float startpos, optional float numstrings)
// buf_writefile = #536 (FTE PF_buf_writefile, pr_bgcmd.c:5205): each live string plus a newline
// onto an already-fopen'd write handle. Holes are skipped but still consume an index.
export const buf_writefile = function () {
	pr.state.globals_float[RETURN] = 0
	const buf = bufFor(PARM1)
	if (buf == null)
		return
	let idx = (pr.state.argc >= 3) ? (pr.state.globals_float[PARM2] >> 0) : 0
	let midx = (pr.state.argc >= 4)
		? (idx + (pr.state.globals_float[PARM3] >> 0)) : (buf.length - idx)
	if (idx < 0)
		idx = 0
	if (idx > buf.length)
		idx = buf.length
	if (midx > buf.length)
		midx = buf.length
	let out = ''
	for (; idx < midx; idx++)
		if (buf[idx] != null)
			out += buf[idx] + '\n'
	if (!pf.fwriteInternal(pr.state.globals_float[PARM0] >> 0, out))
		return
	pr.state.globals_float[RETURN] = 1
}

// ---------------------------------------------------------------------------
// DP_QC_TOKENIZEBYSEPARATOR (FTE PF_tokenizebyseparator, pr_bgcmd.c:4185)
// ---------------------------------------------------------------------------

// float(string s, string separator1, ...) tokenizebyseparator = #479. Feeds the same qctoken
// array tokenize/argv use. FTE's edge cases: empty input is ALWAYS 0 tokens, no separator found
// is 1, a lone separator is 2. At most 7 separators (FTE's sep[7]), first match at a position
// wins - so "::" must be passed ahead of ":" to beat it.
export const tokenizebyseparator = function () {
	const str = pr.getString(pr.state.globals_int[PARM0])
	const seps: string[] = []
	for (let i = 0; (i < pr.state.argc - 1) && (i < 7); i++) {
		const sep = pr.getString(pr.state.globals_int[PARM1 + i * 3])
		if (sep.length > 0)
			seps.push(sep)
	}
	pr.state.qctoken = []
	if (str.length > 0) {
		let start = 0, at = 0
		for (; ;) {
			let seplen = -1
			if (at >= str.length)
				seplen = 0                 // FTE's found == -1: end of string closes the last token
			else
				for (let s = 0; s < seps.length; s++)
					if (str.startsWith(seps[s], at)) {
						seplen = seps[s].length
						break
					}
			if (seplen < 0) {
				at++
				continue
			}
			pr.state.qctoken.push({ token: str.substring(start, at), start: start, end: at })
			if (seplen === 0)
				break
			at += seplen
			start = at
		}
	}
	pr.state.globals_float[RETURN] = pr.state.qctoken.length
}

// ---------------------------------------------------------------------------
// Model frame introspection (FTE pr_skelobj.c:2722-2786 over com_mesh.c's Mod_* helpers), read
// off the alias frames[] mod.ts builds. DELTA FROM FTE: a .mdl framegroup carries no name of its
// own in our loader, so a group answers with its first pose's name ("rocketexplo1").
// ---------------------------------------------------------------------------

// The alias model a QC modelindex names, or null. pr.state.getModel is per-VM (the client
// precache list under csqc, the server's under ssqc), as FTE's w->Get_CModel is.
const aliasModelFor = function (parm: number) {
	const model = pr.state.getModel(pr.state.globals_float[parm] >> 0)
	if ((model == null) || (model.type !== mod.TYPE.alias))
		return null
	return model
}

const frameName = function (frame: AliasFrame | AliasFrameGroup): string {
	if (frame.group === true) {
		const g = frame as AliasFrameGroup
		return (g.frames.length > 0) ? g.frames[0].name : ''
	}
	return (frame as AliasFrame).name
}

// float(float modidx, string framename) frameforname = #276 (FTE PF_frameforname,
// pr_skelobj.c:2737 -> Mod_FrameNumForName, com_mesh.c:5588). -1 when the model isn't loaded or
// the name isn't there; 0 for a non-alias model, as Mod_FrameNumForName returns.
export const frameforname = function () {
	pr.state.globals_float[RETURN] = -1
	const model = pr.state.getModel(pr.state.globals_float[PARM0] >> 0)
	if (model == null)
		return
	if (model.type !== mod.TYPE.alias) {
		pr.state.globals_float[RETURN] = 0
		return
	}
	// varString, not a single arg: FTE takes PF_VarString(prinst, 1) here.
	const name = varString(1)
	for (let i = 0; i < model.frames.length; i++)
		if (frameName(model.frames[i] as AliasFrame | AliasFrameGroup) === name) {
			pr.state.globals_float[RETURN] = i
			return
		}
}

// string(float modidx, float framenum) frametoname = #284 (FTE PF_frametoname,
// pr_skelobj.c:2722 -> Mod_FrameNameForNum). The null string for anything unanswerable.
export const frametoname = function () {
	pr.state.globals_int[RETURN] = 0
	const model = aliasModelFor(PARM0)
	if (model == null)
		return
	const num = pr.state.globals_float[PARM1] >> 0
	if ((num < 0) || (num >= model.frames.length))
		return
	pr.tempString(frameName(model.frames[num] as AliasFrame | AliasFrameGroup))
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// float(float modidx, float framenum) frameduration = #277 (FTE PF_frameduration,
// pr_skelobj.c:2763 -> Mod_GetFrameDuration). Our framegroups store CUMULATIVE intervals, so the
// group's duration is the last one; a .mdl single frame has none, and 0.1s is what the renderer
// lerps it over (r.ts:842).
export const frameduration = function () {
	pr.state.globals_float[RETURN] = 0
	const model = aliasModelFor(PARM0)
	if (model == null)
		return
	const num = pr.state.globals_float[PARM1] >> 0
	if ((num < 0) || (num >= model.frames.length))
		return
	const frame = model.frames[num] as AliasFrame | AliasFrameGroup
	if (frame.group === true) {
		const g = frame as AliasFrameGroup
		pr.state.globals_float[RETURN] =
			(g.frames.length > 0) ? g.frames[g.frames.length - 1].interval : 0
		return
	}
	const interval = (frame as AliasFrame).interval
	pr.state.globals_float[RETURN] = (interval > 0) ? interval : 0.1
}

// float(float mdlidx) modelframecount (FTE PF_modelframecount, pr_skelobj.c:2776). Name-bound
// only, as in FTE. A framegroup counts as one frame.
export const modelframecount = function () {
	const model = pr.state.getModel(pr.state.globals_float[PARM0] >> 0)
	// numframes is only set by the alias/sprite loaders; a brush model leaves it undefined, which
	// would reach QC as NaN. FTE's brush models carry 1.
	const n = (model != null) ? model.numframes : 0
	pr.state.globals_float[RETURN] = (n > 0) ? n : ((model != null) ? 1 : 0)
}

// ---------------------------------------------------------------------------
// checkbuiltin (FTE PF_checkbuiltin, server/pr_cmds.c:7393)
// ---------------------------------------------------------------------------

// float(__variant funcref) checkbuiltin. Name-bound only in both FTE tables - it exists to test
// "= #0" declarations. False unless the funcref is a builtin import in range whose slot is
// neither empty nor PF_Fixme/PF_Ignore; pr.isStub is that predicate for our tables.
export const checkbuiltin = function () {
	pr.state.globals_float[RETURN] = 0
	const funcref = pr.state.globals_int[PARM0]
	if ((funcref <= 0) || (funcref >= pr.state.functions.length))
		return
	const fn = pr.state.functions[funcref]
	if (fn.first_statement >= 0)
		return                        // QC-implemented, not a builtin at all
	const nbr = -fn.first_statement
	if (nbr >= pr.state.builtins.length)
		return
	pr.state.globals_float[RETURN] = pr.isStub(pr.state.builtins[nbr]) ? 0 : 1
}

// ---------------------------------------------------------------------------
// Math / int conversions. v6 progs have no int opcodes, so these move int bit patterns through
// the INT view of a float global - which is why FTE offers them at all.
// ---------------------------------------------------------------------------

// float(float number, float quantity) bitshift = #218 (FTE PF_bitshift, pr_bgcmd.c:6376).
// Negative quantity shifts right. Signed 32-bit, as FTE's `int bitmask` is.
export const bitshift = function () {
	const bitmask = pr.state.globals_float[PARM0] >> 0
	const shift = pr.state.globals_float[PARM1] >> 0
	pr.state.globals_float[RETURN] = (shift < 0) ? (bitmask >> -shift) : (bitmask << shift)
}

// vector(vector v1, vector v2) crossproduct (FTE PF_crossproduct, pr_bgcmd.c:6568). Name-bound
// only, as in FTE.
export const crossproduct = function () {
	const g = pr.state.globals_float
	const ax = g[PARM0], ay = g[PARM0 + 1], az = g[PARM0 + 2]
	const bx = g[PARM1], by = g[PARM1 + 1], bz = g[PARM1 + 2]
	g[RETURN] = ay * bz - az * by
	g[RETURN + 1] = az * bx - ax * bz
	g[RETURN + 2] = ax * by - ay * bx
}

// float(float dividend, float divisor) mod = #245 (FTE PF_mod, pr_bgcmd.c:6392). Registered under
// the QC name "mod"; exported as qcmod because this module imports the model loader as mod. FTE
// keeps the float form `a - n*(int)(a/n)` deliberately.
export const qcmod = function () {
	const a = pr.state.globals_float[PARM0]
	const n = pr.state.globals_float[PARM1]
	if (n === 0) {
		con.dPrint('mod by zero\n')
		pr.state.globals_float[RETURN] = 0
		return
	}
	pr.state.globals_float[RETURN] = a - (n * ((a / n) >> 0))
}

// int(float) ftoi (FTE PF_ftoi, pr_bgcmd.c). Name-bound only. The int lands in the INT view of the
// return global; v6 progs can only move it around and hand it back to itof/htos.
export const ftoi = function () {
	pr.state.globals_int[RETURN] = pr.state.globals_float[PARM0] >> 0
}

// float(int, optional float shift, float mask) itof (FTE PF_itof, pr_bgcmd.c). With the optional
// arguments it extracts a bitfield: value >>= shift, then masked to `count` bits (32 = no mask).
export const itof = function () {
	if (pr.state.argc > 1) {
		const shift = pr.state.globals_float[PARM1] >> 0
		const count = pr.state.globals_float[PARM2] >> 0
		let value = (pr.state.globals_int[PARM0] >>> shift) >>> 0
		if (count !== 32)
			value = (value & (((1 << count) >>> 0) - 1)) >>> 0
		pr.state.globals_float[RETURN] = value
		return
	}
	pr.state.globals_float[RETURN] = pr.state.globals_int[PARM0]
}

// int(string) stoi = #259 (FTE PF_stoi = plain atoi, pr_bgcmd.c:4712): base 10 only.
export const stoi = function () {
	const v = parseInt(pr.getString(pr.state.globals_int[PARM0]).trim(), 10)
	pr.state.globals_int[RETURN] = isNaN(v) ? 0 : (v | 0)
}

// string(int) itos = #260 (FTE PF_itos, "%d", pr_bgcmd.c).
export const itos = function () {
	pr.tempString(String(pr.state.globals_int[PARM0]))
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// int(string) stoh = #261 (FTE PF_stoh = strtoul(.., 16), pr_bgcmd.c:4731). With or without the 0x
// prefix; mis-reads base 8/10 strings, as FTE's does.
export const stoh = function () {
	const v = parseInt(pr.getString(pr.state.globals_int[PARM0]).trim(), 16)
	pr.state.globals_int[RETURN] = isNaN(v) ? 0 : (v | 0)
}

// string(int) htos = #262 (FTE PF_htos, "%08x", pr_bgcmd.c:4720). Always 8 characters, no prefix.
export const htos = function () {
	const v = (pr.state.globals_int[PARM0] >>> 0).toString(16)
	pr.tempString('00000000'.substring(v.length) + v)
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// ---------------------------------------------------------------------------
// Small strings
// ---------------------------------------------------------------------------

// string(string s) strtrim (FTE PF_strtrim, pr_bgcmd.c:4405). Name-bound only. Trims exactly FTE's
// four characters - space, tab, newline, carriage return - not JS's wider whitespace class.
export const strtrim = function () {
	const s = pr.getString(pr.state.globals_int[PARM0])
	let a = 0, b = s.length
	const ws = (c: string) => (c === ' ') || (c === '\t') || (c === '\n') || (c === '\r')
	while ((a < b) && ws(s[a]))
		a++
	while ((b > a) && ws(s[b - 1]))
		b--
	pr.tempString(s.substring(a, b))
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// string(string digest, string data, ...) digest_hex = #639 (FTE PF_digest_hex, pr_bgcmd.c:5826).
// The data is a VarString. An unknown digest name returns the null string - FTE's own answer, and
// how a mod probes for support. DELTA FROM FTE: only "MD4" and "CRC16" of its eight; the SHA
// variants have no primitive in the engine.
export const digest_hex = function () {
	pr.state.globals_int[RETURN] = 0
	const type = pr.getString(pr.state.globals_int[PARM0])
	const data = varString(1)
	const bytes = new Uint8Array(data.length)
	for (let i = 0; i < data.length; i++)
		bytes[i] = data.charCodeAt(i) & 0xff
	let digest: Uint8Array = null
	if (type === 'MD4')
		digest = crc.blockDigest(bytes)
	else if (type === 'CRC16') {
		const v = crc.block(bytes)
		digest = new Uint8Array([v & 0xff, (v >> 8) & 0xff])
	}
	if (digest == null) {
		con.dPrint('digest_hex: unsupported digest "' + type + '"\n')
		return
	}
	let out = ''
	for (let i = 0; i < digest.length; i++)
		out += '0123456789abcdef'[digest[i] >> 4] + '0123456789abcdef'[digest[i] & 0xf]
	pr.tempString(out)
	pr.state.globals_int[RETURN] = pr.state.string_temp
}

// ---------------------------------------------------------------------------
// FTE_MEMALLOC (FTE pr_bgcmd.c:2037-2160)
//
// DELIBERATELY NOT ADVERTISED as FTE_MEMALLOC (see pf.ts's extensions table): FTE's pointer is an
// offset into the progs' addressable/string space, dereferenceable by v7 opcodes and by string
// builtins. Ours is a private arena reachable only through these builtins; pointers are byte
// offsets biased by MEMPTR_BASE so 0 stays null.
// ---------------------------------------------------------------------------

// Biases a QC pointer away from 0 and from any plausible string offset, so one that leaks into a
// string builtin fails loudly instead of reading the string heap.
const MEMPTR_BASE = 0x40000000

// FTE's per-allocation ceiling (PF_memalloc).
const MEM_MAXALLOC = 0x01000000

// Total arena ceiling. FTE has none; ours caps so a runaway mod fails its allocation, not the tab.
const MEM_MAXARENA = 0x01000000

// Bump-allocate `size` bytes, reusing an exactly-fitting freed block first. No coalescing.
const arenaAlloc = function (size: number): number {
	const arena = pr.state.memarena
	for (const key of Object.keys(arena.blocks)) {
		const ofs = key as unknown as number	// numeric keys: Object.keys stringifies them
		if (arena.blocks[ofs] === -size) {       // negative size = freed block of that size
			arena.blocks[ofs] = size
			arena.mem.fill(0, +key, +key + size)
			return +key
		}
	}
	if ((arena.used + size) > MEM_MAXARENA)
		return -1
	if ((arena.used + size) > arena.mem.length) {
		let cap = (arena.mem.length > 0) ? arena.mem.length : 1024
		while (cap < (arena.used + size))
			cap *= 2
		const grown = new Uint8Array(cap)
		grown.set(arena.mem)
		arena.mem = grown
	}
	const ofs = arena.used
	arena.used += size
	arena.blocks[ofs] = size
	return ofs
}

// A QC pointer + byte offset resolved to an arena offset, or -1 when it isn't inside a live
// block of at least `size` bytes. FTE's PR_PointerToNative_* does the same bounds job.
const arenaResolve = function (ptr: number, offset: number, size: number): number {
	if (ptr === 0)
		return -1
	const base = ptr - MEMPTR_BASE
	const at = base + offset
	const arena = pr.state.memarena
	if ((base < 0) || (at < 0) || ((at + size) > arena.used))
		return -1
	return at
}

// __variant*(int size) memalloc = #384 (FTE PF_memalloc, pr_bgcmd.c:2037). Zeroed; 0 on failure.
export const memalloc = function () {
	let size = pr.state.globals_int[PARM0]
	if (size === 0)
		size = 1                          // FTE: "return something free can free"
	if ((size < 0) || (size > MEM_MAXALLOC)) {
		pr.state.globals_int[RETURN] = 0
		con.print('memalloc: failure (size ' + size + ')\n')
		return
	}
	const ofs = arenaAlloc(size)
	if (ofs < 0) {
		pr.state.globals_int[RETURN] = 0
		con.print('memalloc: failure (size ' + size + ')\n')
		return
	}
	pr.state.globals_int[RETURN] = ofs + MEMPTR_BASE
}

// void(__variant *ptr) memfree = #385 (FTE PF_memfree). Marks the block reusable at the same size;
// a double free or a foreign pointer is ignored.
export const memfree = function () {
	const ofs = pr.state.globals_int[PARM0] - MEMPTR_BASE
	const arena = pr.state.memarena
	const size = arena.blocks[ofs]
	if ((size == null) || (size < 0))
		return
	arena.blocks[ofs] = -size
}

// void(__variant *dst, __variant *src, int size, optional int srcoffset, int dstoffset)
// memcpy = #386 (FTE PF_memcpy, pr_bgcmd.c:2106). Note FTE's argument order for the two optional
// offsets: PARM3 is the SOURCE offset, PARM4 the destination's.
export const memcpy = function () {
	const size = pr.state.globals_int[PARM2]
	if (size <= 0)
		return
	const srcoffset = (pr.state.argc > 3) ? pr.state.globals_int[PARM3] : 0
	const dstoffset = (pr.state.argc > 4) ? pr.state.globals_int[PARM4] : 0
	const dst = arenaResolve(pr.state.globals_int[PARM0], dstoffset, size)
	const src = arenaResolve(pr.state.globals_int[PARM1], srcoffset, size)
	if ((dst < 0) || (src < 0)) {
		con.print('memcpy: invalid pointer\n')
		return
	}
	pr.state.memarena.mem.copyWithin(dst, src, src + size)
}

// void(__variant *dst, int val, int size, optional int offset) memfill8 = #387 (FTE PF_memfill8,
// pr_bgcmd.c:2128).
export const memfill8 = function () {
	const size = pr.state.globals_int[PARM2]
	if (size <= 0)
		return
	const offset = (pr.state.argc > 3) ? pr.state.globals_int[PARM3] : 0
	const dst = arenaResolve(pr.state.globals_int[PARM0], offset, size)
	if (dst < 0) {
		con.print('memfill8: invalid dest\n')
		return
	}
	pr.state.memarena.mem.fill(pr.state.globals_int[PARM1] & 0xff, dst, dst + size)
}

// __variant(__variant *dst, float ofs) memgetval = #388 (FTE PF_memgetval): the 32-bit word at
// pointer + ofs WORDS - FTE scales ofs by sizeof(int) (initlib.c:1233).
export const memgetval = function () {
	pr.state.globals_int[RETURN] = 0
	const at = arenaResolve(pr.state.globals_int[PARM0], (pr.state.globals_float[PARM1] >> 0) * 4, 4)
	if (at < 0) {
		con.print('memgetval: invalid pointer\n')
		return
	}
	const m = pr.state.memarena.mem
	pr.state.globals_int[RETURN] =
		(m[at] | (m[at + 1] << 8) | (m[at + 2] << 16) | (m[at + 3] << 24)) | 0
}

// void(__variant *dst, float ofs, __variant val) memsetval = #389 (FTE PF_memsetval); ofs in
// words, as memgetval.
export const memsetval = function () {
	const at = arenaResolve(pr.state.globals_int[PARM0], (pr.state.globals_float[PARM1] >> 0) * 4, 4)
	if (at < 0) {
		con.print('memsetval: invalid pointer\n')
		return
	}
	const v = pr.state.globals_int[PARM2]
	const m = pr.state.memarena.mem
	m[at] = v & 0xff
	m[at + 1] = (v >> 8) & 0xff
	m[at + 2] = (v >> 16) & 0xff
	m[at + 3] = (v >>> 24) & 0xff
}

// __variant*(__variant *base, float ofs) memptradd = #390 (FTE PF_memptradd, pr_bgcmd.c:2143).
// A non-32-bit-aligned offset is refused, as FTE errors on it.
export const memptradd = function () {
	const base = pr.state.globals_int[PARM0]
	const ofs = pr.state.globals_float[PARM1] >> 0
	if ((ofs & 3) !== 0) {
		con.print('memptradd: offset is not 32-bit aligned\n')
		pr.state.globals_int[RETURN] = 0
		return
	}
	pr.state.globals_int[RETURN] = base + ofs
}

// ---------------------------------------------------------------------------
// uri_get - DELIBERATELY A STUB
// ---------------------------------------------------------------------------

// float(string url, float id, optional string postmimetype, string postdata) uri_get = #513
// (FTE PF_uri_get, server/pr_cmds.c:12144). NOT IMPLEMENTED, deliberately: it is a QC-chosen
// network request - on the node dedicated server a plain SSRF primitive, in the browser a fetch
// wanting its own default-off cvar - and FTE delivers the result by re-entering the VM from a
// callback, which our entry-point rules (pr.switchVM) forbid. Registered as a stub so a mod
// calling it gets a named refusal instead of silence.
export const uri_get = pr.markStub(function () {
	pr.state.globals_float[RETURN] = 0
	con.print('uri_get: QC-initiated http requests are not supported by this engine\n')
}, 'uri_get')
