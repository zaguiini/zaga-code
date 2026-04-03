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
import { createExploreCleanupNode, createExploreExecutorNode } from '@/nodes/explore'
import { createPlanNode } from '@/nodes/plan'
import {
  createVerifyCleanupNode,
  createVerifyExecutorNode,
  createVerifySetupNode,
} from '@/nodes/verify'
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

  const executorNode = createExecutorNode(model.bindTools(allTools), env.MODEL)
  const toolNode = new ToolNode(allTools, { handleToolErrors: true })

  // Explore phase: dedicated executor + tools loop (streams in real-time)
  const exploreExecutor = createExploreExecutorNode(model, readOnlyTools)
  const exploreToolNode = new ToolNode(readOnlyTools, { handleToolErrors: true })

  // Verify phase: dedicated executor + tools loop (streams in real-time)
  const verifyExecutor = createVerifyExecutorNode(model, verifyTools)
  const verifyToolNode = new ToolNode(verifyTools, { handleToolErrors: true })

  return (
    new StateGraph(agentStateSchema)
      .addNode('command', createCommandNode(maxTokens))
      .addNode('maybe-compact', createMaybeCompactNode(model))
      .addNode('should-plan', createShouldPlanNode(model))
      // Explore phase (inline executor + tools loop)
      .addNode('explore-executor', exploreExecutor)
      .addNode('explore-tools', exploreToolNode)
      .addNode('explore-cleanup', createExploreCleanupNode())
      // Plan
      .addNode('make-plan', createPlanNode(model))
      // Main execution
      .addNode('system-prompt', systemPromptNode)
      .addNode('executor', executorNode)
      .addNode('tools', toolNode)
      // Verify phase (inline executor + tools loop)
      .addNode('verify-setup', createVerifySetupNode())
      .addNode('verify-executor', verifyExecutor)
      .addNode('verify-tools', verifyToolNode)
      .addNode('verify-cleanup', createVerifyCleanupNode())

      .addEdge(START, 'command')
      .addConditionalEdges('command', s => {
        if (!s.commandHandled) return 'maybe-compact'
        if (s.forceCompact) return 'maybe-compact'
        return END
      })
      .addConditionalEdges('maybe-compact', s => (s.commandHandled ? END : 'should-plan'))
      .addConditionalEdges('should-plan', s =>
        s.shouldPlan ? 'explore-executor' : 'system-prompt'
      )
      // Explore loop: executor → tools → executor (until no more tool calls)
      .addConditionalEdges('explore-executor', toolsCondition, {
        tools: 'explore-tools',
        __end__: 'explore-cleanup',
      })
      .addEdge('explore-tools', 'explore-executor')
      .addEdge('explore-cleanup', 'make-plan')
      .addEdge('make-plan', 'system-prompt')
      // Main execution loop
      .addEdge('system-prompt', 'executor')
      .addConditionalEdges('executor', toolsCondition, {
        tools: 'tools',
        __end__: 'verify-setup',
      })
      .addEdge('tools', 'executor')
      // Verify: setup decides whether to run
      .addConditionalEdges('verify-setup', s => {
        if (s.verifyVerdict === 'PASS') return END
        return 'verify-executor'
      })
      // Verify loop: executor → tools → executor (until no more tool calls)
      .addConditionalEdges('verify-executor', toolsCondition, {
        tools: 'verify-tools',
        __end__: 'verify-cleanup',
      })
      .addEdge('verify-tools', 'verify-executor')
      .addConditionalEdges('verify-cleanup', s => {
        if (s.verifyVerdict === 'PASS') return END
        if (s.critiqueAttempts >= 2) return END
        return 'system-prompt'
      })
  )
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
