import { resolve } from 'node:path'

export const DB_PATH = resolve(import.meta.dirname, '../../checkpoints.db')
