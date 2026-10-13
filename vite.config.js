import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import svgLoader from 'vite-svg-loader'

const root = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    svgLoader(),
    {
      name: 'copy-quake-game-data',
      closeBundle() {
        const source = path.join(root, 'id1', 'pak0.pak')
        const destinationDir = path.join(root, 'dist', 'app', 'id1')
        const destination = path.join(destinationDir, 'pak0.pak')

        if (!fs.existsSync(source)) {
          console.warn('Quake pak0.pak not found in id1/pak0.pak')
          return
        }

        fs.mkdirSync(destinationDir, { recursive: true })
        fs.copyFileSync(source, destination)
        console.log('Copied pak0.pak to dist/app/id1/')
      }
    }
  ],

  resolve: {
    alias: {
      '@': path.resolve(root, './src'),
    },
  },

  build: {
    outDir: 'dist/app',
    sourcemap: true,
    commonjsOptions: { include: [/source-map-js/] },
  },

  preview: {
    port: 8081,
    proxy: {
      '/api/room': 'http://localhost:3000',
      '/api': 'https://www.netquake.io'
    }
  },

  server: {
    port: 8081,
    host: '0.0.0.0',
    proxy: {
      '/api/room': 'http://localhost:3000',
      '/api/player': 'http://localhost:3000',
      '/api': 'https://www.netquake.io',
      '/mapthumbs': 'https://servers.quakeone.com',
      '^/fallback/.*': {
        target: 'http://jsonplaceholder.typicode.com',
        changeOrigin: true,
        rewrite: (url) => url.replace(/^\/fallback\//, '')
      },
    }
  }
})