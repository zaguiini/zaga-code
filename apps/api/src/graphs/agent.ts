import { createAgent as createLangChainAgent } from 'langchain'
import { ChatOllama } from '@langchain/ollama'
import { z } from 'zod'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { fileReadTool } from '../tools/file-read'
import { fileWriteTool } from '../tools/file-write'
import { shellTool } from '../tools/shell'
import { ragSearchTool } from '../tools/rag-search'
import { titleGeneratorMiddleware } from '@/middlewares/title-generator'
import { env } from '@/env'

/**
 * System prompt describing the AI developer assistant's role and capabilities.
 */
const SYSTEM_PROMPT = `You are an AI developer assistant that helps users with coding tasks.

**When given a task:**
- You MUST use the appropriate tools to gather information - never guess, make up information, or say you can't use a tool
- Go ahead and use the tools to complete the task instead of asking the user or saying you can't do it
- Always ensure file paths are relative to the project root (e.g., "src/agent/tools/file-read.ts", NOT absolute paths like "/Users/..."). Be careful with destructive operations and provide clear explanations of what you're doing.
- If the user does not specify which language the project is written in, use the available tools to figure it out.
- Always execute tools instead of asking for user confirmation. If a tool fails to execute, explain the error and try again with a fix.
- For semantic searches (e.g., "where is the authentication code?", "find database setup", "find a file"), ALWAYS use the rag_file_search tool.
`

/**
 * Creates a LangChain agent with a given model and development tools.
 * Uses the latest LangChain API (createAgent) which is built on top of LangGraph.
 * Note: The model must support tool calling and reasoning
 *
 * @param projectPath - The root path of the project directory
 * @param model - The model to use
 * @returns A configured LangChain agent ready to use
 */
export function createAgent() {
  // Initialize Ollama with the given model (supports tool calling and reasoning)
  const llm = new ChatOllama({
    model: env.AGENT_MODEL,
    temperature: 0.3,
    // Ensure tool calling is enabled
    format: undefined, // Don't force JSON format, let model handle tool calling
    streaming: true, // Enable streaming for token-by-token responses
  })

  const tools = [fileReadTool, fileWriteTool, shellTool, ragSearchTool]

  /**
   * Context schema for runtime configuration values.
   * Context is used for values that don't change during execution
   * but need to be accessible (e.g., projectPath for future extensibility).
   * Note: Tools currently use closures to access projectPath, but context
   * could be used for other runtime dependencies.
   */
  const stateSchema = z.object({
    projectPath: z.string().describe('The root path of the project'),
    threadId: z.string().describe('The ID of the thread'),
  })

  // Create Postgres checkpointer
  const checkpointer = PostgresSaver.fromConnString(env.DATABASE_URL)

  // Create the agent using the latest LangChain API
  // The agent automatically handles tool binding and calling
  const agent = createLangChainAgent({
    model: llm,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    checkpointer,
    middleware: [titleGeneratorMiddleware],
    stateSchema,
  })

  return agent
}
