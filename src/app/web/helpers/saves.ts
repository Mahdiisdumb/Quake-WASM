// Savegame helpers for the Setup > Saves tab: header parsing, game-directory
// naming, and the export/import filename scheme.
import { officialGameDefinitions } from './games'
import type { AssetMeta, PackageMeta } from '../../../shared/types/Store'
import * as indexedDb from '../../../shared/indexeddb'

export const SAVEGAME_VERSION = 5
/** Version the Kex rerelease writes; a different format this engine cannot load. */
export const SAVEGAME_VERSION_KEX = 6
/** Slots the in-game load/save menus scan (s0 .. s11). */
export const MENU_SLOTS = 12
export const SAVE_EXT = '.sav'

/** Parsed vanilla savegame header (version, comment, 16 spawn parms, skill, map, time). */
export type SaveHeader = {
  /** Level title from the comment line, underscores restored to spaces. */
  title: string
  /** BSP name, as passed to spawnServer. */
  map: string
  kills: number | null
  totalKills: number | null
  skill: number
  /** Server time in seconds. */
  time: number
}

export type SaveEntry = {
  meta: AssetMeta
  header: SaveHeader | null
}

export const officialDirs = (): string[] => officialGameDefinitions.map(d => gameDirOf(d.game))

/** The official definitions call id1 "original"; everything else is already a directory. */
export const gameDirOf = (game: string) => game === 'original' ? 'id1' : game

const HEADER_BYTES = 2048

