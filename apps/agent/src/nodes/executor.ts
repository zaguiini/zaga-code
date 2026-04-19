import { ChatOpenAI } from '@langchain/openai'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'
import { getLangfuse } from '@/utils/langfuse'
import { extractPromptTokens } from '@/utils/token-budget'
import { toolRegistry } from '@/config/registry'
import { buildSystemPrompt } from '@/utils/build-system-prompt'
import { parseSettings } from '@/settings'

export async function executorNode(
  state: AgentState,
  config: LangGraphRunnableConfig
): Promise<Partial<AgentState>> {
  const tools = toolRegistry.get(state.configHash)
  if (!tools) {
    throw new Error(`[executor] No tools registered for configHash: ${state.configHash}`)
  }

  const settings = parseSettings()

  const model = new ChatOpenAI({
    model: settings.model,
    configuration: { baseURL: settings.apiBase },
    apiKey: settings.apiKey ?? 'local',
    streaming: true,
    streamUsage: true,
  })

  const modelWithTools = model.bindTools(tools)

  const systemMessage = await buildSystemPrompt(state.projectPath, state.configHash)
  const messages = [systemMessage, ...state.messages]

  // Pass parent config through so streamEvents callbacks are preserved
  const start = Date.now()
  const response = await modelWithTools.invoke(messages, {
    ...config,
    recursionLimit: 100,
  })
  const durationMs = Date.now() - start

  const reasoning =
    typeof response.additional_kwargs.reasoning_content === 'string'
      ? response.additional_kwargs.reasoning_content
      : undefined

  if (reasoning) {
    response.additional_kwargs = {
      ...response.additional_kwargs,
      reasoning_duration_ms: durationMs,
    }
  }

  const langfuse = getLangfuse()
  const threadId = config.configurable?.thread_id
  if (langfuse && threadId) {
    langfuse.trace({ id: threadId }).update({
      metadata: {
        model: model.getName(),
        ...(reasoning && { reasoning }),
      },
    })
  }

  const usedTokens = extractPromptTokens(response)

  return { messages: [response], ...(usedTokens > 0 && { usedTokens }) }
}
