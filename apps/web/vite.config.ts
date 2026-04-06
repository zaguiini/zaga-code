import { defineConfig } from 'vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

export const WEB_PORT = 2025

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
