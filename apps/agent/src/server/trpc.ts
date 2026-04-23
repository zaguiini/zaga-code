import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { AgentRuntime } from '@/runtime/agent-runtime'
import type { SerializedStreamEventV2 } from '@/runtime/events'
import type { RuntimeMessage } from '@/runtime/state'

export type Context = {
  runtime: AgentRuntime<SerializedStreamEventV2, { messages: Array<RuntimeMessage> }>
}

const t = initTRPC.context<Context>().create({ transformer: superjson })

export const router = t.router
export const procedure = t.procedure
