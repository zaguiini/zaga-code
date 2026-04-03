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
import { createExecutorNode } from '@/nodes/executor'
import { systemPromptNode } from '@/nodes/system-prompt'
import { createMaybeCompactNode } from '@/nodes/maybe-compact'
import { createCommandNode } from '@/nodes/command'
import { createShouldPlanNode } from '@/nodes/should-plan'
import { createExploreCleanupNode } from '@/nodes/explore'
import { createPlanNode } from '@/nodes/plan'
import { createVerifyCleanupNode, createVerifySetupNode } from '@/nodes/verify'
import { createExploreGraph } from '@/graphs/explore-graph'
import { createVerifyGraph } from '@/graphs/verify-graph'
import { queryModelInfo } from '@/setup'

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
  maxTokens: Annotation<number>({
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
  })
}

async function buildAgentGraph(maxTokens: number) {
  const model = createModel()

  const readOnlyTools = [fileSearchTool, fileReadTool, grepTool]
  const allTools = [
    ...readOnlyTools,
    fileEditTool,
    fileWriteTool,
    shellTool,
    ...(await client.getTools()),
  ]
  const verifyTools = [...readOnlyTools, shellTool]

  const exploreGraph = createExploreGraph(model, readOnlyTools)
  const verifyGraph = createVerifyGraph(model, verifyTools)

  const executorNode = createExecutorNode(model.bindTools(allTools), env.MODEL)
  const toolNode = new ToolNode(allTools, { handleToolErrors: true })

  return new StateGraph(agentStateSchema)
    .addNode('command', createCommandNode(maxTokens))
    .addNode('maybe-compact', createMaybeCompactNode(model))
    .addNode('should-plan', createShouldPlanNode(model))
    .addNode('explore', exploreGraph)
    .addNode('explore-cleanup', createExploreCleanupNode())
    .addNode('make-plan', createPlanNode(model))
    .addNode('system-prompt', systemPromptNode)
    .addNode('executor', executorNode)
    .addNode('tools', toolNode)
    .addNode('verify-setup', createVerifySetupNode())
    .addNode('verify', verifyGraph)
    .addNode('verify-cleanup', createVerifyCleanupNode())

    .addEdge(START, 'command')
    .addConditionalEdges('command', s => {
      if (!s.commandHandled) return 'maybe-compact'
      if (s.forceCompact) return 'maybe-compact'
      return END
    })
    .addConditionalEdges('maybe-compact', s => (s.commandHandled ? END : 'should-plan'))
    .addConditionalEdges('should-plan', s => (s.shouldPlan ? 'explore' : 'system-prompt'))
    .addEdge('explore', 'explore-cleanup')
    .addEdge('explore-cleanup', 'make-plan')
    .addEdge('make-plan', 'system-prompt')
    .addEdge('system-prompt', 'executor')
    .addConditionalEdges('executor', toolsCondition, {
      tools: 'tools',
      __end__: 'verify-setup',
    })
    .addEdge('tools', 'executor')
    .addConditionalEdges('verify-setup', s => {
      if (s.verifyVerdict === 'PASS') return END
      return 'verify'
    })
    .addEdge('verify', 'verify-cleanup')
    .addConditionalEdges('verify-cleanup', s => {
      if (s.verifyVerdict === 'PASS') return END
      if (s.critiqueAttempts >= 2) return END
      return 'system-prompt'
    })
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
