import { drizzle } from 'drizzle-orm/better-sqlite3'
import { desc, eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import { conversationsTable } from '@/db/schema'
import { DB_PATH } from '@/db/constants'

export const getUserConversations = async () => {
  const sqlite = new Database(DB_PATH)
  const db = drizzle({ client: sqlite })

  const conversations = await db
    .select()
    .from(conversationsTable)
    .orderBy(desc(conversationsTable.createdAt))

  return conversations
}

export const getConversation = async ({ conversationId }: { conversationId: string }) => {
  const sqlite = new Database(DB_PATH)
  const db = drizzle({ client: sqlite })

  const conversation = await db
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))
    .limit(1)

  return conversation[0]
}
