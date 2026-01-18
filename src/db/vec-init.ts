import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { DB_PATH } from './constants'

/**
 * Gets a database connection with sqlite-vec loaded
 */
export function getVecDatabase(): Database.Database {
  const db = new Database(DB_PATH)
  sqliteVec.load(db)
  return db
}

export function getVecDatabaseName(projectPath: string) {
  const pathHash = Buffer.from(projectPath)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .substring(0, 50)
  return `vec_project_${pathHash}`
}

/**
 * Initializes the vector table for project embeddings
 * This creates a virtual table using sqlite-vec's vec0
 */
export function initVectorTable(db: Database.Database, projectPath: string) {
  // Create a safe table name from project path (replace slashes and special chars)
  // Use a hash of the path to avoid table name length issues
  const tableName = getVecDatabaseName(projectPath)

  // Drop existing table if it exists
  db.exec(`DROP TABLE IF EXISTS ${tableName}`)

  // Create vec0 virtual table for vector search with cosine distance
  // vec0 creates a table with columns: rowid, distance, vec
  // We'll store our metadata in project_embeddings and use rowid to link them
  // Note: vec0 automatically creates rowid, we'll use it to link with project_embeddings
  // Using cosine distance for semantic similarity
  // nomic-embed-text produces 768-dimensional vectors
  db.exec(`
    CREATE VIRTUAL TABLE ${tableName} USING vec0(
      embedding float32[768] distance_metric=cosine
    )
  `)

  // Create index for faster lookups
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_embeddings_project_path 
    ON project_embeddings(project_path)
  `)

  // Create index linking vec0 rowid to project_embeddings
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_embeddings_vec_rowid 
    ON project_embeddings(vec_rowid)
  `)

  return tableName
}
