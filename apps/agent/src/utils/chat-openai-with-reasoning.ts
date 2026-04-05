import { ChatOpenAI } from '@langchain/openai'
import { AIMessageChunk } from '@langchain/core/messages'

export class ChatOpenAIWithReasoning extends ChatOpenAI {
  private shouldUseApproximateTokenCount(): boolean {
    // @ts-expect-error - modelName is not typed
    const modelName = this.modelName
    return modelName.includes('/') || modelName.startsWith('qwen')
  }

  private approximateTokenCount(content: unknown): number {
    const text =
      typeof content === 'string' ? content : content == null ? '' : JSON.stringify(content)

    return Math.ceil(text.length / 4)
  }

  override async getNumTokens(content: unknown): Promise<number> {
    if (this.shouldUseApproximateTokenCount()) {
      return this.approximateTokenCount(content)
    }

    try {
      return await super.getNumTokens(content as any)
    } catch {
      return this.approximateTokenCount(content)
    }
  }

  _convertOpenAIDeltaToBaseMessageChunk(delta: any, rawResponse: any, defaultRole: any) {
    // @ts-expect-error - _convertOpenAIDeltaToBaseMessageChunk is not typed
    const chunk = super._convertOpenAIDeltaToBaseMessageChunk(
      delta,
      rawResponse,
      defaultRole ?? 'assistant'
    )
    if (delta.reasoning_content && chunk instanceof AIMessageChunk) {
      chunk.additional_kwargs.reasoning_content =
        (chunk.additional_kwargs.reasoning_content ?? '') + delta.reasoning_content
    }
    return chunk
  }
}
