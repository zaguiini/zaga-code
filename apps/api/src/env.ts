import z from 'zod'

const envSchema = z.object({
  MODEL_API_BASE_URL: z.url(),
  CODING_MODEL: z.string(),
  FAST_MODEL: z.string(),
  LANGFUSE_PUBLIC_KEY: z.string(),
  LANGFUSE_SECRET_KEY: z.string(),
  LANGFUSE_BASE_URL: z.url(),
})

export const env = envSchema.parse(process.env)
