import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import Database from 'better-sqlite3'

const dbDir = join(homedir(), '.zaga')
mkdirSync(dbDir, { recursive: true })

export const dbPath = join(dbDir, 'history.db')

export const db: InstanceType<typeof Database> = new Database(dbPath)

db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS threads (
    thread_id     TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  )
`)

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    run_id    TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'running'
  )
`)

// Mark any runs that were still 'running' when the server last stopped as failed
db.prepare("UPDATE runs SET status = 'failed' WHERE status = 'running'").run()
