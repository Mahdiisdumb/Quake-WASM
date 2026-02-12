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

const keepItToId1 = ['config.cfg', 'autoexec.cfg']
const remoteIndexes: Record<string, {fileName: string}[]> = {}

type ProgressCallback = (current: number, total: number) => void
const checkRemoteFileList = async function (game: string, fileName: string) : Promise<boolean> {
  if (!remoteIndexes[game]) {
    try {
      remoteIndexes[game] = (await axios.get('/api/assets/' + game)).data
    } catch (err) {
      sys.print('Error getting asset index from server: '+ err.message + '\n')
      remoteIndexes[game] = []
    }
  }
  return remoteIndexes[game].some(f => f.fileName === fileName)
}

function getBinarySize (url: string): Promise<number> {
  com.state.inAsync = com.getStack()
  return new Promise((resolve, reject) => {
    var xhr = new XMLHttpRequest();
    xhr.open("HEAD", url, true); // Notice "HEAD" instead of "GET",
                                 //  to get only the header
    xhr.onreadystatechange = function() {

      com.state.inAsync = ''
      if (this.readyState == this.DONE) {
        return xhr.status === 200 
          ? resolve(+xhr.getResponseHeader("Content-Length"))
          : reject(xhr.status)
      }
    };
    xhr.onerror = reject
    xhr.send();
  })
}

const getFileWithProgress = (url: string, progress: ProgressCallback) : Promise<any> => {
  return getBinarySize(url)
    .then((total: number) => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.overrideMimeType('text\/plain; charset=x-user-defined')
        xhr.open('GET', url)
        xhr.onload = () => {
          return xhr.status === 200 
            ? resolve(q.strmem(xhr.responseText))
            : reject(xhr.status)
          
        }
        xhr.onerror = (e) => reject(e) 
        xhr.addEventListener('progress', e => {
          progress(e.loaded, total)
        });
        xhr.send()
      })
    })
}

const getFile = async function(file: string) {
  com.state.inAsync = com.getStack()
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.overrideMimeType('text\/plain; charset=x-user-defined');
    xhr.open('GET', file);
    xhr.onload = () => {
      com.state.inAsync = ''
      resolve({
        status: xhr.status,
        responseText: xhr.responseText
      });
    }
    xhr.onerror = (e) => reject(e) 
    xhr.send();
  });
};

export const openFile = (filename: string, mode: FileMode) => {
  return Promise.resolve(true)
}
export const readFile = (filename: string) => {
	throw new Error('Not Implemented')
}
export const writeFile = (filename: string, data: Uint8Array, len: number) =>
{
  filename = filename.toLowerCase();
  var dest: string[] = [], i;
  for (i = 0; i < len; ++i)
    dest[i] = String.fromCharCode(data[i]);
  try
  {
    localStorage.setItem('Quake.' + com.state.searchpaths[com.state.searchpaths.length - 1].dir + '/' + filename, dest.join(''));
  }
  catch (e)
  {
    sys.print('COM.WriteFile: failed on ' + filename + '\n');
    Promise.resolve(false);
  }
  sys.print('COM.WriteFile: ' + filename + '\n');
  return Promise.resolve(true);
};

export const writeTextFile = (filename: string, data: string) =>
{
  filename = filename.toLowerCase();
  const dir = keepItToId1.indexOf(filename) > -1 
    ? 'id1' 
    : com.state.searchpaths[com.state.searchpaths.length - 1].dir

  try
  {
    localStorage.setItem('Quake.' + dir + '/' + filename, data);
  }
  catch (e)
  {
    sys.print('COM.WriteTextFile: failed on ' + filename + '\n');
    Promise.resolve(false);
  }
  sys.print('COM.WriteTextFile: ' + filename + '\n');
  return Promise.resolve(true);
};

