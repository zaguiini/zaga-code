import { Annotation, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { toolsCondition } from '@langchain/langgraph/prebuilt'
import { ChatOpenAI } from '@langchain/openai'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { settings } from '@/settings'
import { createExecutorNode } from '@/nodes/executor'
import { createMaybeCompactNode } from '@/nodes/maybe-compact'
import { createLoadConfigNode } from '@/nodes/load-config'
import { dynamicToolNode } from '@/nodes/dynamic-tool-node'

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
  return new ChatOpenAI({
    model: settings.model,
    configuration: { baseURL: settings.apiBase },
    apiKey: settings.apiKey ?? 'local',
    streaming: true,
    streamUsage: true,
  })
}

function buildAgentGraph() {
  const model = createModel()

  const loadConfigNode = createLoadConfigNode(model)
  const executorNode = createExecutorNode(model, settings.model)

  return new StateGraph(agentStateSchema)
    .addNode('maybe-compact', createMaybeCompactNode(model))
    .addNode('load-config', loadConfigNode)
    .addNode('executor', executorNode)
    .addNode('tools', dynamicToolNode)

    .addEdge(START, 'maybe-compact')
    .addEdge('maybe-compact', 'load-config')
    .addEdge('load-config', 'executor')
    .addConditionalEdges('executor', toolsCondition)
    .addEdge('tools', 'executor')
}

/** Convenience: builds and compiles with no checkpointer (for LangGraph API server compat) */
export function createAgent(opts: { checkpointer?: BaseCheckpointSaver } = {}) {
  const graph = buildAgentGraph()
  return graph.compile({ checkpointer: opts.checkpointer })
}
