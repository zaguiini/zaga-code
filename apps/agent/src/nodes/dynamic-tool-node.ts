import { ToolMessage } from '@langchain/core/messages'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'
import { toolRegistry } from '@/config/registry'

export async function dynamicToolNode(
  state: AgentState,
  config: LangGraphRunnableConfig
): Promise<Partial<AgentState>> {
  const tools = toolRegistry.get(state.configHash)
  if (!tools) {
    throw new Error(`[dynamic-tool-node] No tools registered for configHash: ${state.configHash}`)
  }

  const toolMap = new Map(tools.map(t => [t.name, t]))
  const lastMessage = state.messages[state.messages.length - 1]

  if (
    !('tool_calls' in lastMessage) ||
    !Array.isArray(lastMessage.tool_calls) ||
    lastMessage.tool_calls.length === 0
  ) {
    return { messages: [] }
  }

  const results = await Promise.all(
    lastMessage.tool_calls.map(async toolCall => {
      const t = toolMap.get(toolCall.name)

      if (!t) {
        return new ToolMessage({
          tool_call_id: toolCall.id ?? '',
          content: `Error: unknown tool "${toolCall.name}"`,
          name: toolCall.name,
        })
      }

      try {
        // Pass the full tool call object so LangChain attaches toolCallId to
        // on_tool_start / on_tool_event / on_tool_end callbacks — this is what
        // drives the `tools` stream mode in the frontend.
        // Also forward tool_call_id via metadata for tools that read it there.
        const output = await t.invoke(
          { ...toolCall, type: 'tool_call' as const },
          {
            ...config,
            recursionLimit: 100,
            metadata: {
              ...config.metadata,
              tool_call_id: toolCall.id,
            },
          }
        )

        // If the tool returned a ToolMessage directly (e.g. file_read, agent
        // tools), return it as-is to preserve metadata like format/language.
        if (ToolMessage.isInstance(output)) return output

        return new ToolMessage({
          tool_call_id: toolCall.id ?? '',
          content: typeof output === 'string' ? output : JSON.stringify(output),
          name: toolCall.name,
        })
      } catch (e) {
        return new ToolMessage({
          tool_call_id: toolCall.id ?? '',
          content: `Error: ${e instanceof Error ? e.message : String(e)}`,
          name: toolCall.name,
        })
      }
    })
  )

  return { messages: results }
}
