import { createAgent as createLangChainAgent } from "langchain";
import { ChatOllama } from "@langchain/ollama";
import { fileReadTool } from "./tools/file-read";
import { fileWriteTool } from "./tools/file-write";
import { shellTool } from "./tools/shell";
import { grepTool } from "./tools/grep";
import { globTool } from "./tools/glob";
import { fuzzyFileSearchTool } from "./tools/fuzzy-file-search";
import { glob } from "glob";
import { resolve } from "path";

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
`;
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
export async function createAgent({ projectPath, model }: { projectPath: string, model: string }) {
  // Initialize Ollama with the given model (supports tool calling and reasoning)
  const llm = new ChatOllama({
    model,
    temperature: 0.3,
    // Ensure tool calling is enabled
    format: undefined, // Don't force JSON format, let model handle tool calling
  });

  // Get all project files for the fuzzy search index
  const resolvedProjectPath = resolve(projectPath);
  const projectFiles = await glob("**/*", {
    cwd: resolvedProjectPath,
    absolute: false, // Return relative paths
    ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**', '.next/**'], // Ignore common directories
  });

  // Create the tools with the project path
  const tools = [
    fileReadTool(projectPath),
    fileWriteTool(projectPath),
    shellTool(projectPath),
    grepTool(projectPath),
    globTool(projectPath),
    fuzzyFileSearchTool(projectFiles),
  ];

  // Create the agent using the latest LangChain API
  // The agent automatically handles tool binding and calling
  const agent = createLangChainAgent({
    model: llm,
    tools,
    systemPrompt: getSystemPrompt({ projectPath }),
  });

  return agent;
}
