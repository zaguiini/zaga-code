import { HumanMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

/** Runs before the verify subgraph. Checks if edits were made and prepares the verify prompt. */
export function createVerifySetupNode() {
  return (state: AgentState, _config: RunnableConfig): Partial<AgentState> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')

    const lastUserIdx = state.messages.lastIndexOf(lastUserMessage!)
    const currentTurnMessages =
      lastUserIdx >= 0 ? state.messages.slice(lastUserIdx) : state.messages
    const hasEdits = currentTurnMessages.some(
      m => m.type === 'tool' && ['file_edit', 'file_write', 'shell'].includes(m.name ?? '')
    )

    if (!hasEdits) return { verifyVerdict: 'PASS' }

    const prompt = `Verify the implementation. Original task: ${String(lastUserMessage?.content ?? 'unknown')}`
    return { messages: [new HumanMessage(prompt)] }
  }
}

/** Runs after the verify subgraph. Parses the verdict from the last AI message. */
export function createVerifyCleanupNode() {
  return (state: AgentState, _config: RunnableConfig): Partial<AgentState> => {
    const lastAiMessage = [...state.messages]
      .reverse()
      .find(m => m.type === 'ai' && m.additional_kwargs.phase === 'verify')

    if (!lastAiMessage) return { verifyVerdict: 'PASS' }

    const output = String(lastAiMessage.content)
    const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/)
    const verdict = (verdictMatch?.[1] ?? 'PARTIAL') as 'PASS' | 'FAIL' | 'PARTIAL'

    return {
      verifyVerdict: verdict,
      critiqueFeedback: verdict !== 'PASS' ? output : null,
      critiqueAttempts: state.critiqueAttempts + (verdict !== 'PASS' ? 1 : 0),
    }
  }
}
