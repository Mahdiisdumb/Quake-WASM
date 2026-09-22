import {PakData} from '../../types/Com'

// FRIK_FILE fopen modes, numbered as the QC constants are (FTE pr_common.h:890-896).
export enum FileMode {
  READ,
  APPEND,
  WRITE,
  // Read-only like READ, but newlines are not special: fgets hands back the whole file in one
  // lump (FILE_READNL, pr_common.h:894). 3 is unassigned; MMAP modes 5/6 are not implemented.
  READNL = 4
}

export default interface IAssetStore {
  loadPackFile: (dir: string, packName: string) => Promise<PakData | null>,
  loadFile: (filename: string) => Promise<ArrayBuffer>,
  // Synchronous read for the de-async frame path. Serves only resident
  // sources (local files, in-memory pak data, files preloaded by
  // preloadResidentFiles); returns null when the file is not resident.
  loadFileSync: (filename: string) => ArrayBuffer | null,
  // Copies every loose asset for the current searchpaths into memory so
  // loadFileSync can serve them. Re-run when the searchpath set changes.
  // Optional: stores whose loadFileSync is already total (node fs) omit it.
  preloadResidentFiles?: () => Promise<void>,
  // Full lowercased paths of the loose (non-pak) files under prefix across every
  // searchpath, for completion listings. Optional: stores that cannot enumerate omit it.
  listFiles?: (prefix: string) => string[],
  // Drop a file's resident bytes (all searchpaths). Used after parsing huge
  // sources (BSP/.lit) whose data lives on in engine structures; a later
  // loadFile re-residents on demand. Optional: no-op for total stores.
  evictResidentFile?: (filename: string) => void,

  // lower level operations
  openFile: (filename: string, mode: FileMode) => Promise<boolean>,
  readFile: (filename: string) => Promise<Buffer>,
  writeFile: (filename: string, data: Uint8Array, len: number) => Promise<boolean>,
  writeTextFile: (filename: string, data: string) => Promise<boolean>,
  // Remove a previously written file from every storage backend (no-op if absent)
  deleteFile: (filename: string) => Promise<void>,

  // save a downloaded file to the asset store
  saveDownloadedFile: (game: string, filename: string, data: ArrayBuffer) => Promise<void>,
}