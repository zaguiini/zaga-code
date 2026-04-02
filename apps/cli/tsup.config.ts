import { builtinModules } from 'node:module'
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

// Both bare ('assert') and prefixed ('node:assert') forms
const nodeBuiltins = builtinModules.flatMap(m => [m, `node:${m}`])

export default defineConfig({
  entry: ['src/index.tsx'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  // Bundle everything including npm deps.
  noExternal: [/.*/],
  esbuildPlugins: [
    resolveAgentAliases,
    {
      name: 'stub-optional-deps',
      setup(build) {
        build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
          path: 'react-devtools-core',
          namespace: 'stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: 'export default undefined',
        }))
      },
    },
  ],
  esbuildOptions(options) {
    // Node builtins and native addons must stay external.
    options.external = [...(options.external ?? []), ...nodeBuiltins, 'better-sqlite3']
  },
  splitting: false,
  banner: {
    js: [
      '#!/usr/bin/env node',
      'import { createRequire as __createRequire } from "node:module";',
      'const require = __createRequire(import.meta.url);',
    ].join('\n'),
  },
})
