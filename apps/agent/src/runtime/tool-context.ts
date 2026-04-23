import type { RunScope } from './events'

export type ToolContext = {
  threadId: string
  projectPath: string
  toolCallId: string
  runScope: RunScope
  signal?: AbortSignal
}
