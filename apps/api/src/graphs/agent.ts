import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { ChatOpenAIWithReasoning } from '@/utils/chat-openai-with-reasoning'
import { fileWriteTool } from '@/tools/file-write'
import { shellTool } from '@/tools/shell'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { fileEditTool } from '@/tools/file-edit'
import { grepTool } from '@/tools/grep'
import { env } from '@/env'
import { titleGeneratorNode } from '@/nodes/title-generator'
import { createExecutorNode } from '@/nodes/executor'
import { systemPromptNode } from '@/nodes/system-prompt'

const client = new MultiServerMCPClient({
  context7: {
    transport: 'http',
    url: 'https://mcp.context7.com/mcp',
  },
})

export const agentStateSchema = Annotation.Root({
  ...MessagesAnnotation.spec,
  commandHandled: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  forceCompact: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  shouldPlan: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  exploreSummary: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
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
  verifyVerdict: Annotation<'PASS' | 'FAIL' | 'PARTIAL' | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
})

export type AgentState = typeof agentStateSchema.State

export function createModels() {
  const codingModel = new ChatOpenAIWithReasoning({
    model: env.CODING_MODEL,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.3,
    streaming: true,
  })

  const fastModel = new ChatOpenAIWithReasoning({
    model: env.FAST_MODEL,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.1,
    streaming: false,
  })

  const planModel = new ChatOpenAIWithReasoning({
    model: env.FAST_MODEL,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.1,
    streaming: false,
  })

  return { codingModel, fastModel, planModel }
}

export async function createAgent() {
  const readOnlyTools = [fileSearchTool, fileReadTool]

  const tools = [
    ...readOnlyTools,
    grepTool,
    fileEditTool,
    fileWriteTool,
    shellTool,
    ...(await client.getTools()),
  ]

  const { codingModel } = createModels()

  const codingModelWithTools = codingModel.bindTools(tools)

  const toolNode = new ToolNode(tools, { handleToolErrors: true })

  const executorNode = createExecutorNode(codingModelWithTools, env.CODING_MODEL)
  const workflow = new StateGraph(agentStateSchema)
    .addNode('title-generator', titleGeneratorNode)
    .addNode('system-prompt', systemPromptNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'title-generator')
    .addEdge('title-generator', 'system-prompt')
    .addEdge('system-prompt', 'executor')
    .addConditionalEdges('executor', toolsCondition, {
      tools: 'tools',
      __end__: END,
    })
    .addEdge('tools', 'executor')

  return workflow.compile()
}
