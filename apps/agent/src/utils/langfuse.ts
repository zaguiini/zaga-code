import { Langfuse } from 'langfuse'
import { CallbackHandler } from 'langfuse-langchain'
import { env } from '@/env'

function isConfigured(): boolean {
  return !!(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY && env.LANGFUSE_BASE_URL)
}

let langfuseInstance: Langfuse | undefined
let langfuseInitialized = false

export function getLangfuse(): Langfuse | undefined {
  if (!langfuseInitialized) {
    langfuseInitialized = true
    if (isConfigured()) {
      langfuseInstance = new Langfuse({
        publicKey: env.LANGFUSE_PUBLIC_KEY!,
        secretKey: env.LANGFUSE_SECRET_KEY!,
        baseUrl: env.LANGFUSE_BASE_URL!,
      })
      process.on('beforeExit', async () => {
        await langfuseInstance!.flushAsync()
      })
    }
  }
  return langfuseInstance
}

export function createCallbackHandler(sessionId: string | undefined): CallbackHandler | undefined {
  if (!isConfigured()) return undefined

  return new CallbackHandler({
    publicKey: env.LANGFUSE_PUBLIC_KEY!,
    secretKey: env.LANGFUSE_SECRET_KEY!,
    baseUrl: env.LANGFUSE_BASE_URL!,
    ...(sessionId !== undefined && { sessionId }),
  })
}
