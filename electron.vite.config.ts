import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // worker.ts is a second entry so worker_threads can resolve it beside index.js
        input: {
          index: resolve('src/main/index.ts'),
          worker: resolve('src/main/ingest/worker.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve('src/preload/index.ts'),
        // sandbox:true cannot load an ESM preload; .cjs opts out of package type:module
        output: { format: 'cjs', entryFileNames: 'index.cjs' }
      }
    }
  },
  renderer: {
    plugins: [react()]
  }
})
