import { createTRPCReact } from '@trpc/react-query'
import { httpBatchStreamLink, httpSubscriptionLink, splitLink } from '@trpc/client'
import superjson from 'superjson'
import type { AppRouter } from '@zaga/agent/server/router'
import { env } from '@/env'

export const trpc = createTRPCReact<AppRouter>()

export type AgentState = Awaited<ReturnType<AppRouter['threads']['get']>>

export type StreamEvent =
  Awaited<ReturnType<AppRouter['runs']['stream']>> extends AsyncIterable<infer T> ? T : never

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.type === 'subscription',
      true: httpSubscriptionLink({ url: env.VITE_AGENT_API_URL, transformer: superjson }),
      false: httpBatchStreamLink({ url: env.VITE_AGENT_API_URL, transformer: superjson }),
    }),
  ],
})
