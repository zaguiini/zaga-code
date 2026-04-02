import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSession } from '../session'

describe('createSession', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'zaga-test-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true })
  })

  it('creates a new session with a UUID when none exists', async () => {
    const session = await createSession(tempDir)
    expect(session.threadId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    )
  })

  it('persists the thread ID to .zaga/session', async () => {
    const session = await createSession(tempDir)
    const stored = (await readFile(join(tempDir, '.zaga', 'session'), 'utf-8')).trim()
    expect(stored).toBe(session.threadId)
  })

  it('reuses an existing session', async () => {
    const first = await createSession(tempDir)
    const second = await createSession(tempDir)
    expect(second.threadId).toBe(first.threadId)
  })

  it('updates the thread ID via setThreadId', async () => {
    const session = await createSession(tempDir)
    const newId = crypto.randomUUID()
    await session.setThreadId(newId)
    expect(session.threadId).toBe(newId)
    const stored = (await readFile(join(tempDir, '.zaga', 'session'), 'utf-8')).trim()
    expect(stored).toBe(newId)
  })
})
