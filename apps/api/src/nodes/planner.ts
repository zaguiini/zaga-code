import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AgentState } from '@/graphs/agent'

const DEPTH_INSTRUCTIONS: Record<'brief' | 'detailed' | 'decomposed', string> = {
  brief: `Create a brief 2-3 step plan. Identify which files need to be read and what needs to be answered. Keep it concise.`,
  detailed: `Create a detailed numbered plan. List: files to inspect first, specific changes to make, and the order of operations. Include any dependencies between steps.`,
  decomposed: `Break this into sub-tasks with dependencies. For each sub-task: what it does, which files it touches, and what must be completed before it can start. Number the sub-tasks and mark dependencies explicitly.`,
}

const PLANNER_SYSTEM_PROMPT = (depth: 'brief' | 'detailed' | 'decomposed') =>
  `You are a planning assistant for a coding agent. Create a clear, actionable plan that a coding agent will follow to complete the task.

${DEPTH_INSTRUCTIONS[depth]}

Output ONLY the plan as markdown. No preamble, no explanation. The plan will be injected into the coding agent's context.`

export function createPlannerNode(model: {
  invoke: (messages: unknown) => Promise<{ content: unknown }>
}) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const { messages, planningDepth = 'detailed' } = state

    const latestHumanMessage = [...messages]
      .reverse()
      .find(m => m.getType() === 'human' || (m as any)._getType?.() === 'human')

    if (!latestHumanMessage) {
      return { plan: null }
    }

    try {
      const userContent =
        typeof latestHumanMessage.content === 'string'
          ? latestHumanMessage.content
          : JSON.stringify(latestHumanMessage.content)

      const response = await model.invoke([
        new SystemMessage(PLANNER_SYSTEM_PROMPT(planningDepth)),
        new HumanMessage(userContent),
      ])

      const plan = typeof response.content === 'string' ? response.content.trim() : null
      return { plan: plan || null }
    } catch {
      return { plan: null }
    }
  }
}
