import z from 'zod'

const envSchema = z.object({
  MODEL_API_BASE_URL: z.url(),
  CODING_MODEL: z.string(),
  FAST_MODEL: z.string(),
  LANGFUSE_PUBLIC_KEY: z.string().optional(),
  LANGFUSE_SECRET_KEY: z.string().optional(),
  LANGFUSE_BASE_URL: z.url().optional(),
  CODING_MODEL_MAX_TOKENS: z.coerce.number().default(262000),
  FAST_MODEL_MAX_TOKENS: z.coerce.number().default(128000),
})

export const env = envSchema.parse(process.env)
