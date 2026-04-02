import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

const SUMMARIZE_PROMPT = `Summarize the following conversation segment. Preserve:
- What files were read or modified and how
- Key decisions made
- Current state of any in-progress work
- Any errors encountered and how they were resolved

Be specific about file paths and content. This summary will replace the original messages.`

export async function summarizeMessages(
  messages: Array<BaseMessage>,
  model: BaseChatModel
): Promise<AIMessage> {
  const text = messages.map(m => `${m.type}: ${JSON.stringify(m.content)}`).join('\n\n')

  const response = await model.invoke([new SystemMessage(SUMMARIZE_PROMPT), new HumanMessage(text)])

  return new AIMessage({
    content: `[Conversation summary]\n${response.content}`,
  })
}
