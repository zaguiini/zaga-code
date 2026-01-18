import { sqliteTable as table } from 'drizzle-orm/sqlite-core'
import * as t from 'drizzle-orm/sqlite-core'

export const conversationsTable = table('conversations', {
  id: t.text('id').primaryKey(),
  initialPrompt: t.text('initial_prompt').notNull(),
  preview: t.text('preview'),
  projectPath: t.text('project_path').notNull(),
  createdAt: t.integer('created_at').notNull(),
  updatedAt: t.integer('updated_at').notNull(),
})

export type Conversation = typeof conversationsTable.$inferSelect
