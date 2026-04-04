import { getCurrentTaskInput } from '@langchain/langgraph'
import { HumanMessage, ToolMessage, createAgent, tool } from 'langchain'
import { z } from 'zod'
import type { BaseMessage } from 'langchain'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredTool } from '@langchain/core/tools'
import type { AgentDefinition } from '@/config/agent-loader'
import type { AgentState } from '@/graphs/agent'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { grepTool } from '@/tools/grep'
import { fileEditTool } from '@/tools/file-edit'
import { fileWriteTool } from '@/tools/file-write'
import { shellTool } from '@/tools/shell'

/** All built-in tools available for subagent `tools` filtering. */
export const BUILT_IN_TOOLS: Array<StructuredTool> = [
  fileSearchTool,
  fileReadTool,
  grepTool,
  fileEditTool,
  fileWriteTool,
  shellTool,
]

const agentStateSchema = z.object({ projectPath: z.string() })

/**
 * Creates a LangChain tool from an agent definition.
 * The subagent receives only the tools listed in `definition.tools`
 * (or all built-in tools if omitted).
 * MCPs and other agents are never available inside subagents.
 */
export function createAgentTool(definition: AgentDefinition, model: BaseChatModel): StructuredTool {
  const allowedTools = definition.tools
    ? BUILT_IN_TOOLS.filter(t => definition.tools!.includes(t.name))
    : BUILT_IN_TOOLS

  const subagent = createAgent({
    model,
    tools: allowedTools,
    systemPrompt: definition.systemPrompt,
    stateSchema: agentStateSchema,
    name: definition.name,
  })

  return tool(
    async function* ({ prompt }, config) {
      const toolCallId = config.metadata.tool_call_id
      if (!toolCallId) {
        throw new Error('create-agent tool invoked without a tool_call_id in config')
      }

      const { projectPath } = getCurrentTaskInput<AgentState>()

      const stream = await subagent.stream(
        { messages: [new HumanMessage(prompt)], projectPath },
        { streamMode: 'values' }
      )

      let lastMessages: Array<BaseMessage> = []

      for await (const update of stream) {
        yield update.messages

        lastMessages = update.messages
      }

      return new ToolMessage({
        content: lastMessages.at(-1)?.content ?? 'No output',
        tool_call_id: toolCallId,
        metadata: {
          format: 'markdown',
        },
      })
    },
    {
      name: `agent-${definition.name}`,
      description: definition.description,
      schema: z.object({
        prompt: z
          .string()
          .describe('What you want the agent to do — be specific about the goal and context'),
      }),
    }
  )
}
