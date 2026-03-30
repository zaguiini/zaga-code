import { z } from 'zod'
import type { AgentState } from '@/graphs/agent'

const routerOutputSchema = z.object({
  complexity: z.enum(['simple', 'medium', 'complex']),
  planningDepth: z.enum(['brief', 'detailed', 'decomposed']),
})

const ROUTER_SYSTEM_PROMPT = `You are a task classifier for a coding assistant. Given a user's coding request, classify its complexity and determine the appropriate planning depth.

Complexity levels:
- simple: explain code, answer questions, read and summarize files (most tasks)
- medium: debug issues, make targeted changes to one or a few related files
- complex: implement new features, refactor across multiple files, architectural changes

Planning depth mirrors complexity:
- brief (for simple): 2-3 steps — which files to read, what to answer
- detailed (for medium): numbered steps — files to inspect, changes to make, order of operations
- decomposed (for complex): sub-tasks with dependencies spelled out

Return only the classification. Do not explain.`

export function createRouterNode(model: {
  withStructuredOutput: (schema: unknown) => { invoke: (messages: unknown) => Promise<unknown> }
}) {
  const structuredRouter = model.withStructuredOutput(routerOutputSchema)

  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const firstHumanMessage = state.messages.find(
      m => m.getType() === 'human' || (m as any)._getType?.() === 'human'
    )

    if (!firstHumanMessage) {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }

    try {
      const userContent =
        typeof firstHumanMessage.content === 'string'
          ? firstHumanMessage.content
          : JSON.stringify(firstHumanMessage.content)

      const result = await structuredRouter.invoke([
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ])

      return result as {
        complexity: 'simple' | 'medium' | 'complex'
        planningDepth: 'brief' | 'detailed' | 'decomposed'
      }
    } catch {
      return { complexity: 'medium', planningDepth: 'detailed' }
    }
  }
}
