/**
 * Builds better-sqlite3 for both Node.js and Electron and stores the binaries
 * in build/Release/ with runtime-specific names so they can coexist.
 *
 * The pnpm patch on better-sqlite3 (patches/better-sqlite3@12.8.0.patch) picks
 * the right binary at load time:
 *   build/Release/node.{abi}.better_sqlite3.node     → Node.js
 *   build/Release/electron.{abi}.better_sqlite3.node → Electron
 *
 * Falls back to build/Release/better_sqlite3.node if runtime-specific binary
 * is not found.
 *
 * Run once after install: pnpm setup:native
 */

import { execSync, execFileSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// Resolve packages from the workspaces that depend on them
const requireFromAgent = createRequire(path.join(root, 'apps/agent/package.json'))
const requireFromDesktop = createRequire(path.join(root, 'apps/desktop/package.json'))

const sqlitePkgPath = path.dirname(requireFromAgent.resolve('better-sqlite3/package.json'))
const buildRelease = path.join(sqlitePkgPath, 'build', 'Release')
const buildBinary = path.join(buildRelease, 'better_sqlite3.node')

// Clean up any old prebuilds directory from a previous attempt
const prebuildsDir = path.join(sqlitePkgPath, 'prebuilds')
try {
  rmSync(prebuildsDir, { recursive: true, force: true })
} catch {}

// 1. Save the current Node.js build (compiled by pnpm install)
const nodeAbi = process.versions.modules
const nodeDest = path.join(buildRelease, `node.${nodeAbi}.better_sqlite3.node`)
cpSync(buildBinary, nodeDest)
console.log(`✓ Saved Node.js binary (ABI ${nodeAbi})`)

// 2. Build for Electron
console.log('Building for Electron (this takes a moment)...')
execSync('pnpm exec electron-rebuild -f -w better-sqlite3', {
  stdio: 'inherit',
  cwd: path.join(root, 'apps/desktop'),
})

// 3. Get Electron's ABI using ELECTRON_RUN_AS_NODE mode
const electronBinPath = requireFromDesktop('electron')
const electronAbi = execFileSync(
  electronBinPath,
  ['-e', 'process.stdout.write(process.versions.modules); process.exit(0)'],
  { timeout: 10000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
)
  .toString()
  .trim()

// 4. Save the Electron build
const electronDest = path.join(buildRelease, `electron.${electronAbi}.better_sqlite3.node`)
cpSync(buildBinary, electronDest)
console.log(`✓ Saved Electron binary (ABI ${electronAbi})`)

// 5. Restore Node.js binary to better_sqlite3.node (fallback for other tools)
cpSync(nodeDest, buildBinary)

console.log(`\n✓ Done! Both runtimes can now use better-sqlite3 without conflicts.`)
console.log(`  Node.js  (ABI ${nodeAbi}): ${path.relative(root, nodeDest)}`)
console.log(`  Electron (ABI ${electronAbi}): ${path.relative(root, electronDest)}`)
