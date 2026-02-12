import {PakData} from '../../types/Com'

export enum FileMode {
  READ,
  APPEND,
  WRITE
}

export default interface IAssetStore {
  loadPackFile: (dir: string, packName: string) => Promise<PakData | null>,
  loadFile: (filename: string) => Promise<ArrayBuffer>,

  // lower level operations
  openFile: (filename: string, mode: FileMode) => Promise<boolean>,
  readFile: (filename: string) => Promise<Buffer>,
  writeFile: (filename: string, data: Uint8Array, len: number) => Promise<boolean>,
  writeTextFile: (filename: string, data: string) => Promise<boolean>,
}