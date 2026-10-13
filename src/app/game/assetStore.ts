import * as draw from '../../engine/draw'
import * as q from '../../engine/q'
import * as crc from '../../engine/crc'
import * as com from '../../engine/com'
import * as sys from '../../engine/sys'
import * as con from '../../engine/console'
import * as indexeddb from '../../shared/indexeddb'
import axios from 'axios'
import { FileMode } from '../../engine/interfaces/store/IAssetStore'
import { PackedFile, PakData, SearchPath } from '../../engine/types/Com'

const kvStore: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> =
  (typeof globalThis !== 'undefined' && (globalThis as any).localStorage)
    ? (globalThis as any).localStorage
    : (() => {
        const m = new Map<string, string>()
        return {
          getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
          setItem: (k: string, v: string) => { m.set(k, v) },
          removeItem: (k: string) => { m.delete(k) },
        }
      })()

const keepItToId1 = ['config.cfg', 'autoexec.cfg']
const remoteIndexes: Record<string, { fileName: string }[]> = {}

const residentFiles: Map<string, ArrayBuffer> = new Map()
const looseIndex: Map<string, Set<string>> = new Map()

const noteLoose = (dir: string, filename: string) => {
  let set = looseIndex.get(dir)
  if (set == null) {
    set = new Set()
    looseIndex.set(dir, set)
  }
  set.add(filename.toLowerCase())
}

const makeResident = (dir: string, filename: string, data: ArrayBuffer) => {
  residentFiles.set(dir + '/' + filename.toLowerCase(), data)
  noteLoose(dir, filename)
}

type ProgressCallback = (current: number, total: number) => void

const checkRemoteFileList = async function (
  game: string,
  fileName: string
): Promise<boolean> {
  if (!remoteIndexes[game]) {
    try {
      const response = await axios.get('/api/assets/' + game)
      remoteIndexes[game] = response.data
    } catch (err) {
      console.error('[assetStore] Failed to get remote asset index:', err)
      remoteIndexes[game] = []
    }
  }

  return remoteIndexes[game].some(f => f.fileName === fileName)
}

function getBinarySize(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('HEAD', url, true)

    xhr.onreadystatechange = function () {
      if (this.readyState === XMLHttpRequest.DONE) {
        if (xhr.status === 200) {
          const size = xhr.getResponseHeader('Content-Length')
          if (size == null) {
            reject(new Error(`HEAD ${url} returned no Content-Length header`))
          } else {
            resolve(Number(size))
          }
        } else {
          reject(new Error(`HEAD ${url} failed: status ${xhr.status}`))
        }
      }
    }

    xhr.onerror = () => reject(new Error(`HEAD ${url} failed: network error`))
    xhr.send()
  })
}

const getFileWithProgress = (
  url: string,
  progress: ProgressCallback
): Promise<ArrayBuffer> => {
  return getBinarySize(url).then(total => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.overrideMimeType('text/plain; charset=x-user-defined')
      xhr.open('GET', url)

      xhr.onload = () => {
        if (xhr.status !== 200) {
          reject(new Error(`GET ${url} failed: status ${xhr.status}`))
          return
        }

        try {
          resolve(q.strmem(xhr.responseText))
        } catch (err) {
          reject(new Error(`Failed to convert ${url} to binary data: ${String(err)}`))
        }
      }

      xhr.onerror = () => reject(new Error(`GET ${url} failed: network error`))
      xhr.addEventListener('progress', e => progress(e.loaded, total))
      xhr.send()
    })
  })
}

const getFile = async function (file: string) {
  return new Promise<{ status: number; responseText: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.overrideMimeType('text/plain; charset=x-user-defined')
    xhr.open('GET', file)

    xhr.onload = () => {
      resolve({
        status: xhr.status,
        responseText: xhr.responseText
      })
    }

    xhr.onerror = () => reject(new Error(`GET ${file} failed: network error`))
    xhr.send()
  })
}

export const openFile = (filename: string, mode: FileMode) => {
  return Promise.resolve(true)
}

