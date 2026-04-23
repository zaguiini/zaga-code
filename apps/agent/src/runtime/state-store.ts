import { defaultRuntimeState } from './state'
import type { RuntimeState } from './state'
import { db } from '@/db'

type StateRow = {
  state_json: string
}

export function ensureThreadState(threadId: string, projectPath: string): RuntimeState {
  db.prepare('INSERT OR IGNORE INTO thread_state (thread_id, state_json) VALUES (?, ?)').run(
    threadId,
    JSON.stringify({ ...defaultRuntimeState, projectPath })
  )

  const existing = getThreadState(threadId)
  if (existing.projectPath) return existing

  const updated = { ...existing, projectPath }
  setThreadState(threadId, updated)
  return updated
}

export function getThreadState(threadId: string): RuntimeState {
  const row = db
    .prepare('SELECT state_json FROM thread_state WHERE thread_id = ?')
    .get(threadId) as StateRow | undefined

  if (!row) return { ...defaultRuntimeState }

  try {
    const parsed = JSON.parse(row.state_json) as Partial<RuntimeState>
    return { ...defaultRuntimeState, ...parsed }
  } catch {
    return { ...defaultRuntimeState }
  }
}

export function setThreadState(threadId: string, state: RuntimeState): void {
  db.prepare(
    'INSERT INTO thread_state (thread_id, state_json) VALUES (?, ?) ON CONFLICT(thread_id) DO UPDATE SET state_json = excluded.state_json'
  ).run(threadId, JSON.stringify(state))
}

export function patchThreadState(threadId: string, patch: Partial<RuntimeState>): RuntimeState {
  const next = { ...getThreadState(threadId), ...patch }
  setThreadState(threadId, next)
  return next
}
