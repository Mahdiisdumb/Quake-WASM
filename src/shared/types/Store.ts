import { SourceId } from "./Source";

export type PackageType = 'map' | 'mod';

// Describes a package that has been loaded and is available.
export type PackageMeta = {
  packageId: number
  sourceId: SourceId,
  name: string
  gameDir: string
  depends: string | null// map id
}

export type PackageMetaSeed = Omit<PackageMeta, 'packageId'>

export type AssetMeta = {
  game: string
  assetId: string
  fileName: string
  fileCount: number
  packageId?: number
}

export type Asset = AssetMeta & {
  data: ArrayBuffer
}
