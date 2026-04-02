// apps/api/src/graphs/verify-graph.ts
import { END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'

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

export function createVerifyGraph(
  model: BaseChatModel,
  verifyTools: Array<StructuredToolInterface>
) {
  const modelWithTools = model.bindTools!(verifyTools)
  const toolNode = new ToolNode(verifyTools)

  async function verifyExecutor(state: typeof MessagesAnnotation.State) {
    const hasSystem = state.messages.some(m => m.type === 'system')
    const messages = hasSystem
      ? state.messages
      : [new SystemMessage(VERIFY_SYSTEM_PROMPT), ...state.messages]

    const response = await modelWithTools.invoke(messages)
    return { messages: [response] }
  }

  return new StateGraph(MessagesAnnotation)
    .addNode('executor', verifyExecutor)
    .addNode('tools', toolNode)
    .addEdge(START, 'executor')
    .addConditionalEdges('executor', toolsCondition, {
      tools: 'tools',
      __end__: END,
    })
    .addEdge('tools', 'executor')
    .compile()
}
