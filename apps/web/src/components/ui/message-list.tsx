import { ChevronRight, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { ChatMessageProps, Message } from '@/components/ui/chat-message'
import { ChatMessage } from '@/components/ui/chat-message'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { TypingIndicator } from '@/components/ui/typing-indicator'
import { cn } from '@/lib/utils'

export type MessageListItem = Message

type AdditionalMessageOptions = Omit<ChatMessageProps, keyof Message>
type RenderableItem =
  | { kind: 'message'; message: Message }
  | { kind: 'operation-group'; messages: Array<Message> }

interface MessageListProps {
  messages: Array<MessageListItem>
  showTimeStamps?: boolean
  isTyping?: boolean
  groupOperationMessages?: boolean
  messageOptions?: AdditionalMessageOptions | ((message: Message) => AdditionalMessageOptions)
}

function isOperationMessage(message: Message): boolean {
  if (message.role !== 'assistant') return false
  const part = message.parts?.[0]
  if (!part) return false
  return (
    part.type === 'reasoning' || part.type === 'tool-invocation' || part.type === 'command-result'
  )
}

function isOperationInProgress(message: Message): boolean {
  const part = message.parts?.[0]
  if (!part) return false
  if (part.type === 'reasoning') return part.done !== true
  if (part.type === 'tool-invocation') {
    return part.toolInvocation.state === 'call' || part.toolInvocation.state === 'streaming'
  }
  return false
}

function groupMessages(messages: Array<Message>): Array<RenderableItem> {
  const grouped: Array<RenderableItem> = []
  let i = 0

  while (i < messages.length) {
    const current = messages[i]

    if (!isOperationMessage(current)) {
      grouped.push({ kind: 'message', message: current })
      i += 1
      continue
    }

    let j = i
    while (j < messages.length && isOperationMessage(messages[j])) {
      j += 1
    }

    const chunk = messages.slice(i, j)
    if (chunk.length >= 2) {
      grouped.push({ kind: 'operation-group', messages: chunk })
    } else {
      grouped.push({ kind: 'message', message: current })
    }

    i = j
  }

  return grouped
}

function MessageItem({
  message,
  showTimeStamps,
  messageOptions,
}: {
  message: Message
  showTimeStamps: boolean
  messageOptions?: AdditionalMessageOptions | ((message: Message) => AdditionalMessageOptions)
}) {
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
}

function OperationGroup({
  messages,
  showTimeStamps,
  messageOptions,
}: {
  messages: Array<Message>
  showTimeStamps: boolean
  messageOptions?: AdditionalMessageOptions | ((message: Message) => AdditionalMessageOptions)
}) {
  const hasInProgress = messages.some(isOperationInProgress)
  const [isOpen, setIsOpen] = useState(hasInProgress)
  const title = hasInProgress ? 'Working...' : `${messages.length} operations`

  return (
    <div className="flex flex-col items-start sm:max-w-[70%]">
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="w-full overflow-hidden rounded-lg border bg-muted/50"
      >
        <div className="flex items-center p-2">
          <CollapsibleTrigger asChild>
            <button className="flex w-full cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              {hasInProgress ? (
                <Loader2 className="size-3 mx-0.5 animate-spin" />
              ) : (
                <ChevronRight
                  className={cn('size-4 transition-transform', isOpen && 'rotate-90')}
                />
              )}
              <span>{title}</span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="w-full border-t p-2">
            <div className="space-y-2">
              {messages.map(message => (
                <MessageItem
                  key={`grouped-${message.id}-${message.parts?.[0]?.type ?? 'user'}`}
                  message={message}
                  showTimeStamps={showTimeStamps}
                  messageOptions={messageOptions}
                />
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function MessageList({
  messages,
  showTimeStamps = true,
  isTyping = false,
  groupOperationMessages = false,
  messageOptions,
}: MessageListProps) {
  const items = groupOperationMessages
    ? groupMessages(messages)
    : messages.map(message => ({ kind: 'message' as const, message }))

  return (
    <div className="space-y-4 overflow-visible">
      {items.map((item, index) => {
        if (item.kind === 'operation-group') {
          const first = item.messages[0]?.id ?? index
          const last = item.messages[item.messages.length - 1]?.id ?? index
          return (
            <OperationGroup
              key={`operation-group-${first}-${last}`}
              messages={item.messages}
              showTimeStamps={showTimeStamps}
              messageOptions={messageOptions}
            />
          )
        }

        return (
          <MessageItem
            key={`${item.message.id}-${item.message.parts?.[0]?.type ?? 'user'}`}
            message={item.message}
            showTimeStamps={showTimeStamps}
            messageOptions={messageOptions}
          />
        )
      })}
      {isTyping && <TypingIndicator />}
    </div>
  )
}
