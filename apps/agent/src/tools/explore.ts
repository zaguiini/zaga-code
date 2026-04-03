import { createAgent, tool } from 'langchain'
import { z } from 'zod'
import { HumanMessage } from '@langchain/core/messages'
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

export function createExploreTool(model: BaseChatModel) {
  const exploreAgent = createAgent({
    model,
    tools: [fileSearchTool, fileReadTool, grepTool],
    systemPrompt: EXPLORE_SYSTEM_PROMPT,
    name: 'explore',
  })

  return tool(
    async ({ prompt }, config) => {
      const result = await exploreAgent.invoke(
        {
          messages: [new HumanMessage(prompt)],
        },
        config
      )
      const lastMessage = result.messages.at(-1)
      return typeof lastMessage?.content === 'string'
        ? lastMessage.content
        : 'Exploration complete — no findings.'
    },
    {
      name: 'explore',
      description:
        'Explore the codebase to understand its structure, find relevant files, and produce an implementation plan. Use this for broader codebase exploration and deep research when your task will clearly require reading multiple files across different locations. For simple, directed searches (a specific file, class, or function), use file_search or grep directly instead — they are faster.',
      schema: exploreSchema,
    }
  )
}
