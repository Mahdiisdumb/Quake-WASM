import axios from 'axios'
import JSZip from '@progress/jszip-esm'
import * as indexedDb from '../../../shared/indexeddb'
import {any, tail, find, prop} from 'ramda'
import {QuaddictedMap} from '../types/QuaddictedMap'
import { defineStore } from 'pinia'
import { useGameStore } from './game'
import { getMapFilenames, readPackFile } from '../helpers/assetChecker'
import type { PackageMeta, PackageMetaSeed } from '../../../shared/types/Store'
import type { SourceId } from '../../../shared/types/Source'
import { isMap } from '../helpers/map'

var mapListingPromise: Promise<void> | null = null

const quaddictedMapsUrl = '/api/maps'
// const quaddictedMapsUrl = 'http://localhost:3000/api/maps'

type MapLoadState = 'loading' | 'idle' | 'error'
type LoadProgress = {
  loaded: number
  total: number
  message: string
}

interface State {
  mapListing: QuaddictedMap[]
  mapLoadState: MapLoadState
  mapLoadProgress: LoadProgress
}

export const useMapsStore = defineStore('maps', {
  state: (): State => ({
    mapListing: [],
    mapLoadState: 'idle',
    mapLoadProgress: {
      loaded: 0,
      total: 0,
      message: ''
    }
  }),
  getters: {
    getMapListing: (state: State) => state.mapListing,
    getMapLoadProgress: (state: State) => state.mapLoadProgress,
    getMapFromId: (state: State) => (id: string): QuaddictedMap => find<QuaddictedMap>(map => map.id === id, state.mapListing)!
  },
  actions: {
    setMapLoadState (mapLoadState: MapLoadState) {
      this.mapLoadState = mapLoadState
    },
    setMapListing (mapListing: QuaddictedMap[])  {
      this.mapListing = mapListing
    },
    setMapLoadProgress ({loaded, total, message}: {loaded?: number, total?: number, message?: string}) {
      this.mapLoadProgress.loaded = loaded || loaded === 0 ? loaded : this.mapLoadProgress.loaded
      this.mapLoadProgress.total = total || total === 0 ? total : this.mapLoadProgress.total
      this.mapLoadProgress.message = message || message === '' ? message : this.mapLoadProgress.message
    },
    async getMapListForPackage (packageId: number) {
      const assets = await indexedDb.getAllMetaPerPackageId(packageId)
      
      // Get map names from .bsp files
      const bspMaps = assets.filter(a => isMap(a.fileName))
        .map(a => a.fileName.replace(/^maps\//, '').replace(/\.bsp$/, ''))
      
      // Get map names from .pak files
      const pakAssets = assets.filter(a => a.fileName.toLowerCase().endsWith('.pak'))
      const pakMapPromises = pakAssets.map(async (pakAsset) => {
        const asset = await indexedDb.getAsset(pakAsset.game, pakAsset.fileName)
        if (asset && asset.data) {
          return getMapFilenames(asset.data)
        }
        return []
      })
      
      const pakMaps = (await Promise.all(pakMapPromises)).flat()
      // Combine and deduplicate map names
      const allMaps = [...new Set([...bspMaps, ...pakMaps])]
      return allMaps
    },
    loadPackageMeta(sourceId: SourceId) {
      return indexedDb.getPackageBySourceId(sourceId)
    },
    loadMapListing () { 
      if (!mapListingPromise) {
        mapListingPromise = axios.get<QuaddictedMap[]>(quaddictedMapsUrl)
          .then(response => this.setMapListing(response.data))
      }
      return mapListingPromise
    },
    async loadMap (sourceId: SourceId) {
      const gameStore = useGameStore()
      let packageMeta = await this.loadPackageMeta(sourceId);
      if (!packageMeta) {
        try {
          this.mapLoadState = 'loading'
          const mapsMeta = await this.downloadSourceMetadata(sourceId)
          let gameDir = mapsMeta.gameDir || 'id1'
          if (mapsMeta.depends){
            const baseSourceId: SourceId = `quaddicted:${mapsMeta.depends}`
            let dependsPackageMeta = await this.loadPackageMeta(baseSourceId)
            if (!dependsPackageMeta) {
              const basePkg = await this.downloadPackage(baseSourceId, await this.downloadSourceMetadata(baseSourceId))
              gameDir = basePkg.gameDir // Use the dependent package as the gamedir.
            }
          }
          packageMeta = await this.downloadPackage(sourceId, mapsMeta, gameDir)
          
          gameStore.loadAssets()
        } finally {
          this.mapLoadState = 'idle'
        }
      }
      return packageMeta
    },
    async downloadSourceMetadata (sourceId: SourceId) {
      const [source, mapID] = sourceId.split(':')

      const baseUrl = source === 'quaddicted' 
      ? quaddictedMapsUrl 
      : ''

      if (!baseUrl) throw new Error('Unknown source ' + source)

      const url = baseUrl + '/' + mapID
      return prop('data', await axios.get(url)) as QuaddictedMap
    },
    async downloadPackage (sourceId: SourceId, mapsMeta: QuaddictedMap, gameDir?: string): Promise<PackageMeta> {
      const arrayBuf = await getBinaryData(mapsMeta.downloadLink, mapsMeta.byteLength, (loaded, total) => {
        this.setMapLoadProgress({loaded, total, message: `Downloading ${mapsMeta.fileName}...`})
      })
  
      this.setMapLoadProgress({ message: `Unzipping ${mapsMeta.fileName}...`})
    
      // @ts-ignore
      const zip = new JSZip()
      await zip.loadAsync(arrayBuf)
  
      // Ignore entries marked as directories
      const files = Object.keys(zip.files).filter(f => !zip.files[f].dir)
    
      const fixedFilePaths = fixBaseDir(files)
      const pkg = {
        sourceId,
        depends: mapsMeta.depends,
        gameDir: gameDir || mapsMeta.gameDir || 'id1',
        name: mapsMeta.title || mapsMeta.name
      }

      const packageId = await indexedDb.savePackage(pkg)
      // Unzip all files, and send them to the file handler with packageId
      await Promise.all(files.map((fileName, idx) => {
        const file = zip.file(fileName)
        if (!file) {
          return
        }
        return file.async("arraybuffer")
          .then((buffer: ArrayBuffer) => saveToIndexedDb(pkg.gameDir, fixedFilePaths[idx], buffer, packageId))
      }))

      return {
        packageId,
        ...pkg
      }
    }
  }
})

const strmem = function(src: string): ArrayBuffer
{
	var buf = new ArrayBuffer(src.length)
	var dest = new Uint8Array(buf)
	var i
	for (i = 0; i < src.length; ++i)
		dest[i] = src.charCodeAt(i) & 255
	return buf
}

// function getBinarySize (url) {
//   return new Promise((resolve, reject) => {
//     var xhr = new XMLHttpRequest();
//     xhr.open("HEAD", url, true); // Notice "HEAD" instead of "GET",
//                                  //  to get only the header
//     xhr.onreadystatechange = function() {
//       if (this.readyState == this.DONE) {
//         resolve(parseInt(xhr.getResponseHeader("Content-Length")));
//       }
//     };
//     xhr.onerror = reject
//     xhr.send();
//   })
// }

const getBinaryData = (url: string, total: number, progress: (loaded: number, total: number) => void): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.overrideMimeType('text\/plain; charset=x-user-defined')
    xhr.open('GET', url)
    xhr.onload = () => {
      resolve(strmem(xhr.responseText));    
    }
    xhr.onerror = (e) => reject(e) 
    xhr.addEventListener('progress', e => {
      progress(e.loaded, total)
    });
    xhr.send()
  })
}

