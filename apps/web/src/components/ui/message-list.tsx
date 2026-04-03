import type { ChatMessageProps, Message, PhaseGroup } from '@/components/ui/chat-message'
import { ChatMessage, PhaseBlock } from '@/components/ui/chat-message'
import { TypingIndicator } from '@/components/ui/typing-indicator'

export type MessageListItem = Message | PhaseGroup

function isPhaseGroup(item: MessageListItem): item is PhaseGroup {
  return 'phase' in item
}

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
      {messages.map((item, index) => {
        if (isPhaseGroup(item)) {
          if (item.messages.length === 0) return null
          return <PhaseBlock key={`phase-${item.phase.name}-${index}`} group={item} />
        }

        const additionalOptions =
          typeof messageOptions === 'function' ? messageOptions(item) : messageOptions

        return (
          <ChatMessage
            key={index}
            showTimeStamp={showTimeStamps}
            {...item}
            {...additionalOptions}
          />
        )
      })}
      {isTyping && <TypingIndicator />}
    </div>
  )
}
