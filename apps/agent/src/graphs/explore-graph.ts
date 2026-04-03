// apps/api/src/graphs/explore-graph.ts
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration specialist. Your job is to gather information — not to implement anything.

READ-ONLY MODE: You only have access to file search, file read, and grep tools. Do not attempt to create, edit, or delete files.

When you have gathered enough information, stop calling tools and write a structured summary:
- Relevant files and their purposes
- Existing patterns to follow
- Potential gotchas or constraints
- Suggested approach (high level only)

Be thorough. The plan node will use your summary to produce an implementation plan.`

export function createExploreGraph(
  model: BaseChatModel,
  readOnlyTools: Array<StructuredToolInterface>
) {
  const modelWithTools = model.bindTools!(readOnlyTools)
  const toolNode = new ToolNode(readOnlyTools)

  async function exploreExecutor(state: typeof MessagesAnnotation.State) {
    // When invoked as a subgraph node, we receive the parent's full messages.
    // Extract just the last human message + any explore-phase messages for context.
    // Find the last human message and use it as the starting point
    const lastHuman = [...state.messages].reverse().find(m => m.type === 'human')
    const lastHumanIdx = lastHuman ? state.messages.lastIndexOf(lastHuman) : -1
    // Include the last human message + any subsequent explore-phase messages
    const relevantMessages =
      lastHumanIdx >= 0
        ? state.messages
            .slice(lastHumanIdx)
            .filter(
              (m: { type: string; additional_kwargs?: Record<string, unknown> }) =>
                m.type === 'human' || m.additional_kwargs?.phase === 'explore' || m.type === 'tool'
            )
        : state.messages

    const messages = [new SystemMessage(EXPLORE_SYSTEM_PROMPT), ...relevantMessages]

    const response = await modelWithTools.invoke(messages)
    response.additional_kwargs = { ...response.additional_kwargs, phase: 'explore' }
    return { messages: [response] }
  }

  return new StateGraph(MessagesAnnotation)
    .addNode('executor', exploreExecutor)
    .addNode('tools', toolNode)
    .addEdge(START, 'executor')
    .addConditionalEdges('executor', toolsCondition, {
      tools: 'tools',
      __end__: END,
    })
    .addEdge('tools', 'executor')
    .compile()
}