export const readFile = (filename: string) => {
  throw new Error('Not Implemented')
}

export const writeFile = (
  filename: string,
  data: Uint8Array,
  len: number
) => {
  filename = filename.toLowerCase()
  const dest: string[] = []

  for (let i = 0; i < len; ++i) {
    dest[i] = String.fromCharCode(data[i])
  }

  try {
    kvStore.setItem(
      'Quake.' + com.state.searchpaths[com.state.searchpaths.length - 1].dir + '/' + filename,
      dest.join('')
    )
  } catch (e) {
    sys.print('COM.WriteFile: failed on ' + filename + '\n')
    return Promise.resolve(false)
  }

  sys.print('COM.WriteFile: ' + filename + '\n')
  return Promise.resolve(true)
}

export const writeTextFile = async (
  filename: string,
  data: string
): Promise<boolean> => {
  filename = filename.toLowerCase()

  const dir = keepItToId1.indexOf(filename) > -1
    ? 'id1'
    : com.state.searchpaths[com.state.searchpaths.length - 1].dir

  if (filename.endsWith('.sav')) {
    try {
      const buf = q.strmem(data)
      const existing = await indexeddb.getAsset(dir, filename)

      if (existing != null) {
        await indexeddb.removeAsset(String(existing.assetId))
      }

      await indexeddb.saveAsset(dir, filename, 1, buf, null)
      makeResident(dir, filename, buf)
      kvStore.removeItem('Quake.' + dir + '/' + filename)
    } catch (e) {
      sys.print('COM.WriteTextFile: failed on ' + filename + '\n')
      return false
    }

    sys.print('COM.WriteTextFile: ' + filename + '\n')
    return true
  }

  try {
    kvStore.setItem('Quake.' + dir + '/' + filename, data)
  } catch (e) {
    sys.print('COM.WriteTextFile: failed on ' + filename + '\n')
    return false
  }

  sys.print('COM.WriteTextFile: ' + filename + '\n')
  return true
}

export const deleteFile = async (filename: string): Promise<void> => {
  filename = filename.toLowerCase()

  for (let i = com.state.searchpaths.length - 1; i >= 0; --i) {
    const dir = com.state.searchpaths[i].dir

    kvStore.removeItem('Quake.' + dir + '/' + filename)
    residentFiles.delete(dir + '/' + filename)

    const existing = await indexeddb.getAsset(dir, filename)

    if (existing != null) {
      await indexeddb.removeAsset(String(existing.assetId))
    }
  }
}

const getLocalStorage = (game: string, filename: string) => {
  const path = game + '/' + filename
  const data = kvStore.getItem('Quake.' + path)

  if (data != null) {
    sys.print('FindFile: ' + path + '\n')
    return q.strmem(data)
  }

  return null
}

const _loadFile = async (filename: string): Promise<ArrayBuffer | null> => {
  filename = filename.toLowerCase()

  let i: number
  let j: number
  let search: SearchPath

  for (i = com.state.searchpaths.length - 1; i >= 0; --i) {
    search = com.state.searchpaths[i]

    if (keepItToId1.indexOf(filename) > -1 && search.dir !== 'id1') {
      continue
    }

    const data = getLocalStorage(search.dir, filename)

    if (data) {
      return data
    }

    for (j = search.packs.length - 1; j >= 0; j--) {
      const pack = search.packs[j]

      if (pack.type === 'indexeddb' && pack.data) {
        const file = pack.contents.find(p => p.name === filename)

        if (!file) {
          continue
        }

        return pack.data.slice(file.filepos, file.filepos + file.filelen)
      }
    }

    const tryIndexedDb = await indexeddb.getAsset(search.dir, filename)

    if (tryIndexedDb) {
      makeResident(search.dir, filename, tryIndexedDb.data)
      return tryIndexedDb.data
    }

    const netpath = search.dir + '/' + filename

    if (await checkRemoteFileList(search.dir, netpath)) {
      const gotFile = await getFile('/' + netpath)

      if (gotFile.status >= 200 && gotFile.status <= 299) {
        sys.print('FindFile: ' + netpath + '\n')
        const buf = q.strmem(gotFile.responseText)
        makeResident(search.dir, filename, buf)
        return buf
      }
    }
  }

  if (import.meta.env.VITE_ALLOW_SERVER_DOWNLOADS === 'true') {
    for (i = com.state.searchpaths.length - 1; i >= 0; --i) {
      search = com.state.searchpaths[i]
      const netpath = search.dir + '/' + filename
      const gotFile = await getFile('/' + netpath)

      if (gotFile.status >= 200 && gotFile.status <= 299) {
        sys.print('FindFile: ' + netpath + '\n')
        const buf = q.strmem(gotFile.responseText)
        makeResident(search.dir, filename, buf)
        return buf
      }
    }
  }

  sys.print("FindFile: can't find " + filename + '\n')
  return null
}

