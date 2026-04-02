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
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Only inline the agent workspace package; everything else stays external
  // and is resolved from node_modules at runtime (avoids CJS-in-ESM issues).
  noExternal: ['@zaga/agent'],
  external: [/^(?!@zaga\/agent|@\/|\.)/],
  esbuildPlugins: [resolveAgentAliases],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
