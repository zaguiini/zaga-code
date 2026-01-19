import { defineConfig } from 'drizzle-kit'
import { env } from '@/env'

export default defineConfig({
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: `${env.DB_NAME}.db`,
  },
})
