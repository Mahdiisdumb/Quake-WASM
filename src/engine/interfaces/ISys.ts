import IAssetStore from "./store/IAssetStore";

export interface ISys {
  print: (text: string) => void,
  quit: (reason?: string) => void,
  floatTime: () => number,
  error: (text: string) => void,
  getExternalCommand: () => string,
  init: (argv: string) => void,
  assetStore: IAssetStore,
  requestPak: () => Promise<any>
}