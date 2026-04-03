import { z } from 'zod'
import { tool } from 'langchain'

const exploreSchema = z.object({
  prompt: z
    .string()
    .describe(
      'What to explore and why — be specific about what you need to understand or find in the codebase'
    ),
})

/**
 * Schema-only tool — never executed directly. When the executor calls this,
 * the graph routes to the explore subgraph instead of the regular tools node.
 */
export const exploreTool = tool(
  async () => {
    throw new Error('explore tool is handled as a subgraph, not a direct tool call')
  },
  {
    name: 'explore',
    description:
      'Explore the codebase to understand its structure, find relevant files, and produce an implementation plan. Use this for broader codebase exploration and deep research when your task will clearly require reading multiple files across different locations. For simple, directed searches (a specific file, class, or function), use file_search or grep directly instead — they are faster.',
    schema: exploreSchema,
  }
)