export const loadFileSync = (filename: string): ArrayBuffer | null => {
  filename = filename.toLowerCase()

  for (let i = com.state.searchpaths.length - 1; i >= 0; --i) {
    const search = com.state.searchpaths[i]

    if (keepItToId1.indexOf(filename) > -1 && search.dir !== 'id1') {
      continue
    }

    const data = getLocalStorage(search.dir, filename)

    if (data) {
      return data
    }

    for (let j = search.packs.length - 1; j >= 0; j--) {
      const pack = search.packs[j]

      if (pack.data) {
        const file = pack.contents.find(p => p.name === filename)

        if (file) {
          return pack.data.slice(file.filepos, file.filepos + file.filelen)
        }
      }
    }

    const resident = residentFiles.get(search.dir + '/' + filename)

    if (resident) {
      return resident
    }

    if (looseIndex.get(search.dir)?.has(filename)) {
      return null
    }
  }

  return null
}

const RESIDENT_MAX_EAGER_BYTES = 32 * 1024 * 1024

export const preloadResidentFiles = async (): Promise<void> => {
  residentFiles.clear()
  looseIndex.clear()

  for (const search of com.state.searchpaths) {
    const assets = await indexeddb.getAllAssetsPerGame(search.dir)

    for (const asset of assets) {
      if (asset.fileName.toLowerCase().endsWith('.pak')) {
        continue
      }

      noteLoose(search.dir, asset.fileName)

      if (asset.data.byteLength >= RESIDENT_MAX_EAGER_BYTES) {
        continue
      }

      makeResident(search.dir, asset.fileName, asset.data)
    }
  }
}

export const listFiles = (prefix: string): string[] => {
  const p = prefix.toLowerCase()
  const names: string[] = []

  for (const search of com.state.searchpaths) {
    const loose = looseIndex.get(search.dir)

    if (loose == null) {
      continue
    }

    for (const name of loose) {
      if (name.startsWith(p)) {
        names.push(name)
      }
    }
  }

  return names
}

export const evictResidentFile = (filename: string): void => {
  const f = filename.toLowerCase()

  for (const search of com.state.searchpaths) {
    residentFiles.delete(search.dir + '/' + f)
  }
}

export const loadFile = async (
  filename: string
): Promise<ArrayBuffer | null> => {
  draw.beginDisc(filename)

  try {
    return await _loadFile(filename)
  } finally {
    draw.endDisc()
  }
}

const getPackFileContents = (
  game: string,
  name: string,
  data: ArrayBuffer
): PackedFile[] => {
  if (data.byteLength < 12) {
    throw new Error(`${game}/${name} is too small to be a valid PAK file`)
  }

  const header = new DataView(data)

  if (header.getUint32(0, true) !== 0x4b434150) {
    throw new Error(`${game}/${name} is not a valid PAK file (invalid PACK signature)`)
  }

  const dirofs = header.getUint32(4, true)
  const dirlen = header.getUint32(8, true)

  if (dirlen % 64 !== 0 || dirofs + dirlen > data.byteLength) {
    throw new Error(
      `${game}/${name} has an invalid PAK directory: offset=${dirofs}, length=${dirlen}, size=${data.byteLength}`
    )
  }

  const numpackfiles = dirlen >> 6

  if (numpackfiles !== 339) {
    com.state.modified = true
  }

  const pack: PackedFile[] = []

  if (numpackfiles !== 0) {
    const info = new DataView(data, dirofs, dirlen)

    if (crc.block(new Uint8Array(data, dirofs, dirlen)) !== 32981) {
      com.state.modified = true
    }

    for (let i = 0; i < numpackfiles; ++i) {
      const entryOffset = i << 6
      const nameBytes = new Uint8Array(data, dirofs + entryOffset, 56)

      pack.push({
        name: q.memstr(nameBytes).toLowerCase(),
        filepos: info.getUint32(entryOffset + 56, true),
        filelen: info.getUint32(entryOffset + 60, true)
      })
    }

    con.print('Added packfile ' + name + ' (' + numpackfiles + ' files)\n')
  }

  return pack
}

