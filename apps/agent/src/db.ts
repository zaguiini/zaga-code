import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

const dbDir = join(homedir(), '.zaga')
mkdirSync(dbDir, { recursive: true })

export const dbPath = join(dbDir, 'history.db')

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    thread_id    TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    last_message TEXT
  )
`)
