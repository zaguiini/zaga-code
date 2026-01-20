import { ChatOllama } from '@langchain/ollama'
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres'
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { fileWriteTool } from '@/tools/file-write'
import { shellTool } from '@/tools/shell'
import { ragSearchTool } from '@/tools/rag-search'
import { fileSearchTool } from '@/tools/file-search'
import { fileReadTool } from '@/tools/file-read'
import { env } from '@/env'
import { titleGeneratorNode } from '@/nodes/title-generator'
import { createLlmNode } from '@/nodes/llm'

/**
 * Extended state annotation that includes messages and project context
 */
const stateSchema = Annotation.Root({
  ...MessagesAnnotation.spec,
  projectPath: Annotation<string>(),
})

const tools = [fileSearchTool, fileReadTool, fileWriteTool, shellTool, ragSearchTool]

/**
 * Creates a custom ReAct-style agent using LangGraph.
 * The agent is mindful of tool calls and reasoning:
 * - It reasons about tasks before taking action
 * - It strategically uses tools to gather information
 * - It decides when it has enough information to respond
 * - It handles tool execution errors gracefully
 *
 * @returns A compiled LangGraph agent ready to use
 */
export function createAgent() {
  // Initialize Ollama with the given model (supports tool calling and reasoning)
  const model = new ChatOllama({
    model: env.AGENT_MODEL,
    temperature: 0.3,
    format: undefined, // Don't force JSON format, let model handle tool calling
    streaming: true, // Enable streaming for token-by-token responses
  })

  const modelWithTools = model.bindTools(tools)

  // Create ToolNode to execute tool calls
  // Tools now use getCurrentTaskInput() to access state, so ToolNode works automatically
  const toolNode = new ToolNode(tools, {
    handleToolErrors: true,
  })

  // Create the agent node with the model and tools already bound
  const llmNode = createLlmNode(modelWithTools)

  // Build the ReAct agent graph
  const workflow = new StateGraph(stateSchema)
    .addNode('title-generator', titleGeneratorNode)
    // Add the agent node - this is where reasoning and tool call decisions happen
    .addNode('llm', llmNode)
    // Add the tools node - this executes tool calls
    .addNode('tools', toolNode)
    // Start with the agent
    .addEdge(START, 'title-generator')
    .addEdge('title-generator', 'llm')
    // After agent, conditionally route to tools or end
    // When shouldContinue returns END, LangGraph handles it automatically
    .addConditionalEdges('llm', toolsCondition, ['tools', END])
    // After tools execute, go back to agent to process results
    .addEdge('tools', 'llm')

  // Compile the graph with checkpointer
  const app = workflow.compile({
    checkpointer: PostgresSaver.fromConnString(env.DATABASE_URL),
  })

  return app
}
