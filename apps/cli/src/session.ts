import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type Session = {
  threadId: string
  setThreadId: (id: string) => Promise<void>
}

export async function createSession(projectPath: string): Promise<Session> {
  const zagaDir = join(projectPath, '.zaga')
  const sessionFile = join(zagaDir, 'session')
  await mkdir(zagaDir, { recursive: true })

  let threadId: string
  try {
    threadId = (await readFile(sessionFile, 'utf-8')).trim()
  } catch {
    threadId = crypto.randomUUID()
    await writeFile(sessionFile, threadId, 'utf-8')
  }

  return {
    get threadId() {
      return threadId
    },
    async setThreadId(id: string) {
      threadId = id
      await writeFile(sessionFile, id, 'utf-8')
    },
  }
}
