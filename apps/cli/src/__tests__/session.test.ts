import { describe, expect, it } from 'vitest'
import { createSession } from '../session'

describe('createSession', () => {
  it('creates a new session with a UUID', () => {
    const session = createSession()
    expect(session.threadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('generates unique IDs for each session', () => {
    const first = createSession()
    const second = createSession()
    expect(first.threadId).not.toBe(second.threadId)
  })

  it('updates the thread ID via setThreadId', () => {
    const session = createSession()
    const newId = crypto.randomUUID()
    session.setThreadId(newId)
    expect(session.threadId).toBe(newId)
  })
})
