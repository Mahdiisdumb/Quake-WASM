import type { AssetMeta, PackageMeta } from './types/Store';
import type {SourceId} from './types/Source'

type DbAssetMeta = {
  fileCount: number
  fileName: string
  game: string
  packageId?: number
}

const dbName = 'webQuakeAssets',
  metaStoreName = 'meta',
  assetStoreName = 'asset',
  packageStoreName = 'package',
  dbVersion = 6;

const indexedDb: IDBFactory = window.indexedDB
const packageSourceIdIndex = "sourceId"
const gameAndFileIndex = "game, filename"
const gameIndex = "game"

function open (): Promise<IDBDatabase> {
  return new Promise(function(resolve, reject){
    var openReq: IDBOpenDBRequest = indexedDb.open(dbName, dbVersion);
    openReq.onupgradeneeded = async function(event: any) {
      var db = event.target.result as IDBDatabase;
      if (event.oldVersion < 4) {
        db.createObjectStore("meta", { autoIncrement: true });
        db.createObjectStore("assets", { keyPath: 'assetId' });
      }
      if (event.oldVersion < 5) {
        var metaStore = openReq.transaction.objectStore("meta");
        metaStore.createIndex(gameIndex, "game", { unique: false });
        metaStore.createIndex(gameAndFileIndex, ["game", "fileName"], { unique: false });
      }
      if (event.oldVersion < 6) {
        await migrateToVersion6(db, openReq.transaction)
        // Remove all stores since we have new indexes.
        /*
        New Schema:
        package: (autoIncrement)
          packageId
          name
          game
          type: 'map' | 'mod'
        meta: (keyPath: fileName)
          packageId
          fileName
          game
          assetId
        asset:
          assetId
          data
        */
      }
    };
    openReq.onerror = function(event) {
      alert("Why didn't you allow my web app to use IndexedDB?!");
      reject()
    };
    openReq.onsuccess = function(event: any){
      resolve(event.target.result);
    };
  });
}

const migrateToVersion6 = async (db: IDBDatabase, trans: IDBTransaction) => {
  const getAssetV5 = async (db: IDBDatabase, fileName: string) => {
    var meta = trans.objectStore('meta');
    var assets = trans.objectStore('assets');
    var index = meta.index(gameAndFileIndex);

    // Select the first matching record
    const assetMeta = await promiseMe<DbAssetMeta>(index.get(IDBKeyRange.only(['id1', fileName.toLowerCase()])))
    if (assetMeta) {
      const assetId = await promiseMe<number>(index.getKey(IDBKeyRange.only(['id1', fileName.toLowerCase()])))
      return {
        ...assetMeta,
        ...(await promiseMe<{data: ArrayBuffer}>(assets.get(assetId)))
      }
    }
    return null
  }

  const saveAssetV6 = async (
    assetStore: IDBObjectStore, 
    metaStore: IDBObjectStore, 
    game: string, fileName: string, fileCount: number, blob: ArrayBuffer) => {
    if (!game || !fileName || blob.byteLength <= 0) {
      throw new Error('Missing data while trying to save asset')
    }
    const metaObj: DbAssetMeta = {
      game: game.toLowerCase(),
      fileName: fileName.toLowerCase(),
      fileCount
    }
    const assetId = await promiseMe(metaStore.put(metaObj))
    await promiseMe(assetStore.put({data: blob, assetId}))
    return assetId
  }

  // Migrate these.
  const id1AssetsToRetain = ['pak0.pak', 'pak1.pak']
  let id1Assets
  try {
    id1Assets = await Promise.all(id1AssetsToRetain.map(fileName => getAssetV5(db, fileName)))
  } catch (error) {
    console.error('Error migrating assets: ', error)
  }


  db.deleteObjectStore('meta')
  db.deleteObjectStore('assets')
  
  var metaStore = db.createObjectStore("meta", { autoIncrement: true })
  metaStore.createIndex(gameIndex, "game", { unique: false });
  metaStore.createIndex(gameAndFileIndex, ["game", "fileName"], { unique: true });

  const assetStore = db.createObjectStore("asset", { keyPath: 'assetId' })
  const packageStore = db.createObjectStore("package", { autoIncrement: true });
  packageStore.createIndex(gameIndex, "game", { unique: false });
  packageStore.createIndex(packageSourceIdIndex, "sourceId", { unique: true });

  for (const asset of id1Assets) {
    if (asset) {
      await saveAssetV6(assetStore, metaStore, asset.game, asset.fileName, asset.fileCount, asset.data);
    }
  }
}

