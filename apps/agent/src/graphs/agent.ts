import { Annotation, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import { ChatOpenAIWithReasoning } from '@/utils/chat-openai-with-reasoning'
import { fileWriteTool } from '@/tools/file-write'
import { shellTool } from '@/tools/shell'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { fileEditTool } from '@/tools/file-edit'
import { grepTool } from '@/tools/grep'
import { createExploreTool } from '@/tools/explore'
import { env } from '@/env'
import { createExecutorNode } from '@/nodes/executor'
import { systemPromptNode } from '@/nodes/system-prompt'
import { createMaybeCompactNode } from '@/nodes/maybe-compact'
import { queryModelInfo } from '@/setup'

export const agentStateSchema = Annotation.Root({
  ...MessagesAnnotation.spec,
  projectPath: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
  maxTokens: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
  /** Actual prompt tokens from the last model response (from API usage metadata). */
  usedTokens: Annotation<number>({
    reducer: (_, next) => next,
    default: () => 0,
  }),
})

export type AgentState = typeof agentStateSchema.State

export function createModel() {
  return new ChatOpenAIWithReasoning({
    model: env.MODEL,
    configuration: { baseURL: env.MODEL_API_BASE_URL },
    apiKey: 'local',
    temperature: 0.3,
    streaming: true,
    streamUsage: true,
  })
}

/** Lazily connects to Context7 MCP and caches the tools. */
let mcpToolsCache: Awaited<ReturnType<MultiServerMCPClient['getTools']>> | null = null

async function getMcpTools() {
  if (mcpToolsCache) return mcpToolsCache

  const client = new MultiServerMCPClient({
    context7: {
      transport: 'http',
      url: 'https://mcp.context7.com/mcp',
    },
  })

  mcpToolsCache = await client.getTools()
  return mcpToolsCache
}

async function buildAgentGraph(maxTokens: number) {
  const model = createModel()

  const readOnlyTools = [fileSearchTool, fileReadTool, grepTool]
  const exploreTool = createExploreTool(model)
  const allTools = [
    ...readOnlyTools,
    fileEditTool,
    fileWriteTool,
    shellTool,
    exploreTool,
    ...(await getMcpTools()),
  ]

  const executorNode = createExecutorNode(model.bindTools(allTools), env.MODEL)
  const toolNode = new ToolNode(allTools, { handleToolErrors: true })

  return new StateGraph(agentStateSchema)
    .addNode('maybe-compact', createMaybeCompactNode(model, maxTokens))
    .addNode('system-prompt', systemPromptNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)

    .addEdge(START, 'maybe-compact')
    .addEdge('maybe-compact', 'system-prompt')
    .addEdge('system-prompt', 'executor')
    .addConditionalEdges('executor', toolsCondition)
    .addEdge('tools', 'executor')
}

async function queryMaxTokens(): Promise<number> {
  const info = await queryModelInfo(env.MODEL)

  return info.maxTokens
}

/** Convenience: builds and compiles with no checkpointer (for LangGraph API server compat) */
export async function createAgent() {
  const maxTokens = await queryMaxTokens()
  const graph = await buildAgentGraph(maxTokens)
  return graph.compile()
}
