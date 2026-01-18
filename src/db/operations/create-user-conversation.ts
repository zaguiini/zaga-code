import { randomUUID } from 'node:crypto'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import type { Conversation } from '@/db/schema'
import { conversationsTable } from '@/db/schema'
import { DB_PATH } from '@/db/constants'

export const createUserConversation = async ({
  projectPath,
  initialPrompt,
}: Pick<
  typeof conversationsTable.$inferInsert,
  'projectPath' | 'initialPrompt'
>): Promise<Conversation> => {
  const sqlite = new Database(DB_PATH)
  const db = drizzle({ client: sqlite })

  const [conversation] = await db
    .insert(conversationsTable)
    .values({
      projectPath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      id: randomUUID(),
      initialPrompt,
    })
    .returning()

  return conversation
}
