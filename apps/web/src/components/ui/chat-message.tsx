import React, { useMemo, useState } from 'react'
import { cva } from 'class-variance-authority'
import { motion } from 'framer-motion'
import { ChevronRight, Code2, ListChecks, Loader2, Search, ShieldCheck } from 'lucide-react'
import type { VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { FilePreview } from '@/components/ui/file-preview'
import { MarkdownRenderer } from '@/components/ui/markdown-renderer'

const chatBubbleVariants = cva(
  'group/message relative break-words rounded-lg p-3 text-sm sm:max-w-[70%]',
  {
    variants: {
      isUser: {
        true: 'bg-primary text-primary-foreground',
        false: 'bg-muted text-foreground',
      },
      animation: {
        none: '',
        slide: 'duration-300 animate-in fade-in-0',
        scale: 'duration-300 animate-in fade-in-0 zoom-in-75',
        fade: 'duration-500 animate-in fade-in-0',
      },
    },
    compoundVariants: [
      {
        isUser: true,
        animation: 'slide',
        class: 'slide-in-from-right',
      },
      {
        isUser: false,
        animation: 'slide',
        class: 'slide-in-from-left',
      },
      {
        isUser: true,
        animation: 'scale',
        class: 'origin-bottom-right',
      },
      {
        isUser: false,
        animation: 'scale',
        class: 'origin-bottom-left',
      },
    ],
  }
)

type Animation = VariantProps<typeof chatBubbleVariants>['animation']

interface Attachment {
  name?: string
  contentType?: string
  url: string
}

interface PartialToolCall {
  state: 'partial-call'
  toolName: string
  args: Record<string, any>
}

interface ToolCall {
  state: 'call'
  toolName: string
  args: Record<string, any>
}

interface ToolResult {
  state: 'result'
  toolName: string
  args: Record<string, any>
  result: string
  // result: {
  //   __cancelled?: boolean
  //   [key: string]: any
  // }
}

type ToolInvocation = PartialToolCall | ToolCall | ToolResult

interface ReasoningPart {
  type: 'reasoning'
  reasoning: string
  done?: boolean
  durationMs?: number
}

export interface ToolInvocationPart {
  type: 'tool-invocation'
  toolInvocation: ToolInvocation
}

interface TextPart {
  type: 'text'
  text: string
}

// For compatibility with AI SDK types, not used
interface SourcePart {
  type: 'source'
  source?: any
}

interface FilePart {
  type: 'file'
  mimeType: string
  data: string
}

interface StepStartPart {
  type: 'step-start'
}

type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolInvocationPart
  | SourcePart
  | FilePart
  | StepStartPart

export interface Message {
  id: string
  role: 'user' | 'assistant' | (string & {})
  content: string
  createdAt?: Date
  experimental_attachments?: Array<Attachment>
  parts?: Array<MessagePart>
}

export interface PhaseInfo {
  name: 'explore' | 'plan' | 'verify'
  startIdx: number
  endIdx: number | null
}

export interface PhaseGroup {
  type: 'phase-group'
  phase: PhaseInfo
  messages: Array<Message>
}

export interface ChatMessageProps extends Message {
  showTimeStamp?: boolean
  animation?: Animation
  actions?: React.ReactNode
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
  role,
  content,
  createdAt,
  showTimeStamp = false,
  animation = 'scale',
  actions,
  experimental_attachments,
  parts,
}) => {
  const files = useMemo(() => {
    return experimental_attachments?.map(attachment => {
      const dataArray = dataUrlToUint8Array(attachment.url)
      const file = new File([dataArray], attachment.name ?? 'Unknown', {
        type: attachment.contentType,
      })
      return file
    })
  }, [experimental_attachments])

  const isUser = role === 'user'

  const formattedTime = createdAt?.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })

  if (isUser) {
    return (
      <div className="flex flex-col items-end">
        {files ? (
          <div className="mb-1 flex flex-wrap gap-2">
            {files.map((file, index) => {
              return <FilePreview file={file} key={index} />
            })}
          </div>
        ) : null}

        <div className={cn(chatBubbleVariants({ isUser, animation }))}>
          <MarkdownRenderer>{content}</MarkdownRenderer>
        </div>

        {showTimeStamp && createdAt ? (
          <time
            dateTime={createdAt.toISOString()}
            className={cn(
              'mt-1 block px-1 text-xs opacity-50',
              animation !== 'none' && 'duration-500 animate-in fade-in-0'
            )}
          >
            {formattedTime}
          </time>
        ) : null}
      </div>
    )
  }

  if (!parts) return null

  return parts.map((part, index) => {
    if (part.type === 'text') {
      return (
        <div className="flex flex-col items-start" key={`text-${index}`}>
          <div className={cn(chatBubbleVariants({ isUser, animation }))}>
            <MarkdownRenderer>{part.text}</MarkdownRenderer>
            {actions ? (
              <div className="absolute -bottom-4 right-2 flex space-x-1 rounded-lg border bg-background p-1 text-foreground opacity-0 transition-opacity group-hover/message:opacity-100">
                {actions}
              </div>
            ) : null}
          </div>

          {showTimeStamp && createdAt ? (
            <time
              dateTime={createdAt.toISOString()}
              className={cn(
                'mt-1 block px-1 text-xs opacity-50',
                animation !== 'none' && 'duration-500 animate-in fade-in-0'
              )}
            >
              {formattedTime}
            </time>
          ) : null}
        </div>
      )
    } else if (part.type === 'reasoning') {
      return <ReasoningBlock key={`reasoning-${index}`} part={part} />
    } else if (part.type === 'tool-invocation') {
      return <ToolCall key={`tool-${index}`} toolInvocations={[part.toolInvocation]} />
    }
    return null
  })
}