const loadStorePackFile = async (
  game: string,
  packName: string
): Promise<PakData | null> => {
  try {
    const entry = await indexeddb.getAsset(game, packName)

    if (!entry) {
      return null
    }

    return {
      name: entry.fileName,
      data: entry.data,
      type: 'indexeddb',
      contents: getPackFileContents(game, entry.fileName, entry.data)
    }
  } catch (err) {
    console.error(`[assetStore] Failed to load stored pack ${game}/${packName}:`, err)
    return null
  }
}

const loadServerPackFile = async (
  game: string,
  packName: string
): Promise<PakData | null> => {
  const packfile = game + '/' + packName

  try {
    if (!import.meta.env.DEV && !await checkRemoteFileList(game, packfile)) {
      console.warn(`[assetStore] ${packfile} is not listed in the remote asset index`)
      return null
    }

    const data = await getFileWithProgress(packfile, () => {})

    if (!data) {
      console.warn(`[assetStore] Empty response for ${packfile}`)
      return null
    }

    if (data.byteLength < 12) {
      throw new Error(`${packfile} is too small: ${data.byteLength} bytes`)
    }

    const dataDv = new DataView(data)

    if (dataDv.getUint32(0, true) !== 0x4b434150) {
      const signature = Array.from(new Uint8Array(data, 0, Math.min(4, data.byteLength)))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join(' ')

      throw new Error(`${packfile} has an invalid PACK signature. First bytes: ${signature}`)
    }

    const dirOffset = dataDv.getUint32(4, true)
    const dirLength = dataDv.getUint32(8, true)

    if (dirLength % 64 !== 0 || dirOffset + dirLength > data.byteLength) {
      throw new Error(
        `${packfile} has an invalid directory: offset=${dirOffset}, length=${dirLength}, size=${data.byteLength}`
      )
    }

    const numpackfiles = dirLength >> 6

    if (numpackfiles !== 339) {
      com.state.modified = true
    }

    await indexeddb.saveAsset(game, packName, numpackfiles, data, null)

    const contents = getPackFileContents(game, packName, data)

    console.info(
      `[assetStore] Loaded ${packfile}: ${data.byteLength} bytes, ${contents.length} entries`
    )

    const expectedFiles = ['gfx/pop.lmp', 'gfx.wad']

    for (const expected of expectedFiles) {
      const found = contents.some(file => file.name.replace(/\\/g, '/') === expected)

      if (!found) {
        console.warn(`[assetStore] ${expected} is not present in ${packfile}`)
      }
    }

    return {
      name: packName,
      data,
      type: 'indexeddb',
      contents
    }
  } catch (err) {
    console.error(`[assetStore] Failed to load ${packfile}:`, err)
    return null
  }
}

export const saveDownloadedFile = async (
  game: string,
  filename: string,
  data: ArrayBuffer
): Promise<void> => {
  await indexeddb.saveAsset(game, filename, 0, data, null)
  makeResident(game, filename, data)
}

export const loadPackFile = async (
  dir: string,
  packName: string
): Promise<PakData | null> => {
  let entry: PakData | null = await loadStorePackFile(dir, packName)

  if (!entry) {
    entry = await loadServerPackFile(dir, packName)
  }

  return entry
}