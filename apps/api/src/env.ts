import z from 'zod'

const envSchema = z.object({
  REASONING_MODEL: z.string(),
  CODING_MODEL: z.string(),
  LM_STUDIO_API_URL: z.url(),
  RAG_MODEL: z.string(),
  SUMMARIZATION_MODEL: z.string(),
  OLLAMA_API_URL: z.url(),
  LANGGRAPH_API_URL: z.url(),
  DATABASE_URL: z.url(),
})

export const env = envSchema.parse(process.env)
