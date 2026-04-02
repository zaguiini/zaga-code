import { Langfuse } from 'langfuse'
import { CallbackHandler } from 'langfuse-langchain'
import { env } from '@/env'

const isConfigured = !!(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY && env.LANGFUSE_BASE_URL)

export const langfuse = isConfigured
  ? new Langfuse({
      publicKey: env.LANGFUSE_PUBLIC_KEY!,
      secretKey: env.LANGFUSE_SECRET_KEY!,
      baseUrl: env.LANGFUSE_BASE_URL!,
    })
  : undefined

if (langfuse) {
  process.on('beforeExit', async () => {
    await langfuse.flushAsync()
  })
}

export function createCallbackHandler(sessionId: string | undefined): CallbackHandler | undefined {
  if (!isConfigured) return undefined

  return new CallbackHandler({
    publicKey: env.LANGFUSE_PUBLIC_KEY!,
    secretKey: env.LANGFUSE_SECRET_KEY!,
    baseUrl: env.LANGFUSE_BASE_URL!,
    ...(sessionId !== undefined && { sessionId }),
  })
}
