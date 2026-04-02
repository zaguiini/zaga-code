import { resolve } from 'node:path'
import { defineConfig } from 'tsup'
import type { Plugin } from 'esbuild'

const agentSrc = resolve(import.meta.dirname, '../agent/src')

/**
 * Resolves @/ path aliases based on which package the import originates from.
 * Imports from apps/agent/ resolve @/ relative to apps/agent/src/.
 */
const resolveAgentAliases: Plugin = {
  name: 'resolve-agent-aliases',
  setup(build) {
    build.onResolve({ filter: /^@\// }, args => {
      if (args.importer.includes('/apps/agent/')) {
        const relative = args.path.replace(/^@\//, './')
        return build.resolve(relative, {
          resolveDir: agentSrc,
          kind: args.kind,
        })
      }
      return null
    })
  },
}

export default defineConfig({
  entry: ['src/index.tsx'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Bundle everything including npm deps.
  noExternal: [/.*/],
  esbuildPlugins: [resolveAgentAliases],
  esbuildOptions(options) {
    // Native addons and optional deps that can't be bundled.
    // Set at esbuild level so resolution is skipped entirely.
    options.external = [...(options.external ?? []), 'better-sqlite3', 'react-devtools-core']
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
})
