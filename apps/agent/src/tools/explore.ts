import { createAgent, tool } from 'langchain'
import { z } from 'zod'
import { AIMessageChunk, HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { grepTool } from '@/tools/grep'

const EXPLORE_SYSTEM_PROMPT = `You are a codebase exploration and planning specialist. Your job is to understand the codebase and produce an implementation plan — not to implement anything.

READ-ONLY MODE: You only have access to file search, file read, and grep tools. Do not attempt to create, edit, or delete files.

Rules:
- Prefer grep and file_search over guessing file paths. If file_read fails, the file doesn't exist — don't try variations.
- Search broadly first, then read specific files.
- Stop exploring once you have enough context to produce a plan. Perfection is not the goal.

When you have gathered enough information, write:

1. A brief summary of findings (relevant files, patterns, constraints)
2. A numbered implementation plan:
   - Be specific about file paths and what changes
   - Keep it under 10 steps
   - No code, just the plan`

const exploreSchema = z.object({
  prompt: z
    .string()
    .describe(
      'What to explore and why — be specific about what you need to understand or find in the codebase'
    ),
})

interface ExploreStreamEvent {
  type: 'text' | 'tool-call' | 'tool-result'
  content?: string
  name?: string
  args?: unknown
  result?: string
}

export function createExploreTool(model: BaseChatModel) {
  const exploreAgent = createAgent({
    model,
    tools: [fileSearchTool, fileReadTool, grepTool],
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    name: 'explore',
  })

  return tool(
    async function* ({ prompt }, config) {
      const stream = await exploreAgent.stream(
        { messages: [new HumanMessage(prompt)] },
        { ...config, streamMode: 'messages' }
      )

      const events: Array<ExploreStreamEvent> = []
      let lastAiText = ''

      for await (const [chunk] of stream) {
        // AI message chunks (text from the subagent LLM)
        if (AIMessageChunk.isInstance(chunk)) {
          const textContent =
            typeof chunk.content === 'string'
              ? chunk.content
              : Array.isArray(chunk.content)
                ? chunk.content
                    .filter((c: any) => c.type === 'text')
                    .map((c: any) => c.text)
                    .join('')
                : ''

          if (textContent) {
            lastAiText += textContent
            events.push({ type: 'text', content: textContent })
            yield [...events]
          }

          // Tool calls from the AI (the subagent deciding to call a tool)
          if (chunk.tool_calls?.length) {
            for (const tc of chunk.tool_calls) {
              events.push({ type: 'tool-call', name: tc.name, args: tc.args })
            }
            yield [...events]
          }
        }

        // Tool result messages
        if (ToolMessage.isInstance(chunk)) {
          const resultContent =
            typeof chunk.content === 'string' ? chunk.content : JSON.stringify(chunk.content)

          events.push({
            type: 'tool-result',
            name: chunk.name,
            result: resultContent,
          })
          yield [...events]
        }
      }

      return lastAiText || 'Exploration complete — no findings.'
    },
    {
      name: 'explore',
      description:
        'Explore the codebase to understand its structure, find relevant files, and produce an implementation plan. Use this for broader codebase exploration and deep research when your task will clearly require reading multiple files across different locations. For simple, directed searches (a specific file, class, or function), use file_search or grep directly instead — they are faster.',
      schema: exploreSchema,
    }
  )
}
