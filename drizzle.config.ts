import { defineConfig } from 'drizzle-kit'
import { env } from '@/graphs/env'

export default defineConfig({
  schema: './src/graphs/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: `./${env.DB_NAME}.db`,
  },
})
