import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'
import { parseMemoryCommand, synthesizeMemoryNote, writeMemoryNote } from '@/utils/memory'

function getLastHumanText(state: AgentState): string {
  const lastMessage = state.messages.at(-1)
  if (!lastMessage || !HumanMessage.isInstance(lastMessage)) return ''
  return lastMessage.text.trim()
}

export async function memoryCommandNode(
  state: AgentState,
  config: LangGraphRunnableConfig
): Promise<Partial<AgentState>> {
  const text = getLastHumanText(state)
  const memoryCommand = parseMemoryCommand(text)
  if (!memoryCommand) {
    return { memoryCommandHandled: false }
  }

  let confirmation = ''
  let commandResult:
    | {
        kind: 'memory_save'
        title: string
        contentMarkdown: string
        icon: 'floppy'
        scope: 'project' | 'global'
      }
    | undefined
  try {
    if (memoryCommand.scope === 'project' && !state.projectPath) {
      throw new Error('Project memory is unavailable because this thread has no project path.')
    }

    const note = await synthesizeMemoryNote({
      commandContent: memoryCommand.content,
      scope: memoryCommand.scope,
      originSessionId: String(config.configurable?.thread_id ?? 'unknown-session'),
    })

    await writeMemoryNote({
      scope: memoryCommand.scope,
      note,
      projectPath: state.projectPath,
    })

    const scopeLabel = memoryCommand.scope === 'global' ? 'global' : 'project'
    confirmation = `Saved ${scopeLabel} memory: "${note.name}".`
    commandResult = {
      kind: 'memory_save',
      title: `Saved ${scopeLabel} memory: ${note.name}`,
      contentMarkdown: note.body,
      icon: 'floppy',
      scope: memoryCommand.scope,
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    confirmation = `Could not save memory: ${reason}`
  }

  return {
    memoryCommandHandled: true,
    messages: [
      new AIMessage({
        content: confirmation,
        ...(commandResult ? { additional_kwargs: commandResult } : {}),
      }),
    ],
  }
}
