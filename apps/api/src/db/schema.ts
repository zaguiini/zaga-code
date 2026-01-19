import { index, pgTable, serial, vector } from 'drizzle-orm/pg-core'
import * as t from 'drizzle-orm/pg-core'

export const projectEmbeddingsTable = pgTable(
  'project_embeddings',
  {
    id: serial('id').primaryKey(),
    projectPath: t.text('project_path').notNull(),
    file: t.text('file').notNull(),
    filePath: t.text('file_path').notNull(),
    content: t.text('content').notNull(),
    chunkIndex: t.integer('chunk_index').notNull(),
    embedding: vector('embedding', { dimensions: 768 }).notNull(), // pgvector column
    createdAt: t.timestamp('created_at', { mode: 'date' }).notNull(),
  },
  table => [index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops'))]
)

export type ProjectEmbedding = typeof projectEmbeddingsTable.$inferSelect
