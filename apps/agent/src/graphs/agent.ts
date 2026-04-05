import { Annotation, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { toolsCondition } from '@langchain/langgraph/prebuilt'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { ChatOpenAIWithReasoning } from '@/utils/chat-openai-with-reasoning'
import { isExternalProvider, settings } from '@/settings'
import { createExecutorNode } from '@/nodes/executor'
import { systemPromptNode } from '@/nodes/system-prompt'
import { createMaybeCompactNode } from '@/nodes/maybe-compact'
import { createLoadConfigNode } from '@/nodes/load-config'
import { dynamicToolNode } from '@/nodes/dynamic-tool-node'
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
  /** Content hash of the merged config — used as key into the tool registry. */
  configHash: Annotation<string>({
    reducer: (_, next) => next,
    default: () => '',
  }),
})

export type AgentState = typeof agentStateSchema.State

export function createModel() {
  return new ChatOpenAIWithReasoning({
    model: settings.model,
    configuration: { baseURL: settings.apiBase },
    apiKey: settings.apiKey ?? 'local',
    temperature: 0.3,
    streaming: true,
    streamUsage: true,
  })
}

function buildAgentGraph({ maxTokens }: { maxTokens: number }) {
  const model = createModel()

  const loadConfigNode = createLoadConfigNode(model)
  const executorNode = createExecutorNode(model, settings.model)

  return new StateGraph(agentStateSchema)
    .addNode('maybe-compact', createMaybeCompactNode(model, maxTokens))
    .addNode('load-config', loadConfigNode)
    .addNode('system-prompt', systemPromptNode)
    .addNode('executor', executorNode)
    .addNode('tools', dynamicToolNode)

    .addEdge(START, 'maybe-compact')
    .addEdge('maybe-compact', 'load-config')
    .addEdge('load-config', 'system-prompt')
    .addEdge('system-prompt', 'executor')
    .addConditionalEdges('executor', toolsCondition)
    .addEdge('tools', 'executor')
}

async function queryMaxTokens(): Promise<number> {
  if (isExternalProvider(settings)) return 128_000
  const info = await queryModelInfo(settings.model)
  return info.maxTokens
}

/** Convenience: builds and compiles with no checkpointer (for LangGraph API server compat) */
export async function createAgent(opts: { checkpointer?: BaseCheckpointSaver } = {}) {
  const maxTokens = await queryMaxTokens()
  const graph = buildAgentGraph({ maxTokens })
  return graph.compile({ checkpointer: opts.checkpointer })
}
