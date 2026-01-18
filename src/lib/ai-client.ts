import { Client } from '@langchain/langgraph-sdk'

export const client = new Client({
  apiUrl: 'http://localhost:2024',
})
