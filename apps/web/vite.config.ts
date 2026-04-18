import { defineConfig } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { WEB_PORT } from './vite.port.mjs'

export { WEB_PORT }

export default defineConfig({
  envDir: '../../',
  server: {
    port: WEB_PORT,
  },
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    viteReact(),
    tailwindcss(),
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
  ],
})
