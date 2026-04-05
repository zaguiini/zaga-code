import { defineConfig } from 'vite'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  envDir: '../../',
  plugins: [
    viteReact(),
    TanStackRouterVite({ autoCodeSplitting: true }),
    tailwindcss(),
    viteTsConfigPaths({ projects: ['./tsconfig.json'] }),
  ],
})
