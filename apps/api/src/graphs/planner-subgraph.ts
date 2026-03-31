import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const RESEARCH_SYSTEM_PROMPT = `You are researching a codebase to prepare an implementation plan. Use file_search to locate relevant files and file_read to read them. Follow imports, check existing conventions and patterns. When you have enough context to write an accurate plan, stop making tool calls.`

const DEPTH_INSTRUCTIONS: Record<'brief' | 'detailed' | 'decomposed', string> = {
  brief: `Create a brief 2-3 step implementation plan. Focus on what needs to be delivered and in what order. Keep it concise.`,
  detailed: `Create a detailed numbered implementation plan. List the specific changes to make and the order of operations. Include dependencies between steps.`,
  decomposed: `Break this into sub-tasks with dependencies. For each sub-task: what it does, expected output, and what must be completed before it can start. Number the sub-tasks and mark dependencies explicitly.`,
}

const SYNTHESIZE_SYSTEM_PROMPT = (depth: 'brief' | 'detailed' | 'decomposed') =>
  `You are a planning assistant. You have just explored the codebase. Now write the implementation plan based on what you found.

${DEPTH_INSTRUCTIONS[depth]}

Do not include file discovery or file reading steps — you have already done that.
Output ONLY the plan as markdown. No preamble, no explanation.`

const PlannerSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
  planningDepth: Annotation<'brief' | 'detailed' | 'decomposed'>({
    reducer: (_, next) => next,
    default: () => 'detailed' as const,
  }),
})

type PlannerSubgraphState = typeof PlannerSubgraphState.State

export function createPlannerNode(
  model: BaseChatModel,
  readOnlyTools: Array<StructuredToolInterface>
) {
  if (!model.bindTools) {
    throw new Error('createPlannerNode requires a model that supports tool binding')
  }
  const researchModel = model.bindTools(readOnlyTools)
  const toolNode = new ToolNode(readOnlyTools, { handleToolErrors: true })

  const researchNode = async (state: PlannerSubgraphState) => {
    const response = await researchModel.invoke(state.messages)
    return { messages: [response] }
  }

  const synthesizeNode = async (state: PlannerSubgraphState) => {
    const response = await model.invoke([
      new SystemMessage(SYNTHESIZE_SYSTEM_PROMPT(state.planningDepth)),
      ...state.messages,
    ])
    return { messages: [response] }
  }

  const subgraph = new StateGraph(PlannerSubgraphState)
    .addNode('research', researchNode)
    .addNode('tools', toolNode)
    .addNode('synthesize', synthesizeNode)
    .addEdge(START, 'research')
    .addConditionalEdges('research', toolsCondition, { tools: 'tools', __end__: 'synthesize' })
    .addEdge('tools', 'research')
    .addEdge('synthesize', END)
    .compile()

  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const { messages, planningDepth = 'detailed' } = state

    const latestHumanMessage = [...messages].reverse().find(m => m.type === 'human')
    if (!latestHumanMessage) {
      return { plan: null }
    }

    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId)

    try {
      const userContent =
        typeof latestHumanMessage.content === 'string'
          ? latestHumanMessage.content
          : JSON.stringify(latestHumanMessage.content)

      const systemMessage = messages.find(m => m.type === 'system')
      const projectContext = systemMessage
        ? typeof systemMessage.content === 'string'
          ? systemMessage.content
          : JSON.stringify(systemMessage.content)
        : null

      const initialMessages = [
        new SystemMessage(RESEARCH_SYSTEM_PROMPT),
        ...(projectContext ? [new HumanMessage(`Project context:\n\n${projectContext}`)] : []),
        new HumanMessage(userContent),
      ]

      const result = await subgraph.invoke(
        { messages: initialMessages, planningDepth },
        { ...config, callbacks: [handler] }
      )

      const lastMessage = result.messages[result.messages.length - 1]
      const plan = typeof lastMessage.content === 'string' ? lastMessage.content.trim() : null

      const modelName = model.getName() as string | undefined
      const reasoning = lastMessage.additional_kwargs.reasoning_content?.toString() ?? undefined

      if (handler.traceId && plan) {
        langfuse.trace({ id: handler.traceId }).update({
          output: { plan },
          metadata: {
            ...(modelName && { model: modelName }),
            ...(reasoning && { reasoning }),
          },
        })
      }

      return { plan: plan || null }
    } catch (error) {
      console.error('[planner-subgraph] error during planning:', error)
      return { plan: null }
    }
  }
}
