import { ChatOpenAI } from '@langchain/openai'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { fileWriteTool } from '@/tools/file-write'
import { shellTool } from '@/tools/shell'
import { ragSearchTool } from '@/tools/rag-search'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { env } from '@/env'
import { titleGeneratorNode } from '@/nodes/title-generator'
import { createRouterNode } from '@/nodes/router'
import { createPlannerNode } from '@/nodes/planner'
import { createExecutorNode } from '@/nodes/executor'
import { createCriticNode, shouldRetry } from '@/nodes/critic'

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
  const tools = [
    fileSearchTool,
    fileReadTool,
    fileWriteTool,
    shellTool,
    ragSearchTool,
    ...(await client.getTools()),
  ]

  const reasoningModel = new ChatOpenAI({
    model: env.REASONING_MODEL,
    configuration: { baseURL: env.LM_STUDIO_API_URL },
    apiKey: 'lm-studio',
    temperature: 0,
  })

  const codingModel = new ChatOpenAI({
    model: env.CODING_MODEL,
    configuration: { baseURL: env.LM_STUDIO_API_URL },
    apiKey: 'lm-studio',
    temperature: 0.3,
    streaming: true,
  })

  const codingModelWithTools = codingModel.bindTools(tools)

  const toolNode = new ToolNode(tools, { handleToolErrors: true })

  const routerNode = createRouterNode(reasoningModel as any)

  const plannerNode = createPlannerNode(reasoningModel as any)

  const executorNode = createExecutorNode(codingModelWithTools as any)

  const criticNode = createCriticNode(reasoningModel as any)

  const workflow = new StateGraph(agentStateSchema)
    .addNode('title-generator', titleGeneratorNode)
    .addNode('router', routerNode)
    .addNode('planner', plannerNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)
    .addNode('critic', criticNode)
    .addEdge(START, 'title-generator')
    .addEdge('title-generator', 'router')
    .addEdge('router', 'planner')
    .addEdge('planner', 'executor')
    .addConditionalEdges('executor', toolsCondition, { tools: 'tools', __end__: 'critic' })
    .addEdge('tools', 'executor')
    .addConditionalEdges('critic', shouldRetry, { executor: 'executor', __end__: END })

  return workflow.compile({
    checkpointer: PostgresSaver.fromConnString(env.DATABASE_URL),
  })
}