const anyFirstElementContains = (searchTerm: string) =>
  any((fa: string[]) => fa.length > 0 && fa[0].toLowerCase().indexOf(searchTerm) > -1)

const anyFirstElementIs = (searchTerm: string) =>
  any((fa: string[]) => fa.length > 0 && fa[0].toLowerCase() === searchTerm)

const fixBaseDir = (fileList: string[]) => {
  const hasAMapAtRoot = anyFirstElementContains('.bsp')
  const hasMapDirAtRoot = anyFirstElementIs('maps')
  const hasPakFileAtRoot = anyFirstElementContains('.pak')

  let fileArrays = fileList.map(file => file.split('/'))
  while (true) {
    if (hasAMapAtRoot(fileArrays)) {
      return fileArrays.map(fa => ['maps'].concat(fa).join('/'))
    } else if (hasMapDirAtRoot(fileArrays) || hasPakFileAtRoot(fileArrays)) {
      return fileArrays.map(fa => fa.join('/'))
    } else if (!fileArrays.some(fa => fa.length > 1)) {
      return fileArrays.join('/')
    }
    
    // Remove dir and try again.
    fileArrays = fileArrays.map(fa => fa.length > 1 ? tail(fa) : fa)
  }
}

const saveToIndexedDb = async (gameDir: string, fileName: string, data: ArrayBuffer, packageId?: number) => {
  let fileCount = 0
  if (fileName.toLowerCase().includes('pak')) {
    const pak = readPackFile(data)
    fileCount = pak.length
  }
  return indexedDb.saveAsset(gameDir, fileName, fileCount, data, packageId || null)
}