// apps/api/src/nodes/verify.ts
import { HumanMessage } from '@langchain/core/messages'
import type { Runnable } from '@langchain/core/runnables'
import type { AgentState } from '@/graphs/agent'

export function createVerifyNode(verifyGraph: Runnable) {
  return async (state: AgentState): Promise<Partial<AgentState>> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')

    // Only check for edits after the last user message (not full history)
    const lastUserIdx = state.messages.lastIndexOf(lastUserMessage!)
    const currentTurnMessages =
      lastUserIdx >= 0 ? state.messages.slice(lastUserIdx) : state.messages
    const hasEdits = currentTurnMessages.some(
      m => m.type === 'tool' && ['file_edit', 'file_write', 'shell'].includes(m.name ?? '')
    )
    if (!hasEdits) return { verifyVerdict: 'PASS' }
    const prompt = `Verify the implementation. Original task: ${String(lastUserMessage?.content ?? 'unknown')}`

    const result = await verifyGraph.invoke({
      messages: [new HumanMessage(prompt)],
    })

    const lastMessage = [...result.messages]
      .reverse()
      .find((m: { type: string }) => m.type === 'ai')
    const output = String(lastMessage?.content ?? '')

    const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/)
    const verdict = (verdictMatch?.[1] ?? 'PARTIAL') as 'PASS' | 'FAIL' | 'PARTIAL'

    return {
      verifyVerdict: verdict,
      critiqueFeedback: verdict !== 'PASS' ? output : null,
      critiqueAttempts: state.critiqueAttempts + (verdict !== 'PASS' ? 1 : 0),
    }
  }
}
