import { Langfuse } from 'langfuse'
import { CallbackHandler } from 'langfuse-langchain'
import { env } from '@/env'

export const langfuse = new Langfuse({
  publicKey: env.LANGFUSE_PUBLIC_KEY,
  secretKey: env.LANGFUSE_SECRET_KEY,
  baseUrl: env.LANGFUSE_BASE_URL,
})

process.on('beforeExit', async () => {
  await langfuse.flushAsync()
})

export function createCallbackHandler(sessionId: string | undefined): CallbackHandler {
  return new CallbackHandler({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASE_URL,
    ...(sessionId !== undefined && { sessionId }),
  })
}
