import { z } from 'zod'
import { Annotation, END, MessagesAnnotation, START, StateGraph } from '@langchain/langgraph'
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AgentState } from '@/graphs/agent'
import { createCallbackHandler, langfuse } from '@/utils/langfuse'

const MAX_CRITIQUE_ATTEMPTS = 2

const criticOutputSchema = z.object({
  approved: z.boolean(),
  feedback: z.string(),
})

const RESEARCH_SYSTEM_PROMPT = `You are verifying whether a coding assistant completed a task correctly. Your job:
1. Look through the conversation for file_write tool results — those tell you which files were modified.
2. Use file_read to read each modified file.
3. Check that the content is correct and matches what the task required.
4. Read any related files (imports, configs, tests) if needed to verify correctness.

When you have read enough to make a verdict, stop making tool calls.`

const SYNTHESIZE_SYSTEM_PROMPT = (
  plan: string | null
) => `You are a code review critic. You have just read the relevant files. Now evaluate whether the task was fully completed.

CRITICAL: Base your verdict on what you read, not on prose claims in the conversation. "I've updated the file" is not evidence — the file content you just read is.

${
  plan
    ? `The assistant was following this plan:\n${plan}\n\nFor every plan step that requires a file change, confirm the file you read contains that change. If any step's change is missing, reject and name the missing step.`
    : ''
}

Reject if:
- Any required file change is missing from the files you read
- The assistant told the user to do something themselves instead of doing it
- There are obvious bugs in generated code

Approve if every required change is present in the files you read.`

const CriticSubgraphState = Annotation.Root({
  ...MessagesAnnotation.spec,
})

type CriticSubgraphState = typeof CriticSubgraphState.State

export function createCriticNode(
  model: BaseChatModel,
  readOnlyTools: Array<StructuredToolInterface>
) {
  if (!model.bindTools) {
    throw new Error('createCriticNode requires a model that supports tool binding')
  }

  const researchModel = model.bindTools(readOnlyTools)
  const toolNode = new ToolNode(readOnlyTools, { handleToolErrors: true })
  const structuredModel = model.withStructuredOutput(criticOutputSchema, { includeRaw: true })

  const researchNode = async (state: CriticSubgraphState) => {
    const response = await researchModel.invoke(state.messages)
    return { messages: [response] }
  }

  const subgraph = new StateGraph(CriticSubgraphState)
    .addNode('research', researchNode)
    .addNode('tools', toolNode)
    .addEdge(START, 'research')
    .addConditionalEdges('research', toolsCondition, { tools: 'tools', __end__: END })
    .addEdge('tools', 'research')
    .compile()

  return async (state: AgentState, config: RunnableConfig): Promise<Partial<AgentState>> => {
    const { messages, plan, critiqueAttempts } = state

    const conversationMessages = messages.filter(m => m.type !== 'system')
    const threadId = config.configurable?.thread_id as string | undefined
    const handler = createCallbackHandler(threadId)

    try {
      const initialMessages = [
        new SystemMessage(RESEARCH_SYSTEM_PROMPT),
        ...conversationMessages,
        new HumanMessage('Now read the files that were written and verify the task is complete.'),
      ]

      const researchResult = await subgraph.invoke(
        { messages: initialMessages },
        { ...config, callbacks: [handler] }
      )

      // Call structuredModel directly with the research messages as context
      const { raw, parsed } = (await structuredModel.invoke(
        [new SystemMessage(SYNTHESIZE_SYSTEM_PROMPT(plan)), ...researchResult.messages],
        { callbacks: [handler] }
      )) as { raw: any; parsed: { approved: boolean; feedback: string } }

      const nextAttempts = critiqueAttempts + 1
      const nextFeedback = parsed.approved ? null : parsed.feedback
      const willRetry = nextFeedback !== null && nextAttempts <= MAX_CRITIQUE_ATTEMPTS

      const modelName = model.getName() as string | undefined
      const reasoning = raw?.additional_kwargs?.reasoning_content?.toString() ?? undefined

      if (handler.traceId) {
        langfuse.trace({ id: handler.traceId }).update({
          metadata: {
            approved: parsed.approved,
            critiqueFeedback: nextFeedback,
            critiqueAttempts: nextAttempts,
            willRetry,
            ...(modelName && { model: modelName }),
            ...(reasoning && { reasoning }),
          },
        })
      }

      return {
        critiqueAttempts: nextAttempts,
        critiqueFeedback: nextFeedback,
      }
    } catch (error) {
      console.error('[critic-subgraph] error during critique:', error)
      // On error, approve to avoid hanging the graph
      return {
        critiqueAttempts: critiqueAttempts + 1,
        critiqueFeedback: null,
      }
    }
  }
}

export function shouldRetry(state: AgentState): 'executor' | '__end__' {
  if (state.critiqueFeedback !== null && state.critiqueAttempts <= MAX_CRITIQUE_ATTEMPTS) {
    return 'executor'
  }
  return '__end__'
}
