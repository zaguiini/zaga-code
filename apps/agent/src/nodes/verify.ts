import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { LangGraphRunnableConfig } from '@langchain/langgraph'
import type { AgentState } from '@/graphs/agent'

const VERIFY_SYSTEM_PROMPT = `You are a verification specialist. Your job is to prove the implementation works — not to assume it does.

Steps:
1. Read the project's package.json / Makefile for build and test commands
2. Run the build if applicable. A broken build is an automatic FAIL.
3. Run the test suite if one exists. Failing tests are an automatic FAIL.
4. Run typechecks if configured (tsc, mypy, etc.)
5. Spot-check the actual behavior — run the code, hit the endpoint, call the function

For every check, record:
- Exact command run
- Actual output (copy-paste, not paraphrased)
- PASS or FAIL with expected vs actual

When you cannot run a check (no test suite, server can't start, tool unavailable):
- State what could not be verified and why
- Issue VERDICT: PARTIAL

End with exactly one of:
VERDICT: PASS
VERDICT: FAIL
VERDICT: PARTIAL

PARTIAL is for environmental limitations only — not for "I'm unsure." If you can run the check, you must decide PASS or FAIL.`

/** Runs before verify loop. Checks for edits and adds a verify prompt if needed. */
export function createVerifySetupNode() {
  return (state: AgentState): Partial<AgentState> => {
    const lastUserMessage = [...state.messages].reverse().find(m => m.type === 'human')

    const lastUserIdx = state.messages.lastIndexOf(lastUserMessage!)
    const currentTurnMessages =
      lastUserIdx >= 0 ? state.messages.slice(lastUserIdx) : state.messages
    const hasEdits = currentTurnMessages.some(
      m => m.type === 'tool' && ['file_edit', 'file_write', 'shell'].includes(m.name ?? '')
    )

    if (!hasEdits) return { verifyVerdict: 'PASS' }

    // Just signal that verification should run — no user-visible message needed.
    // The verify executor builds its own context from state.
    return {}
  }
}

/** Verify executor node — runs inline in the main graph for real-time streaming. */
export function createVerifyExecutorNode(
  model: BaseChatModel,
  verifyTools: Array<StructuredToolInterface>
) {
  const modelWithTools = model.bindTools!(verifyTools)

  return async (
    state: AgentState,
    config: LangGraphRunnableConfig
  ): Promise<Partial<AgentState>> => {
    const lastHuman = [...state.messages].reverse().find(m => m.type === 'human')
    const userContent = Array.isArray(lastHuman?.content)
      ? lastHuman.content
          .filter((c): c is { type: 'text'; text: string } => 'text' in c)
          .map(c => c.text)
          .join('')
      : String(lastHuman?.content ?? 'unknown')

    // Collect verify-phase continuation messages (from previous verify loop iterations)
    const phaseMessages = state.messages.filter(
      m =>
        m.additional_kwargs.phase === 'verify' ||
        (m.type === 'tool' &&
          state.messages.some(a => a.additional_kwargs.phase === 'verify' && a.type === 'ai'))
    )

    const messages = [
      new SystemMessage(VERIFY_SYSTEM_PROMPT),
      new HumanMessage(`Verify the implementation. Original task: ${userContent}`),
      ...phaseMessages,
    ]

    const start = Date.now()
    const response = await modelWithTools.invoke(messages, config)
    const durationMs = Date.now() - start
    const hasReasoning = typeof response.additional_kwargs.reasoning_content === 'string'
    response.additional_kwargs = {
      ...response.additional_kwargs,
      phase: 'verify',
      ...(hasReasoning && { reasoning_duration_ms: durationMs }),
    }
    return { messages: [response] }
  }
}

/** Runs after verify loop ends. Parses the verdict. */
export function createVerifyCleanupNode() {
  return (state: AgentState): Partial<AgentState> => {
    const lastVerifyAi = [...state.messages]
      .reverse()
      .find(m => m.type === 'ai' && m.additional_kwargs.phase === 'verify')

    if (!lastVerifyAi) return { verifyVerdict: 'PASS' }

    const output = String(lastVerifyAi.content)
    const verdictMatch = output.match(/VERDICT:\s*(PASS|FAIL|PARTIAL)/)
    const verdict = (verdictMatch?.[1] ?? 'PARTIAL') as 'PASS' | 'FAIL' | 'PARTIAL'

    return {
      verifyVerdict: verdict,
      critiqueFeedback: verdict !== 'PASS' ? output : null,
      critiqueAttempts: state.critiqueAttempts + (verdict !== 'PASS' ? 1 : 0),
    }
  }
}
