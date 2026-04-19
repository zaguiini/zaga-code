import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { MultiServerMCPClient } from '@langchain/mcp-adapters'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { AgentState } from '@/graphs/agent'
import type { Settings } from '@/settings'
import { parseSettings, settings } from '@/settings'
import { loadAgentsFromDir, mergeAgentDefinitions } from '@/config/agent-loader'
import { computeConfigHash, toolRegistry } from '@/config/registry'
import { BUILT_IN_TOOLS, createAgentTool } from '@/utils/create-agent-tool'
import { fetchContextLength } from '@/utils/fetch-context-length'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BUILT_IN_AGENTS_DIR = join(__dirname, '..', 'agents')

async function connectMcps(mcpServers: Settings['mcpServers']) {
  if (Object.keys(mcpServers).length === 0) return []
  try {
    const client = new MultiServerMCPClient(mcpServers)
    return await client.getTools()
  } catch (e) {
    console.warn(`[load-config] MCP connection failed: ${e instanceof Error ? e.message : e}`)
    return []
  }
}

export function createLoadConfigNode(model: BaseChatModel) {
  return async function loadConfigNode(state: AgentState): Promise<Partial<AgentState>> {
    // Fetch context window size on the first run
    const maxTokens = state.maxTokens > 0 ? state.maxTokens : await fetchContextLength()

    // Load settings from global and per-project layers
    const projectSettings = state.projectPath
      ? parseSettings(join(state.projectPath, '.zaga', 'settings.json'))
      : null

    // Merge MCPs: project overrides global by key
    const mergedMcps = {
      ...settings.mcpServers,
      ...projectSettings?.mcpServers,
    }

    // Load agents from all three layers
    const builtInDefs = await loadAgentsFromDir(BUILT_IN_AGENTS_DIR)
    const globalDefs = await loadAgentsFromDir(join(homedir(), '.zaga', 'agents'))
    const projectDefs = state.projectPath
      ? await loadAgentsFromDir(join(state.projectPath, '.zaga', 'agents'))
      : []

    const mergedAgentDefs = mergeAgentDefinitions(builtInDefs, globalDefs, projectDefs)

    // Compute hash from effective config
    const configHash = computeConfigHash(
      JSON.stringify({ mcpServers: mergedMcps, agents: mergedAgentDefs })
    )

    // Cache hit — tools already resolved for this config
    if (toolRegistry.has(configHash)) {
      return { configHash, maxTokens }
    }

    // Resolve MCPs and build full tool list
    const mcpTools = await connectMcps(mergedMcps)
    const agentTools = mergedAgentDefs.map(def => createAgentTool(def, model))
    const allTools = [...BUILT_IN_TOOLS, ...mcpTools, ...agentTools]

    toolRegistry.set(configHash, allTools)
    return { configHash, maxTokens }
  }
}
