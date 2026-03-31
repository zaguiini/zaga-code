import { ChatOpenAI } from '@langchain/openai'
import { AIMessageChunk } from '@langchain/core/messages'

export class ChatOpenAIWithReasoning extends ChatOpenAI {
  _convertOpenAIDeltaToBaseMessageChunk(delta: any, rawResponse: any, defaultRole: any) {
    const chunk = super._convertOpenAIDeltaToBaseMessageChunk(delta, rawResponse, defaultRole)
    if (delta.reasoning_content && chunk instanceof AIMessageChunk) {
      chunk.additional_kwargs.reasoning_content =
        (chunk.additional_kwargs.reasoning_content ?? '') + delta.reasoning_content
    }
    return chunk
  }
}
