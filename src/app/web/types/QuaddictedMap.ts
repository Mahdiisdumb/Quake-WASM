export type QuaddictedMap = {
  name: string,
  title: string,
  author: string,
  id: string,
  downloadLink: string,
  fileName: string,
  size: number,
  detailLink: string,
  date: Date,
  rating: number,
  userRating: number
  mapList: string[]
  depends: string | null
  requirements: string[]
  gameDir: string
  byteLength: number
}