function dataUrlToUint8Array(data: string) {
  const base64 = data.split(',')[1]
  const buf = Buffer.from(base64, 'base64')
  return new Uint8Array(buf)
}

const CollapsibleBlock = ({
  icon,
  title,
  children,
  defaultOpen = false,
}: {
  icon?: React.ReactNode
  title: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  const chevron = (
    <ChevronRight className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-90')} />
  )

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
              {isOpen ? chevron : (icon ?? chevron)}
              <span>{title}</span>
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent forceMount>
          <motion.div
            initial={false}
            animate={isOpen ? 'open' : 'closed'}
            variants={{
              open: { height: 'auto', opacity: 1 },
              closed: { height: 0, opacity: 0 },
            }}
            transition={{ duration: 0.3, ease: [0.04, 0.62, 0.23, 0.98] }}
            className="border-t"
          >
            <div className="p-2">
              <div className="whitespace-pre-wrap text-xs">{children}</div>
            </div>
          </motion.div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remaining = seconds % 60
  return remaining > 0 ? `${minutes}m ${remaining}s` : `${minutes}m`
}

const ReasoningBlock = ({ part }: { part: ReasoningPart }) => {
  const label = part.done ? 'Thought' : 'Thinking'
  const duration = part.done && part.durationMs ? ` for ${formatDuration(part.durationMs)}` : ''

  return (
    <CollapsibleBlock title={`${label}${duration}`} defaultOpen={!part.done}>
      {part.reasoning}
    </CollapsibleBlock>
  )
}

const PHASE_CONFIG = {
  explore: { runningLabel: 'Exploring codebase', doneLabel: 'Explored codebase', Icon: Search },
  plan: { runningLabel: 'Planning', doneLabel: 'Planned implementation', Icon: ListChecks },
  verify: { runningLabel: 'Verifying', doneLabel: 'Verified implementation', Icon: ShieldCheck },
} as const

export function PhaseBlock({ group }: { group: PhaseGroup }) {
  const config = PHASE_CONFIG[group.phase.name]
  const isRunning = group.phase.endIdx === null
  const label = isRunning ? config.runningLabel : config.doneLabel
  const icon = isRunning ? (
    <Loader2 className="h-3 w-3 animate-spin" />
  ) : (
    <config.Icon className="h-4 w-4" />
  )

  return (
    <CollapsibleBlock icon={icon} title={label}>
      <div className="space-y-3">
        {group.messages.map((message, index) => (
          <ChatMessage key={index} {...message} animation="none" />
        ))}
      </div>
    </CollapsibleBlock>
  )
}

function ToolCall({ toolInvocations }: { toolInvocations?: Array<ToolInvocation> }) {
  if (!toolInvocations?.length) return null

  return (
    <div className="flex flex-col items-start gap-2">
      {toolInvocations.map((invocation, index) => {
        // const isCancelled = invocation.state === 'result' && invocation.result.__cancelled === true

        // if (isCancelled) {
        //   return (
        //     <div
        //       key={index}
        //       className="flex items-center gap-2 rounded-lg border bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
        //     >
        //       <Ban className="h-4 w-4" />
        //       <span>
        //         Cancelled{' '}
        //         <span className="font-mono">
        //           {'`'}
        //           {invocation.toolName}
        //           {'`'}
        //         </span>
        //       </span>
        //     </div>
        //   )
        // }

        switch (invocation.state) {
          case 'partial-call':
          case 'call':
            return (
              <CollapsibleBlock
                key={index}
                icon={<Loader2 className="h-3 w-3 animate-spin" />}
                title={
                  <span>
                    Calling{' '}
                    <span className="font-mono text-xs">
                      {'`'}
                      {invocation.toolName}
                      {'`'}
                    </span>
                    ...
                  </span>
                }
              >
                Arguments: {JSON.stringify(invocation.args)}
              </CollapsibleBlock>
            )
          case 'result':
            return (
              <CollapsibleBlock
                key={index}
                icon={<Code2 className="h-4 w-4" />}
                title={
                  <span>
                    Result from{' '}
                    <span className="font-mono text-xs">
                      {'`'}
                      {invocation.toolName}
                      {'`'}
                    </span>
                  </span>
                }
              >
                <pre className="mb-2">Arguments: {JSON.stringify(invocation.args)}</pre>
                {invocation.result}
              </CollapsibleBlock>
            )
          default:
            return null
        }
      })}
    </div>
  )
}
