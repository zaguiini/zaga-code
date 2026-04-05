import { initTRPC } from '@trpc/server'
import superjson from 'superjson'
import type { createAgent } from '@/graphs/agent'

// Derive the graph type directly from createAgent's return type to avoid
// manual parameterisation of CompiledStateGraph generics
type Graph = Awaited<ReturnType<typeof createAgent>>

export type Context = {
  graph: Graph
}

const t = initTRPC.context<Context>().create({ transformer: superjson })

export const router = t.router
export const procedure = t.procedure
