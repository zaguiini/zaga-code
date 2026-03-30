import { describe, expect, it, vi } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { createExecutorNode } from '@/nodes/executor'

const makeModelWithTools = (responseContent: string) => ({
  invoke: vi.fn().mockResolvedValue(new AIMessage(responseContent)),
})

describe('createExecutorNode', () => {
  it('returns model response as messages update', async () => {
    const model = makeModelWithTools('Here is your answer')
    const node = createExecutorNode(model as any)
    const result = await node(
      {
        messages: [new HumanMessage('what does this do?')],
        complexity: 'simple',
        planningDepth: 'brief',
        plan: null,
        critiqueAttempts: 0,
        critiqueFeedback: null,
      },
      { context: { project_path: '/tmp/project' } } as any
    )
    expect(result.messages).toHaveLength(1)
    expect((result.messages![0] as AIMessage).content).toBe('Here is your answer')
  })

  it('includes plan in system prompt when plan is present', async () => {
    const model = makeModelWithTools('done')
    const node = createExecutorNode(model as any)
    await node(
      {
        messages: [new HumanMessage('fix the bug')],
        complexity: 'medium',
        planningDepth: 'detailed',
        plan: '1. Read buggy.ts\n2. Fix the off-by-one error',
        critiqueAttempts: 0,
        critiqueFeedback: null,
      },
      { context: { project_path: '/tmp/project' } } as any
    )
    const invokedMessages = model.invoke.mock.calls[0][0] as Array<unknown>
    const systemMsg = invokedMessages[0] as { content: string }
    expect(systemMsg.content).toContain('1. Read buggy.ts')
  })

  it('includes critique feedback in system prompt on retry', async () => {
    const model = makeModelWithTools('fixed')
    const node = createExecutorNode(model as any)
    await node(
      {
        messages: [new HumanMessage('fix the bug')],
        complexity: 'medium',
        planningDepth: 'detailed',
        plan: '1. Read buggy.ts',
        critiqueAttempts: 1,
        critiqueFeedback: 'You forgot to handle the null case in line 42',
      },
      { context: { project_path: '/tmp/project' } } as any
    )
    const invokedMessages = model.invoke.mock.calls[0][0] as Array<unknown>
    const systemMsg = invokedMessages[0] as { content: string }
    expect(systemMsg.content).toContain('null case in line 42')
  })
})
