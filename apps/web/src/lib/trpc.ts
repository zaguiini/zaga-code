import { createTRPCReact } from '@trpc/react-query'
import { httpBatchStreamLink, httpSubscriptionLink, splitLink } from '@trpc/client'
import type { AppRouter } from '@zaga/agent/server/router'
import { env } from '@/env'

export const trpc = createTRPCReact<AppRouter>()

export const trpcClient = trpc.createClient({
  links: [
    splitLink({
      condition: op => op.type === 'subscription',
      true: httpSubscriptionLink({ url: env.VITE_AGENT_API_URL }),
      false: httpBatchStreamLink({ url: env.VITE_AGENT_API_URL }),
    }),
  ],
})
