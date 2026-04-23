import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { AgentRuntime } from '@/runtime/agent-runtime'
import type { SerializedStreamEvent } from '@/runtime/events'
import type { RuntimeMessage } from '@/runtime/state'

export type Context = {
  runtime: AgentRuntime<SerializedStreamEvent, { messages: Array<RuntimeMessage> }>
}

const t = initTRPC.context<Context>().create({ transformer: superjson })

export const router = t.router
export const procedure = t.procedure
