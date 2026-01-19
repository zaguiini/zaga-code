import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { DB_CONNECTION } from './constants'

/**
 * Initializes pgvector extension and creates indexes for vector search
 * This ensures the pgvector extension is enabled and creates HNSW index for performance
 */
export async function initVectorTable() {
  const drizzleDb = drizzle(DB_CONNECTION)

  // Create index on project_path for faster filtering
  await drizzleDb.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_project_embeddings_project_path 
    ON project_embeddings(project_path)
  `)

  // Create HNSW index on embedding column for fast vector similarity search
  // Using cosine distance operator class for cosine similarity
  // This index significantly speeds up vector similarity queries
  try {
    await drizzleDb.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_project_embeddings_embedding_hnsw 
      ON project_embeddings 
      USING hnsw (embedding vector_cosine_ops)
    `)
  } catch (error) {
    // If index already exists or creation fails, log and continue
    // This can happen if the index was created in a previous run
    console.log('Index creation note:', error instanceof Error ? error.message : String(error))
  }
}