/** Text of the leading bytes, one char per byte (matches the engine's strmem convention). */
const headerText = (buf: ArrayBuffer): string => {
  const bytes = new Uint8Array(buf, 0, Math.min(buf.byteLength, HEADER_BYTES))
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

/** Version number on the first line, NaN when there is none. */
export const saveVersion = (buf: ArrayBuffer): number => parseFloat(headerText(buf).split('\n')[0])

/** Null when the buffer is not a version-5 save. Tolerates CRLF. */
export const parseSaveHeader = (buf: ArrayBuffer): SaveHeader | null => {
  const lines = headerText(buf).split('\n').map(l => l.replace(/\r$/, ''))
  if (lines.length < 21) return null
  if (parseFloat(lines[0]) !== SAVEGAME_VERSION) return null
  const map = lines[19].trim()
  if (map.length === 0 || map.indexOf('..') !== -1) return null
  const skill = parseInt(lines[18], 10)
  const time = parseFloat(lines[20])
  if (isNaN(skill) || isNaN(time)) return null
  return { ...parseComment(lines[1]), map, skill, time }
}

// Host_SavegameComment: "%-22s kills:%3i/%3i" with spaces turned into underscores.
const parseComment = (comment: string) => {
  const m = comment.match(/kills:_*(\d+)\/_*(\d+)/)
  const titleRaw = m ? comment.substring(0, m.index) : comment
  const title = titleRaw.replace(/_+$/, '').replace(/_/g, ' ')
  return {
    title,
    kills: m ? parseInt(m[1], 10) : null,
    totalKills: m ? parseInt(m[2], 10) : null,
  }
}

/** Menu-slot index for names like "s3", else null. */
export const slotIndex = (fileName: string): number | null => {
  const m = stripExt(fileName).match(/^s(\d{1,2})$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n < MENU_SLOTS ? n : null
}

export const slotFileName = (slot: number) => `s${slot}${SAVE_EXT}`

/** "Slot 4 (s3)" for menu slots, the bare name otherwise. */
export const saveLabel = (fileName: string): string => {
  const slot = slotIndex(fileName)
  return slot != null ? `Slot ${slot + 1} (s${slot})` : stripExt(fileName)
}

export const stripExt = (fileName: string) =>
  fileName.toLowerCase().endsWith(SAVE_EXT) ? fileName.slice(0, -SAVE_EXT.length) : fileName

export const isSaveFile = (fileName: string) => fileName.toLowerCase().endsWith(SAVE_EXT)

/** Player-facing name for a game directory: official campaign, else the installed package, else the raw dir. */
export const gameDisplayName = (dir: string, packages: PackageMeta[]): string => {
  const official = officialGameDefinitions.find(d => gameDirOf(d.game) === dir)
  if (official) return official.name
  const pkg = packages.find(p => p.gameDir === dir)
  return pkg ? pkg.name : dir
}

/**
 * Directories a save could belong to, judged by its map: official map lists
 * plus loose maps/<name>.bsp assets. Maps inside mod paks are invisible here,
 * so an empty result means "ask", not "unknown game".
 */
export const candidateDirsForMap = (map: string, dirs: string[], assetMetas: AssetMeta[]): string[] => {
  const m = map.toLowerCase()
  const out = new Set<string>()
  for (const def of officialGameDefinitions)
    if (def.mapList.some(gm => gm.name.toLowerCase() === m)) out.add(gameDirOf(def.game))
  const loose = `maps/${m}.bsp`
  for (const meta of assetMetas)
    if (meta.fileName.toLowerCase() === loose) out.add(meta.game)
  return dirs.filter(d => out.has(d))
}

// ── Export filename scheme ──────────────────────────────────────────────────
// "<Game name> - <save name> - <map>.sav". The game name is what the player
// sees elsewhere in the UI, and import maps it back to a directory. Internal
// path separators (autosave/e1m1) become "~" so the name stays a single file.

const PART_SEP = ' - '
const PATH_SUB = '~'

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_').trim()

export const exportFileName = (dir: string, fileName: string, header: SaveHeader | null, packages: PackageMeta[]) => {
  const game = safeName(gameDisplayName(dir, packages))
  const stem = stripExt(fileName).replace(/\//g, PATH_SUB)
  const map = header ? safeName(header.map) : ''
  return [game, stem, map].filter(p => p.length > 0).join(PART_SEP) + SAVE_EXT
}

export type ImportName = { dir: string | null, fileName: string }

/** Parse a dropped file's name back to (dir, internal fileName); dir is null when the name carries no recognisable game. */
export const parseImportName = (name: string, dirs: string[], packages: PackageMeta[]): ImportName => {
  const base = name.replace(/^.*[\\/]/, '')
  const stem = stripExt(base)
  const lower = stem.toLowerCase()
  // Match on the sanitised name exportFileName wrote (":" etc. become "_"), longest
  // first so a game whose name is a prefix of another's can't steal the match.
  let best: { dir: string, prefix: string } | null = null
  for (const dir of dirs) {
    for (const label of [safeName(gameDisplayName(dir, packages)), dir]) {
      const prefix = label.toLowerCase() + PART_SEP
      if (lower.startsWith(prefix) && (best == null || prefix.length > best.prefix.length))
        best = { dir, prefix }
    }
  }
  if (best == null) return { dir: null, fileName: normalizeSaveName(stem) }
  const rest = stem.substring(best.prefix.length)
  const mapSep = rest.lastIndexOf(PART_SEP)
  const saveName = mapSep > 0 ? rest.substring(0, mapSep) : rest
  return { dir: best.dir, fileName: normalizeSaveName(saveName.split(PATH_SUB).join('/')) }
}

/** Lowercase, extension added, no traversal or leading slashes. */
export const normalizeSaveName = (stem: string): string => {
  let s = stem.toLowerCase().replace(/\\/g, '/').replace(/\.\./g, '').replace(/^\/+/, '').trim()
  if (s.length === 0) s = 'imported'
  return s.endsWith(SAVE_EXT) ? s : s + SAVE_EXT
}

/** Windows engines write CRLF; the loader takes the map name from a raw line, so normalise to LF. */
export const normalizeLineEndings = (buf: ArrayBuffer): ArrayBuffer => {
  const src = new Uint8Array(buf)
  let cr = 0
  for (let i = 0; i < src.length; i++) if (src[i] === 13 && src[i + 1] === 10) cr++
  if (cr === 0) return buf
  const dst = new Uint8Array(src.length - cr)
  let j = 0
  for (let i = 0; i < src.length; i++) {
    if (src[i] === 13 && src[i + 1] === 10) continue
    dst[j++] = src[i]
  }
  return dst.buffer
}

const LEGACY_KEY = /^Quake\.([^/]+)\/(.+\.sav)$/

/**
 * Move savegames from the pre-IndexedDB localStorage layout ("Quake.<dir>/<name>.sav")
 * into the asset store, where the Saves tab and the engine's save path both look.
 * The localStorage copy is removed only after its IndexedDB write succeeds. If the
 * name is already taken in IndexedDB the legacy save lands beside it as "<name>_old".
 * Returns the number moved.
 */
export const migrateLegacySaves = async (): Promise<number> => {
  const keys: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key != null && LEGACY_KEY.test(key)) keys.push(key)
    }
  } catch {
    return 0 // storage blocked
  }
  let moved = 0
  for (const key of keys) {
    const m = key.match(LEGACY_KEY)!
    const dir = m[1].toLowerCase()
    const text = localStorage.getItem(key)
    if (text == null) continue
    const bytes = new Uint8Array(text.length)
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 255
    let fileName = m[2].toLowerCase()
    for (let n = 0; await indexedDb.getAsset(dir, fileName) != null; n++)
      fileName = `${stripExt(m[2].toLowerCase())}_old${n === 0 ? '' : n + 1}${SAVE_EXT}`
    try {
      await indexedDb.saveAsset(dir, fileName, 1, bytes.buffer, null)
    } catch {
      continue // leave the legacy copy in place
    }
    localStorage.removeItem(key)
    moved++
  }
  return moved
}

export const formatPlayTime = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
