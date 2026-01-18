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

export const projectEmbeddingsTable = table('project_embeddings', {
  id: t.text('id').primaryKey(),
  projectPath: t.text('project_path').notNull(),
  file: t.text('file').notNull(),
  filePath: t.text('file_path').notNull(),
  content: t.text('content').notNull(),
  chunkIndex: t.integer('chunk_index').notNull(),
  vecRowid: t.integer('vec_rowid').notNull(), // Links to vec0 table rowid
  embedding: t.blob('embedding').notNull(), // Stored as blob for sqlite-vec
  createdAt: t.integer('created_at').notNull(),
})

export type Conversation = typeof conversationsTable.$inferSelect
export type ProjectEmbedding = typeof projectEmbeddingsTable.$inferSelect
