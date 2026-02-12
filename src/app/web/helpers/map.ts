import { SourceId } from "../../../shared/types/Source"

const imagePath = import.meta.env.VITE_THUMBNAILS_PATH
const generic = `${imagePath}/generic.jpg`


export const genericImageUrl = imagePath + '/generic.jpg'
export const getMapImageUrl = (name: string) => imagePath + '/' + name + '.jpg'
export const sharewareMaps = ['start', 'e1m1', 'e1m2', 'e1m3', 'e1m4', 'e1m5', 'e1m6', 'e1m7', 'e1m8']
export const isMap = (name: string) => /^maps\/[^\\\/:*?"<>|]+\.bsp$/.test(name)
export const isPak = (name: string) => /^.+\.pak$/.test(name)

export const getMapGameQueryParams = ({map, sourceId, gameDir}: {map: string, sourceId: SourceId, gameDir?: string}) => {
  
  const query: Record<string, any> = { '+map': map }
  if (sourceId.split(':')[0] === 'official') {
    if (gameDir !== 'original') {
      query['-' +gameDir] = true // Kind of a hack, using gameDir to set mission pack flag.
    }
  } else {
    query['sourceId'] = sourceId
    if (gameDir) {
      query['-game'] = gameDir
    }
  }

  return query
}