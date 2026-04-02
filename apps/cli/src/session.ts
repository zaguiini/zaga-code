import { join } from 'node:path'
import { homedir } from 'node:os'

/** Root directory for all zaga data (~/.zaga). */
export function zagaHomeDir(): string {
  return join(homedir(), '.zaga')
}

/** Path to the shared history database (~/.zaga/history.db). */
export function zagaHistoryDbPath(): string {
  return join(zagaHomeDir(), 'history.db')
}

/** Per-session events log (~/.zaga/events-{sessionId}.ndjson). */
export function zagaEventsLogPath(sessionId: string): string {
  return join(zagaHomeDir(), `events-${sessionId}.ndjson`)
}

export type Session = {
  threadId: string
  setThreadId: (id: string) => void
}

export function createSession(): Session {
  let threadId: string = crypto.randomUUID()

  return {
    get threadId() {
      return threadId
    },
    setThreadId(id: string) {
      threadId = id
    },
  }
}
