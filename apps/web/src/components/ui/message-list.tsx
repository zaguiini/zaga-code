import type { ChatMessageProps, Message } from '@/components/ui/chat-message'
import { ChatMessage } from '@/components/ui/chat-message'
import { TypingIndicator } from '@/components/ui/typing-indicator'

export type MessageListItem = Message

type AdditionalMessageOptions = Omit<ChatMessageProps, keyof Message>

interface MessageListProps {
  messages: Array<MessageListItem>
  showTimeStamps?: boolean
  isTyping?: boolean
  messageOptions?: AdditionalMessageOptions | ((message: Message) => AdditionalMessageOptions)
}

export function MessageList({
  messages,
  showTimeStamps = true,
  isTyping = false,
  messageOptions,
}: MessageListProps) {
  return (
    <div className="space-y-4 overflow-visible">
      {messages.map(message => {
        const additionalOptions =
          typeof messageOptions === 'function' ? messageOptions(message) : messageOptions

        return (
          <ChatMessage
            key={`${message.id}-${message.parts?.[0]?.type ?? 'user'}`}
            showTimeStamp={showTimeStamps}
            {...message}
            {...additionalOptions}
          />
        )
      })}
      {isTyping && <TypingIndicator />}
    </div>
  )
}
