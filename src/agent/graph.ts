import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { ChatOllama } from "@langchain/ollama";
import { fileReadTool } from "./tools/file-read";
import { fileWriteTool } from "./tools/file-write";
import { shellTool } from "./tools/shell";
import { grepTool } from "./tools/grep";
import { globTool } from "./tools/glob";

/**
 * System prompt describing the AI developer assistant's role and capabilities.
 */
const SYSTEM_PROMPT = `You are an AI developer assistant that helps users with coding tasks.

**When given a task:**
- You MUST use the appropriate tools to gather information - never guess, make up information, or say you can't use a tool
- Go ahead and use the tools to complete the task instead of asking the user or saying you can't do it
- Always ensure file paths are relative to the project root. Be careful with destructive operations and provide clear explanations of what you're doing.
- If the user does not specify which language the project is written in, use the available tools to figure it out.
- Always execute tools instead of asking for user confirmation. If a tool fails to execute, explain the error and try again with a fix.
- When the user passes a file name, do not assume it's in the current directory. Use the glob tool to find the file.

**Tools:**
- file_read: Read the contents of a file within the project directory.
- file_write: Write or create a file within the project directory.
- shell: Execute a shell command in the project directory.
- grep: Search for text patterns in files within the project directory.
- glob: Find files matching a glob pattern within the project directory.
`;

/**
 * Creates a LangGraph ReAct agent with a given model and development tools.
 * Note: The model must support tool calling and reasoning
 * 
 * @param projectPath - The root path of the project directory
 * @param model - The model to use
 * @returns A configured LangGraph agent ready to use
 */
export function createAgent({ projectPath, model }: { projectPath: string, model: string }) {
  // Initialize Ollama with the given model (supports tool calling and reasoning)
  const llm = new ChatOllama({
    model,
    temperature: 0.7,
    // Ensure tool calling is enabled
    format: undefined, // Don't force JSON format, let model handle tool calling
  });

  // Create the tools with the project path
  const tools = [
    fileReadTool(projectPath),
    fileWriteTool(projectPath),
    shellTool(projectPath),
    grepTool(projectPath),
    globTool(projectPath),
  ];

  // Explicitly bind tools to the LLM to ensure proper tool calling format
  // This helps Ollama models properly format tool calls
  const llmWithTools = llm.bindTools(tools);

  // Create the ReAct agent
  const agent = createReactAgent({
    llm: llmWithTools,
    tools,
    prompt: SYSTEM_PROMPT,
  });

  return agent;
}