const promiseMe = <T>(request: IDBRequest): Promise<T> => {
  return new Promise((resolve, reject) =>  {
    request.onerror = function(e) {
      console.log(e);
      reject(e);
    };
    request.onsuccess = function(event) {
      resolve(request.result as T);
    };
  })
}

const dbOperation = async <T>(storeName: string, fn: (db: IDBObjectStore) => IDBRequest): Promise<T> => {
  const db = await open()
  const store = db
    .transaction([storeName], 'readwrite')
    .objectStore(storeName); 

  return promiseMe<T>(fn(store))
}

export const getAllMeta = async (): Promise<Array<AssetMeta>> => {
  const db = await open()

  var transaction = db.transaction(['meta'], 'readonly');
  var meta = transaction.objectStore('meta');

  // Select the first matching record, if any exists, assume game exists
  const allKeys = await promiseMe<string[]>(meta.getAllKeys())
  
  return Promise.all(allKeys.map(async key => {
    const metaObj = await promiseMe<DbAssetMeta>(meta.get(key))

    return {
      ...metaObj,
      assetId: key
    }
  }))
}


export const getAllMetaPerGame = async (game: string): Promise<AssetMeta[]> => {
  const assetMetas = await getAllMeta()
  return assetMetas.filter(meta => meta.game === game.toLowerCase())
}

export const getAllMetaPerPackageId = async (packageId: number) => {
  const assetMetas = await getAllMeta()
  return assetMetas.filter(meta => meta.packageId === packageId)
}

export const getAllAssets = async () => {
  return dbOperation(assetStoreName, store => store.getAll())
}

export const getAllAssetsPerGame = async (game: string) => {
  const assetMetas = await getAllMetaPerGame(game)
  
  return Promise.all(assetMetas.map(async assetMeta => {
    const asset = await dbOperation<{data: ArrayBuffer}>(assetStoreName, store => store.get(assetMeta.assetId))
    return {
      ...assetMeta,
      ...asset
    }
  }))
}


export const getAsset = async (game: string, fileName : string) => {
  const db = await open()

  var transaction = db.transaction(['asset', 'meta'], 'readonly');
  var meta = transaction.objectStore('meta');
  var assets = transaction.objectStore('asset');
  var index = meta.index(gameAndFileIndex);

  // Select the first matching record
  const assetMeta = await promiseMe<DbAssetMeta>(index.get(IDBKeyRange.only([game.toLowerCase(), fileName.toLowerCase()])))
  if (assetMeta) {
    const assetId = await promiseMe<number>(index.getKey(IDBKeyRange.only([game.toLowerCase(), fileName.toLowerCase()])))
    return {
      ...assetMeta,
      ...(await promiseMe<{data: ArrayBuffer}>(assets.get(assetId)))
    }
  }
  return null
} 

export const saveAsset = async (game: string, fileName: string, fileCount: number, blob: ArrayBuffer, packageId: number | null) => {
  if (!game || !fileName || blob.byteLength <= 0) {
    throw new Error('Missing data while trying to save asset')
  }
  const metaObj: DbAssetMeta = {
    game: game.toLowerCase(),
    fileName: fileName.toLowerCase(),
    fileCount,
    ...(packageId && { packageId })
  }
  try {

    const assetId = await dbOperation(metaStoreName, store => store.put(metaObj))
    await dbOperation(assetStoreName, store => store.put({data: blob, assetId}))
    return assetId
  }
  catch(e) {
    console.log(`failed trying to save ${game} ${fileName}`)
    throw e
  }
}

