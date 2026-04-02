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
  fastModel: BaseChatModel,
  readOnlyTools: Array<StructuredToolInterface>
) {
  const modelWithTools = fastModel.bindTools!(readOnlyTools)
  const toolNode = new ToolNode(readOnlyTools)

  async function exploreExecutor(state: typeof MessagesAnnotation.State) {
    const hasSystem = state.messages.some(m => m.type === 'system')
    const messages = hasSystem
      ? state.messages
      : [new SystemMessage(EXPLORE_SYSTEM_PROMPT), ...state.messages]

    const response = await modelWithTools.invoke(messages)
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
