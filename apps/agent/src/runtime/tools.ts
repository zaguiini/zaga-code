import { inputSchemaToJsonSchema } from './tool-definition'
import type OpenAI from 'openai'
import type { RuntimeToolDefinition } from './tool-definition'
import { fileEditTool } from '@/tools/file-edit'
import { fileReadTool } from '@/tools/file-read'
import { fileSearchTool } from '@/tools/file-search'
import { fileWriteTool } from '@/tools/file-write'
import { grepTool } from '@/tools/grep'
import { shellTool } from '@/tools/shell'
import { webFetchTool } from '@/tools/web-fetch'

export const builtInTools: Array<RuntimeToolDefinition<any>> = [
  fileSearchTool,
  fileReadTool,
  grepTool,
  fileEditTool,
  fileWriteTool,
  shellTool,
  webFetchTool,
]

export function toOpenAIToolDefinitions(
  tools: Array<RuntimeToolDefinition<any>>
): Array<OpenAI.Chat.Completions.ChatCompletionTool> {
  return tools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: inputSchemaToJsonSchema(tool.inputSchema),
    },
  }))
}

export function getToolByName(name: string): RuntimeToolDefinition<any> | undefined {
  return builtInTools.find(tool => tool.name === name)
}
