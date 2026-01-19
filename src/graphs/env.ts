import z from 'zod'

const envSchema = z.object({
  AGENT_MODEL: z.string(),
  RAG_MODEL: z.string(),
  OLLAMA_API_URL: z.url(),
  LANGGRAPH_API_URL: z.url(),
  DB_NAME: z.string(),
})

export const env = envSchema.parse(process.env)
