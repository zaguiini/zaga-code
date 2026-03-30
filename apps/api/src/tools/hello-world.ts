import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import type { ToolRuntime } from '@langchain/core/tools'

const helloWorldSchema = z.object({
  greeting: z.string().optional().describe('Optional greeting to include in the response'),
})

const contextSchema = z.object({
  project_path: z.string(),
})

/**
 * Creates a LangGraph tool that returns "Hello World"
 * following the established patterns in the codebase.
 */
export const helloWorldTool = tool(
  async (
    input: z.infer<typeof helloWorldSchema>,
    {
      context: { project_path: _project_path },
    }: ToolRuntime<unknown, z.infer<typeof contextSchema>>
  ) => {
    // The tool simply returns "Hello World"
    // The project_path context is available but not used in this simple case
    if (input.greeting) {
      return `${input.greeting} World`
    }
    return 'Hello World'
  },
  {
    name: 'hello_world',
    description: 'Returns "Hello World" string. Useful for testing or as a simple response tool.',
    schema: helloWorldSchema,
  }
)
