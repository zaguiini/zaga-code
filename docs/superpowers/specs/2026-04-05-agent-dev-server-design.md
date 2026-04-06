# Agent Dev Server Design

**Date:** 2026-04-05

## Goal

Allow running the agent server standalone during development without needing to launch the full Electron desktop app. The server should restart automatically when source files change.

## Changes

### 1. Move port definition to agent (`apps/agent/src/server/index.ts`)

Add `export const AGENT_PORT = 2024` to the agent's server module. This makes the agent the canonical owner of its own port, and lets desktop import it rather than define it independently.

### 2. New dev entrypoint (`apps/agent/src/server/start.ts`)

A thin entrypoint that:

1. Calls `setup({ logLevel: 'verbose' })` — matching the desktop's dev-mode behaviour, including LM Studio model/server setup
2. Calls `startAgentServer(AGENT_PORT)`

`setup` is idempotent (guards against already-downloaded/loaded models and already-running LM Studio server), so re-running it on each tsx --watch restart is acceptable.

### 3. Dev script (`apps/agent/package.json`)

```json
"dev": "tsx --watch src/server/start.ts"
```

`tsx --watch` restarts the process on any `.ts` file change in the project. Console output is fully visible and interactive (`stdio` inherits from parent). Run with `pnpm --filter @zaga/agent dev`.

### 4. Desktop port import (`apps/desktop/src/servers.ts`)

Remove `export const AGENT_PORT = 2024`. Import `AGENT_PORT` from `@zaga/agent/server` instead. No change to how desktop uses the port.

## What is NOT changing

- `apps/desktop/src/main.ts` — still imports and calls `startAgentServer(AGENT_PORT)` in dev mode; no change needed since `AGENT_PORT` remains available via the same `./servers.js` re-export path
- The agent's existing `startAgentServer` signature — port is still a parameter
- Production flow — unaffected
