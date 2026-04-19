import { BaseMessage, filterMessages } from '@langchain/core/messages'
import type { Message } from '@langchain/langgraph-sdk'

export const toMessageUnion = (message: BaseMessage): Message => {
  return { ...message.toDict().data, type: message.type } as Message
}

export function serializeMessages(messages: Array<BaseMessage>): Array<Message> {
  return filterMessages(messages.filter(BaseMessage.isInstance), {
    excludeTypes: ['system'],
  }).map(toMessageUnion)
}
