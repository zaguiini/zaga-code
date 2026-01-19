import { resolve } from 'node:path'
import { env } from '../env'

export const DB_PATH = resolve(import.meta.dirname, `../../../${env.DB_NAME}.db`)
