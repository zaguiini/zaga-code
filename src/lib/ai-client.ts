import { Client } from '@langchain/langgraph-sdk'
import { env } from '@/env'

export const client = new Client({
  apiUrl: env.VITE_LANGGRAPH_API_URL,
})
