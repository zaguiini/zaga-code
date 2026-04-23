import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { tool } from '@langchain/core/tools'
import { ToolMessage } from '@langchain/core/messages/tool'
import { getCurrentTaskInput } from '@langchain/langgraph'
import type { ToolRunnableConfig } from '@langchain/core/tools'
import type { AgentState } from '@/graphs/agent'
import type { ToolContext } from '@/runtime/tool-context'
import { validatePath } from '@/utils/validate-path'

const fileReadSchema = z.object({
  path: z
    .string()
    .describe('Relative path to the file to read, must be within the project directory'),
})

const FORBIDDEN_PATH_SEGMENT = 'node_modules'

type FileReadInput = z.infer<typeof fileReadSchema>

export async function fileReadHandler(input: FileReadInput, ctx: ToolContext) {
  if (input.path.toLowerCase().includes(FORBIDDEN_PATH_SEGMENT)) {
    return `Path blocked: references to "${FORBIDDEN_PATH_SEGMENT}" are not allowed.`
  }

  const validatedPath = validatePath(input.path, ctx.projectPath)
  const content = await readFile(validatedPath, 'utf-8')
  const extension = path.extname(input.path).slice(1) || undefined

  return new ToolMessage({
    content,
    tool_call_id: ctx.toolCallId,
    metadata: {
      format: 'code',
      ...(extension ? { language: extension } : {}),
    },
  })
}

export const fileReadTool = tool(
  async (input: FileReadInput, config: ToolRunnableConfig) => {
    const toolCallId = config.toolCall?.id
    if (!toolCallId) {
      throw new Error('file_read tool invoked without a tool_call_id in config')
    }

    try {
      const { projectPath } = getCurrentTaskInput<AgentState>()
      return await fileReadHandler(input, {
        threadId: '',
        projectPath,
        toolCallId,
        runScope: { runId: '', depth: 0 },
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
