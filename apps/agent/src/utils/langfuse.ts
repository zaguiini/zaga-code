import { Langfuse } from 'langfuse'
import { CallbackHandler } from 'langfuse-langchain'

function isConfigured(): boolean {
  return !!(
    process.env.LANGFUSE_PUBLIC_KEY &&
    process.env.LANGFUSE_SECRET_KEY &&
    process.env.LANGFUSE_BASE_URL
  )
}

let langfuseInstance: Langfuse | undefined
let langfuseInitialized = false

export function getLangfuse(): Langfuse | undefined {
  if (!langfuseInitialized) {
    langfuseInitialized = true
    if (isConfigured()) {
      langfuseInstance = new Langfuse({
        publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
        secretKey: process.env.LANGFUSE_SECRET_KEY!,
        baseUrl: process.env.LANGFUSE_BASE_URL!,
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
    publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
    secretKey: process.env.LANGFUSE_SECRET_KEY!,
    baseUrl: process.env.LANGFUSE_BASE_URL!,
    ...(sessionId !== undefined && { sessionId }),
  })
}
