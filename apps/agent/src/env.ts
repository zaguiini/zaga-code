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

type Env = z.infer<typeof envSchema>

let cached: Env | null = null

/** Lazily parsed on first access so .env files can be loaded before validation runs. */
export const env: Env = new Proxy({} as Env, {
  get(_, prop: string) {
    if (!cached) cached = envSchema.parse(process.env)
    return cached[prop as keyof Env]
  },
})
