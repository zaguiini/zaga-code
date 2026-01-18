import { resolve } from 'node:path'
import { HumanMessage, createAgent as createLangChainAgent, createMiddleware } from 'langchain'
import { ChatOllama } from '@langchain/ollama'
import { glob } from 'glob'
import { Client } from '@langchain/langgraph-sdk'
import { z } from 'zod'
import { fileReadTool } from './tools/file-read'
import { fileWriteTool } from './tools/file-write'
import { shellTool } from './tools/shell'
import { grepTool } from './tools/grep'
import { globTool } from './tools/glob'
import { fuzzyFileSearchTool } from './tools/fuzzy-file-search'
import { createRAGFileSearchTool } from './tools/rag-file-search'
import { getCheckpointer } from './chekpointer'
import { generateAndUpdateThreadTitle } from './title-generator'

/**
 * System prompt describing the AI developer assistant's role and capabilities.
 */
function getSystemPrompt({ projectPath }: { projectPath: string }) {
  return `You are an AI developer assistant that helps users with coding tasks. The project path is ${projectPath}.

**When given a task:**
- You MUST use the appropriate tools to gather information - never guess, make up information, or say you can't use a tool
- Go ahead and use the tools to complete the task instead of asking the user or saying you can't do it
- Always ensure file paths are relative to the project root (e.g., "src/agent/tools/file-read.ts", NOT absolute paths like "/Users/..."). Be careful with destructive operations and provide clear explanations of what you're doing.
- If the user does not specify which language the project is written in, use the available tools to figure it out.
- Always execute tools instead of asking for user confirmation. If a tool fails to execute, explain the error and try again with a fix.
- When the user passes a file name, do not assume it's in the current directory. Use the fuzzy_file_search tool to find the file.
- For semantic searches (e.g., "where is the authentication code?", "find database setup"), ALWAYS use the rag_file_search tool FIRST instead of fuzzy_file_search. Use fuzzy_file_search only when you have a specific filename to locate.
`
}

/**
 * Creates a LangChain agent with a given model and development tools.
 * Uses the latest LangChain API (createAgent) which is built on top of LangGraph.
 * Note: The model must support tool calling and reasoning
 *
 * @param projectPath - The root path of the project directory
 * @param model - The model to use
 * @returns A configured LangChain agent ready to use
 */
export async function createAgent() {
  const model = 'qwen3:1.7b'
  const projectPath = resolve(process.cwd(), 'src')

  // Initialize Ollama with the given model (supports tool calling and reasoning)
  const llm = new ChatOllama({
    model,
    temperature: 0.3,
    // Ensure tool calling is enabled
    format: undefined, // Don't force JSON format, let model handle tool calling
    streaming: true, // Enable streaming for token-by-token responses
  })

  // Get all project files for the fuzzy search index and RAG
  const projectFiles = await glob('**/*', {
    cwd: projectPath,
    absolute: false, // Return relative paths
    ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**'], // Ignore common directories
  })

  // Create the tools with the project path
  // Note: RAG tool is async and needs to be awaited
  const ragTool = await createRAGFileSearchTool(projectPath, projectFiles)

  const tools = [
    fileReadTool(projectPath),
    fileWriteTool(projectPath),
    shellTool(projectPath),
    grepTool(projectPath),
    globTool(projectPath),
    fuzzyFileSearchTool(projectFiles),
    ragTool,
  ]

  /**
   * Context schema for runtime configuration values.
   * Context is used for values that don't change during execution
   * but need to be accessible (e.g., projectPath for future extensibility).
   * Note: Tools currently use closures to access projectPath, but context
   * could be used for other runtime dependencies.
   */
  const contextSchema = z.object({
    projectPath: z.string().optional(),
  })

  /**
   * Middleware that triggers the background title generation job after the first message.
   * This follows the pattern from LangChain's open-canvas project where a separate
   * subgraph handles title generation asynchronously.
   */
  const titleGeneratorMiddleware = createMiddleware({
    name: 'TitleGenerator',
    beforeAgent: state => {
      if (state.messages.length > 1) {
        return
      }

      const [firstMessage] = state.messages

      if (!HumanMessage.isInstance(firstMessage)) {
        return
      }

      const threadId = firstMessage.additional_kwargs.threadId as string | undefined

      if (!threadId) {
        return
      }

      const langGraphClient = new Client({
        apiUrl: process.env.LANGGRAPH_API_URL || 'http://localhost:2024',
      })

      generateAndUpdateThreadTitle(langGraphClient, threadId, firstMessage.content as string)

      return
    },
  })

  // Create the agent using the latest LangChain API
  // The agent automatically handles tool binding and calling
  const agent = createLangChainAgent({
    model: llm,
    tools,
    systemPrompt: getSystemPrompt({ projectPath }),
    checkpointer: getCheckpointer(),
    middleware: [titleGeneratorMiddleware],
    contextSchema,
  })

  return agent
}
