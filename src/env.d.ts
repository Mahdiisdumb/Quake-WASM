/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ALLOW_SERVER_DOWNLOADS: boolean
  readonly VITE_THUMBNAILS_PATH: string
  readonly VITE_ROOM_SERVER_URL: string
  readonly VITE_ROOM_SERVER_SOCKET_URL: string
  // more env variables...
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}