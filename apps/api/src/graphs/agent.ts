import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { ChatOpenAIWithReasoning } from '@/utils/chat-openai-with-reasoning'
import { fileWriteTool } from '@/tools/file-write'
import { shellTool } from '@/tools/shell'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { env } from '@/env'
import { titleGeneratorNode } from '@/nodes/title-generator'
import { createClassifierNode } from '@/nodes/classifier'
import { createPlannerNode } from '@/graphs/planner-subgraph'
import { createExecutorNode } from '@/nodes/executor'
import { createCriticNode, shouldRetry } from '@/graphs/critic-subgraph'
import { systemPromptNode } from '@/nodes/system-prompt'

const client = new MultiServerMCPClient({
  context7: {
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
  },
})

export const agentStateSchema = Annotation.Root({
  ...MessagesAnnotation.spec,
  complexity: Annotation<'simple' | 'medium' | 'complex'>({
    reducer: (_, next) => next,
    default: () => 'medium' as const,
  }),
  planningDepth: Annotation<'brief' | 'detailed' | 'decomposed'>({
    reducer: (_, next) => next,
    default: () => 'detailed' as const,
  }),
  plan: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  critiqueAttempts: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  critiqueFeedback: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
})

export type AgentState = typeof agentStateSchema.State

export async function createAgent() {
  const readOnlyTools = [fileSearchTool, fileReadTool]

  const tools = [...readOnlyTools, fileWriteTool, shellTool, ...(await client.getTools())]

  const reasoningModel = new ChatOpenAIWithReasoning({
    model: env.REASONING_MODEL,
    configuration: { baseURL: env.LM_STUDIO_API_URL },
    apiKey: 'lm-studio',
    temperature: 0,
    streaming: true,
  })

  const codingModel = new ChatOpenAIWithReasoning({
    model: env.CODING_MODEL,
    configuration: { baseURL: env.LM_STUDIO_API_URL },
    apiKey: 'lm-studio',
    temperature: 0.3,
    streaming: true,
  })

  const codingModelWithTools = codingModel.bindTools(tools)

  const toolNode = new ToolNode(tools, { handleToolErrors: true })

  const classifierNode = createClassifierNode(reasoningModel)
  const plannerNode = createPlannerNode(reasoningModel, readOnlyTools)
  const executorNode = createExecutorNode(codingModelWithTools, env.CODING_MODEL)
  const criticNode = createCriticNode(reasoningModel, readOnlyTools)

  const workflow = new StateGraph(agentStateSchema)
    .addNode('title-generator', titleGeneratorNode)
    .addNode('system-prompt', systemPromptNode)
    .addNode('classifier', classifierNode)
    .addNode('planner', plannerNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)
    .addNode('critic', criticNode)
    .addEdge(START, 'title-generator')
    .addEdge('title-generator', 'system-prompt')
    .addEdge('system-prompt', 'classifier')
    .addConditionalEdges(
      'classifier',
      (state: AgentState) => (state.complexity === 'simple' ? 'executor' : 'planner'),
      { executor: 'executor', planner: 'planner' }
    )
    .addEdge('planner', 'executor')
    .addConditionalEdges('executor', toolsCondition, { tools: 'tools', __end__: 'critic' })
    .addEdge('tools', 'executor')
    .addConditionalEdges('critic', shouldRetry, { executor: 'executor', __end__: END })

  return workflow.compile()
}
