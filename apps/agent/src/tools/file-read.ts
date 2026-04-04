import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { ToolMessage } from '@langchain/core/messages/tool'
import { getCurrentTaskInput } from '@langchain/langgraph'
import type { ToolRunnableConfig } from '@langchain/core/tools'
import type { AgentState } from '@/graphs/agent'
import { validatePath } from '@/utils/validate-path'

const fileReadSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to read, must be within the project directory'),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

export const fileReadTool = tool(
  async (input: z.infer<typeof fileReadSchema>, config: ToolRunnableConfig) => {
    const toolCallId = config.toolCall?.id
    if (!toolCallId) {
      throw new Error('file_read tool invoked without a tool_call_id in config')
    }

    try {
      if (input.path.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
        return `Path blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
      }

      const { projectPath } = getCurrentTaskInput<AgentState>()
      const validatedPath = validatePath(input.path, projectPath)
      const content = await readFile(validatedPath, 'utf-8')
      const extension = path.extname(input.path).slice(1) || undefined

      return new ToolMessage({
        content,
        tool_call_id: toolCallId,
        metadata: {
          format: 'code',
          ...(extension ? { language: extension } : {}),
        },
      })
    } catch (error) {
      if (error instanceof Error) {
        return `Error reading file: ${error.message}`
      }
      return `Error reading file: ${String(error)}`
    }
  },
  {
    name: 'file_read',
    description:
      'Read the contents of a file within the project directory. The path must be relative to the project root.',
    schema: fileReadSchema,
  }
)