const getLocalStorage = (game: string, filename: string) => {
  const path = game + '/' + filename;
  const data = localStorage.getItem('Quake.' + path);
  if (data != null)
  {
    sys.print('FindFile: ' + path + '\n');
    return q.strmem(data);
  }
  return null
}
const _loadFile = async (filename: string) : Promise<ArrayBuffer | null> => {
  filename = filename.toLowerCase();
  var i, j, search: SearchPath;
  
  for (i = com.state.searchpaths.length - 1; i >= 0; --i)
  {
    search = com.state.searchpaths[i];
    if (keepItToId1.indexOf(filename) > -1 && search.dir !== 'id1') {
      continue
    }

    const data = getLocalStorage(search.dir, filename)
    if (data) {
      return data
    }

    for (j = 0; j < search.packs.length; j++) {
      const pack = search.packs[j]
      if (pack.type === 'indexeddb' && pack.data) {
        const file = pack.contents.find(p => p.name === filename)
        if (!file) {
          continue
        }
  
        return pack.data.slice(file.filepos, file.filepos + file.filelen);							
      }
    }

    // try indexedDb.
    const tryIndexedDb = await indexeddb.getAsset(search.dir, filename)
    if (tryIndexedDb) {
      return tryIndexedDb.data
    }
    const netpath = search.dir + '/' + filename;

    // Problem is - if there's a  "game" search path, 
    // we end up searching the server
    // for ALL id1 assets. IS this necessary?
    // It's "only" necessary if the server is serving mods.
    // Ok HOw can we tell?
    // I donno...
    // 
    // Joe - I think I figured it out - just ask the server for a file list..
    if (await checkRemoteFileList(search.dir, netpath)) {
      const gotFile = await getFile('/' + netpath) as any;
      if ((gotFile.status >= 200) && (gotFile.status <= 299))
      {
        sys.print('FindFile: ' + netpath + '\n');
        return q.strmem(gotFile.responseText);
      }
    }
  }

  // As a workaround to the above, lets only search the server if we can't
  // find it in known packs
  // @ts-ignore - VITE_ALLOW_SERVER_DOWNLOADS is a vite env variable
  if (import.meta.env.VITE_ALLOW_SERVER_DOWNLOADS) {
    for (i = com.state.searchpaths.length - 1; i >= 0; --i) {
      search = com.state.searchpaths[i];
      const netpath = "/" + search.dir + '/' + filename;
      const gotFile = await getFile(netpath) as any;
      if ((gotFile.status >= 200) && (gotFile.status <= 299))
      {
        sys.print('FindFile: ' + netpath + '\n');
        return q.strmem(gotFile.responseText);
      }
    }
  }

  sys.print('FindFile: can\'t find ' + filename + '\n');
  return null
};

export const loadFile = async (filename: string) : Promise<ArrayBuffer | null> => {
  draw.beginDisc(filename);

  const data = await _loadFile(filename)
  draw.endDisc();
  return data
}

const getPackFileContents = (game: string, name: string, data: ArrayBuffer): PackedFile[] => {
  var header = new DataView(data);
  if (header.getUint32(0, true) !== 0x4b434150)
    sys.error(game + ':'+ name + ' from indexedDb is not a packfile');
  var dirofs = header.getUint32(4, true);
  var dirlen = header.getUint32(8, true);
  var numpackfiles = dirlen >> 6;
  if (numpackfiles !== 339)
    com.state.modified = true;
  var pack:PackedFile[] = [];
  if (numpackfiles !== 0)
  {
    var info = new DataView(data, dirofs, dirlen);
    if (crc.block(new Uint8Array(data, dirofs, dirlen)) !== 32981)
      com.state.modified = true;
    var i;
    for (i = 0; i < numpackfiles; ++i)
    {
      pack.push({
        name: q.memstr(new Uint8Array(data, dirofs +  (i << 6), 56)).toLowerCase(),
        filepos: info.getUint32((i << 6) + 56, true),
        filelen: info.getUint32((i << 6) + 60, true)
      });
    }

    con.print('Added packfile ' + name + ' (' + numpackfiles + ' files)\n');
  }
  return pack;
}

const loadStorePackFile = async (game: string, packName: string): Promise<PakData | null> => {
  let entry
  try {
    entry = await indexeddb.getAsset(game, packName)

    if (!entry) {
      return null
    }
  } catch{
    return null
  }

  return {
    name: entry.fileName,
    data: entry.data,
    type: 'indexeddb',
    contents: getPackFileContents(game, entry.fileName, entry.data)
  }
}

const loadServerPackFile = async (game: string, packName: string) : Promise<PakData | null> => {
  const packfile = game + '/' + packName

  try {
    if (!await checkRemoteFileList(game, packfile)) {
      return null
    }
    const data = await getFileWithProgress('/' + packfile, (current, total) => {
      // TODO UI Progress
    })
    if (!data) {
      return null
    }
    var dataDv = new DataView(data);
    if (dataDv.getUint32(0, true) !== 0x4b434150){
      con.print(packfile + ' is not a packfile');
      return null
    }
    var dirlen = dataDv.getUint32(8, true);
    var numpackfiles = dirlen >> 6;
    if (numpackfiles !== 339)
      com.state.modified = true;

    await indexeddb.saveAsset(game, packName, numpackfiles, data, null)

    return {
      name: packName,
      data,
      type: 'indexeddb',
      contents: getPackFileContents(game, packName, data)!
    }
  } catch{
    return null
  }
}

export const loadPackFile = async (dir: string, packName: string) : Promise<PakData | null> => {
  let entry: PakData | null = await loadStorePackFile(dir, packName)
  if (!entry) {
    entry = await loadServerPackFile(dir, packName)
  }

  return entry
}