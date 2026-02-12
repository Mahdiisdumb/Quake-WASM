import originalMaps from './maps/original'
import hipnotic from './maps/hipnotic'
import rogue from './maps/rogue'
import { SourceId } from '../../../shared/types/Source'

export type MapName = string
export type GameDir = 'id1' | 'hipnotic' | 'rogue' | string

export type Mod = 'dm' | 'ctf'
export type MultiplayerMap = {
  name: MapName,
  title: string,
  played: 'regularly' | 'occasionally' | 'rarely'
  size: 'small' | 'medium' | 'large'
  mod: Mod
}

export type GameMap = {
  name: string,
  title: string,
  collection: string
}

export const officialGame = {
  Original: 'original',
  Hipnotic: 'hipnotic',
  Rogue: 'rogue',
}

export type OfficialGame = typeof officialGame

export type GameDefinition = {
  game: OfficialGame[keyof OfficialGame],
  name: MapName,
  type: 'official' | 'quaddicted' | 'custom'
  mapList: GameMap[]
}


export const officialGameDefinitions: GameDefinition[] = [{
  game: officialGame.Original,
  name: 'Quake',
  mapList: originalMaps,
  type: 'official'
}, {
  game: officialGame.Hipnotic,
  name: 'Mission Pack 1: Scourge of Armagon',
  mapList: hipnotic,
  type: 'official'
}, {
  game: officialGame.Rogue,
  name: 'Mission Pack 2: Dissolution of Eternity',
  mapList: rogue,
  type: 'official'
}]

export const parseSourceId = (sourceId: SourceId) => {
  const [type, id] = sourceId.split(':')
  return {type, id} as {type: SourceId extends `${infer T}:${string}` ? T : never, id: string}
}