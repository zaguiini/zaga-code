import { initTRPC } from '@trpc/server'
import type { CompiledStateGraph } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'

export type Context = {
  graph: CompiledStateGraph<AgentState, Partial<AgentState>, '__start__'>
}

const t = initTRPC.context<Context>().create()

export const router = t.router
export const procedure = t.procedure
