import postgres from 'postgres'
import { env } from '../env'

// Create Postgres connection pool
export const DB_CONNECTION = postgres(env.DATABASE_URL, {
  max: 10, // Maximum number of connections in the pool
  idle_timeout: 20, // Close idle connections after 20 seconds
  connect_timeout: 10, // Connection timeout in seconds
})