export const updateAssetFileName = async (assetId: string, newFileName: string): Promise<void> => {
  const db = await open()
  const transaction = db.transaction([metaStoreName], 'readwrite')
  const metaStore = transaction.objectStore(metaStoreName)
  
  const existingMeta = await promiseMe<DbAssetMeta>(metaStore.get(assetId))
  if (!existingMeta) {
    throw new Error(`Asset with ID ${assetId} not found`)
  }
  
  const updatedMeta: DbAssetMeta = {
    ...existingMeta,
    fileName: newFileName.toLowerCase()
  }
  
  await promiseMe(metaStore.put(updatedMeta, assetId))
}

export const removeAsset = async (assetId: string): Promise<void> => {
  await dbOperation(metaStoreName, store => store.delete(assetId))
  return await dbOperation(assetStoreName, store => store.delete(assetId))
}

export const hasGame = async (game: string) => {
  const db = await open()

  var transaction = db.transaction(['meta'], 'readonly');
  var meta = transaction.objectStore('meta');
  var index = meta.index(gameIndex);

  // Select the first matching record, if any exists, assume game exists
  const assetMeta = await promiseMe<DbAssetMeta>(index.get(IDBKeyRange.only(game.toLowerCase())))
  return !!assetMeta
}

export const removeGame = async (game: string) => {
  const db = await open()

  var transaction = db.transaction([metaStoreName, assetStoreName], 'readwrite')
  var metas = transaction.objectStore(metaStoreName)
  var assets = transaction.objectStore(assetStoreName)
  var metaGameIndex = metas.index(gameIndex)

  const assetMetaKeys = await promiseMe<number[]>(metaGameIndex.getAllKeys(IDBKeyRange.only(game.toLowerCase())))

  return Promise.all(assetMetaKeys.map((key: number) =>
    Promise.all([
      promiseMe(assets.delete(key)),
      promiseMe(metas.delete(key))
    ])
  ))
}

export const savePackage = async (packageObj: Omit<PackageMeta, 'packageId'>): Promise<number> => {
  return dbOperation<number>(packageStoreName, store => store.put(packageObj))
}

export const getPackageBySourceId = async (sourceId: SourceId): Promise<PackageMeta | null> => {
  const db = await open()
  const transaction = db.transaction([packageStoreName], 'readonly')
  const packageStore = transaction.objectStore(packageStoreName)
  const index = packageStore.index(packageSourceIdIndex)

  const packageData = await promiseMe<PackageMeta>(index.get(sourceId))
  return packageData || null
}

export const getPackage = async (packageId: number): Promise<PackageMeta | null> => {
  try {
    const packageData = await dbOperation<PackageMeta>(packageStoreName, store => store.get(packageId))
    return packageData || null
  } catch {
    return null
  }
}

export const getAllPackages = async (): Promise<PackageMeta[]> => {
  const db = await open()
  const transaction = db.transaction([packageStoreName], 'readonly')
  const packageStore = transaction.objectStore(packageStoreName)
  
  const allKeys = await promiseMe<number[]>(packageStore.getAllKeys())
  
  return Promise.all(allKeys.map(async key => {
    const packageObj = await promiseMe<Omit<PackageMeta, 'packageId'>>(packageStore.get(key))
    return {
      ...packageObj,
      packageId: key
    }
  }))
}

export const removePackage = async (packageId: number): Promise<void> => {
  const db = await open()
  const transaction = db.transaction([packageStoreName, metaStoreName, assetStoreName], 'readwrite')
  const packageStore = transaction.objectStore(packageStoreName)
  const metaStore = transaction.objectStore(metaStoreName)
  const assetStore = transaction.objectStore(assetStoreName)

  // Find all assets with this packageId
  const allKeys = await promiseMe<number[]>(metaStore.getAllKeys())
  const assetsToDelete = []
  
  for (const key of allKeys) {
    const metaObj = await promiseMe<DbAssetMeta>(metaStore.get(key))
    if (metaObj.packageId === packageId) {
      assetsToDelete.push(key)
    }
  }

  // Delete the package and all its assets
  await Promise.all([
    promiseMe(packageStore.delete(packageId)),
    ...assetsToDelete.map(assetId => 
      Promise.all([
        promiseMe(metaStore.delete(assetId)),
        promiseMe(assetStore.delete(assetId))
      ])
    )
  ])
}

