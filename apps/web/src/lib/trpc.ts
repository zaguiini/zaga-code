import { createTRPCReact } from '@trpc/react-query'
import { httpBatchStreamLink, httpSubscriptionLink, splitLink } from '@trpc/client'
import superjson from 'superjson'
import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@zaga/agent/server/router'
import { env } from '@/env'

export const trpc = createTRPCReact<AppRouter>()

type RouterOutputs = inferRouterOutputs<AppRouter>

export type AgentState = RouterOutputs['threads']['get']

// Unwrap TrackedEnvelope<T> → T (the raw LangChain StreamEvent)
type TrackedStreamEvent =
  Awaited<ReturnType<AppRouter['runs']['stream']>> extends AsyncIterable<infer T> ? T : never
export type StreamEvent = TrackedStreamEvent extends { data: infer D } ? D : TrackedStreamEvent

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.type === 'subscription',
      true: httpSubscriptionLink({ url: env.VITE_AGENT_API_URL, transformer: superjson }),
      false: httpBatchStreamLink({ url: env.VITE_AGENT_API_URL, transformer: superjson }),
    }),
  ],
})
