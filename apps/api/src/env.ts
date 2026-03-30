import z from 'zod'

const envSchema = z.object({
  REASONING_MODEL: z.string(),
  CODING_MODEL: z.string(),
  LM_STUDIO_API_URL: z.url(),
  SUMMARIZATION_MODEL: z.string(),
  LANGGRAPH_API_URL: z.url(),
  DATABASE_URL: z.url(),
})

export const env = envSchema.parse(process.env)
