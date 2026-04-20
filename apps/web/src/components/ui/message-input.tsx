'use client'

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Info, Loader2, Mic, Paperclip, Square } from 'lucide-react'
import { omit } from 'remeda'
import Fuse from 'fuse.js'
import type { ValidatedFileReference } from '@/lib/file-references'
import type { FileReferenceSuggestion } from '@/components/ui/file-reference-autocomplete'

import { cn } from '@/lib/utils'
import { useAudioRecording } from '@/hooks/use-audio-recording'
import { useAutosizeTextArea } from '@/hooks/use-autosize-textarea'
import { AudioVisualizer } from '@/components/ui/audio-visualizer'
import { Button } from '@/components/ui/button'
import { FilePreview } from '@/components/ui/file-preview'
import { InterruptPrompt } from '@/components/ui/interrupt-prompt'
import { FileReferenceAutocomplete } from '@/components/ui/file-reference-autocomplete'
import { FileReferenceChip } from '@/components/ui/file-reference-chip'
import {
  getActiveFileReferenceQuery,
  removeReferenceText,
  replaceRange,
  syncValidatedFileReferences,
} from '@/lib/file-references'

interface MessageInputBaseProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string
  filePaths?: Array<string>
  folderPaths?: Array<string>
  submitOnEnter?: boolean
  stop?: () => void
  isGenerating: boolean
  enableInterrupt?: boolean
  transcribeAudio?: (blob: Blob) => Promise<string>
}

interface MessageInputWithoutAttachmentProps extends MessageInputBaseProps {
  allowAttachments?: false
}

interface MessageInputWithAttachmentsProps extends MessageInputBaseProps {
  allowAttachments: true
  files: Array<File> | null
  setFiles: React.Dispatch<React.SetStateAction<Array<File> | null>>
}

type MessageInputProps = MessageInputWithoutAttachmentProps | MessageInputWithAttachmentsProps

export function MessageInput({
  placeholder = 'Ask AI...',
  className,
  autoFocus,
  onKeyDown: onKeyDownProp,
  submitOnEnter = true,
  stop,
  isGenerating,
  enableInterrupt = true,
  transcribeAudio,
  ...props
}: MessageInputProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [showInterruptPrompt, setShowInterruptPrompt] = useState(false)
  const [references, setReferences] = useState<Array<ValidatedFileReference>>([])
  const [activeMention, setActiveMention] = useState<{
    query: string
    start: number
    end: number
  } | null>(null)
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(0)
  const [autocompletePosition, setAutocompletePosition] = useState({ left: 12, top: 12 })
  const nextReferenceIdRef = useRef(0)
  const skipNextMentionComputeRef = useRef(false)
  const textAreaRef = useRef<HTMLTextAreaElement>(null)
  const [textAreaHeight, setTextAreaHeight] = useState<number>(0)

  const filePaths = props.filePaths ?? []
  const folders = props.folderPaths ?? []
  const searchablePaths = [
    ...folders.map(path => ({
      path,
      name: path.split('/').pop() ?? path,
      kind: 'folder' as const,
    })),
    ...filePaths.map(path => ({
      path,
      name: path.split('/').pop() ?? path,
      kind: 'file' as const,
    })),
  ]
  const fuse = new Fuse(searchablePaths, {
    keys: ['path', 'name'],
    includeScore: true,
    threshold: 0.4,
    shouldSort: true,
  })

  const mentionSuggestions: Array<FileReferenceSuggestion> = activeMention
    ? activeMention.query
      ? fuse
          .search(activeMention.query, { limit: 24 })
          .map(result => ({ ...result.item, score: result.score ?? 1 }))
          .sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
            if (a.score !== b.score) return a.score - b.score
            return a.path.localeCompare(b.path)
          })
          .slice(0, 8)
          .map(item => ({ kind: item.kind, path: item.path }))
      : [
          ...folders.map(path => ({ kind: 'folder' as const, path })),
          ...filePaths.map(path => ({ kind: 'file' as const, path })),
        ].slice(0, 8)
    : []

  const showReferenceList = references.length > 0
  const showFileList = props.allowAttachments && props.files && props.files.length > 0
  const knownPaths = new Set([...folders, ...filePaths])
  const activeMentionQuery = activeMention?.query ?? ''
  const normalizedMentionQuery = activeMentionQuery.replace(/[.,!?;:)\]}]+$/g, '')
  const isKnownResolvedQuery =
    normalizedMentionQuery.length > 0 && knownPaths.has(normalizedMentionQuery)
  const isReferencedResolvedQuery =
    normalizedMentionQuery.length > 0 &&
    references.some(reference => reference.path === normalizedMentionQuery)
  const hasTrailingPunctuation = normalizedMentionQuery.length < activeMentionQuery.length
  const shouldSuppressAutocomplete =
    isKnownResolvedQuery &&
    (hasTrailingPunctuation ||
      activeMentionQuery === normalizedMentionQuery ||
      isReferencedResolvedQuery)
  const showAutocomplete = !!activeMention && !shouldSuppressAutocomplete
  const highlightedSuggestionIndex =
    mentionSuggestions.length > 0
      ? Math.min(highlightedSuggestion, mentionSuggestions.length - 1)
      : 0

  const emitChange = (value: string) => {
    props.onChange?.({
      target: { value },
      currentTarget: { value },
    } as React.ChangeEvent<HTMLTextAreaElement>)
  }

  const recomputeActiveMention = () => {
    if (skipNextMentionComputeRef.current) {
      skipNextMentionComputeRef.current = false
      setActiveMention(null)
      return
    }

    const element = textAreaRef.current
    if (!element) return

    const currentMention = getActiveFileReferenceQuery(
      element.value,
      element.selectionStart,
      element.selectionEnd
    )

    setActiveMention(currentMention)
    setHighlightedSuggestion(0)

    if (!currentMention) return

    const coordinates = getCaretCoordinates(element, currentMention.end)
    setAutocompletePosition({
      left: Math.max(12, Math.min(coordinates.left + 12, element.clientWidth - 320)),
      top: Math.max(12, coordinates.top + coordinates.lineHeight + 14),
    })
  }

  const {
    isListening,
    isSpeechSupported,
    isRecording,
    isTranscribing,
    audioStream,
    toggleListening,
    stopRecording,
  } = useAudioRecording({
    transcribeAudio,
    onTranscriptionComplete: text => {
      emitChange(text)
    },
  })

  useEffect(() => {
    if (!isGenerating) {
      setShowInterruptPrompt(false)
    }
  }, [isGenerating])

  useEffect(() => {
    const allowedPathSet = new Set([...(props.filePaths ?? []), ...(props.folderPaths ?? [])])
    setReferences(current => {
      return syncValidatedFileReferences(props.value, current).filter(reference =>
        allowedPathSet.has(reference.path)
      )
    })
  }, [props.value, props.filePaths, props.folderPaths])

  const imageFiles = (files: Array<File> | null) =>
    files?.filter(file => file.type.startsWith('image/')) ?? null

  const hasImageDragItems = (items: DataTransferItemList) =>
    Array.from(items).some(item => item.kind === 'file' && item.type.startsWith('image/'))

  const addFiles = (files: Array<File> | null) => {
    if (props.allowAttachments) {
      const nextFiles = imageFiles(files)
      if (!nextFiles?.length) return

      props.setFiles(currentFiles => {
        if (currentFiles === null) return nextFiles

        return [...currentFiles, ...nextFiles]
      })
    }
  }

  const onDragOver = (event: React.DragEvent) => {
    if (props.allowAttachments !== true) return
    if (!hasImageDragItems(event.dataTransfer.items)) return
    event.preventDefault()
    setIsDragging(true)
  }

  const onDragLeave = (event: React.DragEvent) => {
    if (props.allowAttachments !== true) return
    event.preventDefault()
    setIsDragging(false)
  }

  const onDrop = (event: React.DragEvent) => {
    setIsDragging(false)
    if (props.allowAttachments !== true) return
    event.preventDefault()
    const dataTransfer = event.dataTransfer
    if (dataTransfer.files.length) {
      addFiles(Array.from(dataTransfer.files))
    }
  }

  const onPaste = (event: React.ClipboardEvent) => {
    const items = event.clipboardData.items
    if (items.length === 0) return

    const files = Array.from(items)
      .map(item => item.getAsFile())
      .filter((file): file is File => file !== null && file.type.startsWith('image/'))

    if (props.allowAttachments && files.length > 0) {
      addFiles(files)
    }
  }

  const selectFilePath = (suggestion: FileReferenceSuggestion) => {
    if (!activeMention) return

    const element = textAreaRef.current
    if (!element) return

    const path = suggestion.path
    const mentionText = `@${path}`
    const nextValue = replaceRange(props.value, activeMention.start, activeMention.end, mentionText)
    const mentionStart = activeMention.start
    const mentionEnd = mentionStart + mentionText.length
    const nextReference: ValidatedFileReference = {
      id: String(nextReferenceIdRef.current++),
      path,
      mentionText,
      start: mentionStart,
      end: mentionEnd,
    }

    emitChange(nextValue)
    setReferences(current => [...current, nextReference])
    setActiveMention(null)
    setHighlightedSuggestion(0)
    skipNextMentionComputeRef.current = true

    requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(mentionEnd, mentionEnd)
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showAutocomplete) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (mentionSuggestions.length > 0) {
          setHighlightedSuggestion(current => (current + 1) % mentionSuggestions.length)
        }
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (mentionSuggestions.length > 0) {
          setHighlightedSuggestion(current =>
            current === 0 ? mentionSuggestions.length - 1 : current - 1
          )
        }
        return
      }

      if ((event.key === 'Enter' || event.key === 'Tab') && mentionSuggestions.length > 0) {
        event.preventDefault()
        selectFilePath(mentionSuggestions[highlightedSuggestionIndex])
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        setActiveMention(null)
        return
      }
    }

    if (submitOnEnter && event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()

      if (isGenerating && stop && enableInterrupt) {
        if (showInterruptPrompt) {
          stop()
          setShowInterruptPrompt(false)
          event.currentTarget.form?.requestSubmit()
        } else if (props.value || (props.allowAttachments && props.files?.length)) {
          setShowInterruptPrompt(true)
          return
        }
      }

      event.currentTarget.form?.requestSubmit()
    }

    onKeyDownProp?.(event)
  }

  useEffect(() => {
    if (textAreaRef.current) {
      setTextAreaHeight(textAreaRef.current.offsetHeight)
    }
  }, [props.value])

  useAutosizeTextArea({
    ref: textAreaRef as React.RefObject<HTMLTextAreaElement>,
    maxHeight: 240,
    borderWidth: 1,
    dependencies: [props.value, showFileList, showReferenceList],
  })

  return (
    <div
      className="relative flex w-full"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {enableInterrupt && (
        <InterruptPrompt isOpen={showInterruptPrompt} close={() => setShowInterruptPrompt(false)} />
      )}

      <RecordingPrompt isVisible={isRecording} onStopRecording={stopRecording} />

      <div className="relative flex w-full items-center space-x-2">
        <div className="relative flex-1">
          <textarea
            aria-label="Write your prompt here"
            autoFocus={autoFocus}
            placeholder={placeholder}
            ref={textAreaRef}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onClick={recomputeActiveMention}
            onBlur={() => setActiveMention(null)}
            onSelect={recomputeActiveMention}
            onKeyUp={event => {
              if (
                event.key === 'ArrowUp' ||
                event.key === 'ArrowDown' ||
                event.key === 'Escape' ||
                event.key === 'Enter' ||
                event.key === 'Tab'
              ) {
                return
              }
              recomputeActiveMention()
            }}
            onChange={event => {
              emitChange(event.target.value)
              requestAnimationFrame(recomputeActiveMention)
            }}
            className={cn(
              'z-10 w-full grow resize-none rounded-xl border border-input bg-background text-foreground p-3 pr-24 text-sm ring-offset-background transition-[border] placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              showReferenceList && showFileList && 'pb-28',
              showReferenceList && !showFileList && 'pb-14',
              !showReferenceList && showFileList && 'pb-16',
              className
            )}
            {...(props.allowAttachments
              ? omit(props, [
                  'allowAttachments',
                  'files',
                  'setFiles',
                  'filePaths',
                  'folderPaths',
                  'onChange',
                  'onKeyDown',
                  'onPaste',
                ])
              : omit(props, [
                  'allowAttachments',
                  'filePaths',
                  'folderPaths',
                  'onChange',
                  'onKeyDown',
                  'onPaste',
                ]))}
          />

          {(showReferenceList || props.allowAttachments) && (
            <div className="absolute inset-x-3 bottom-0 z-20 py-2">
              <div className="flex flex-col gap-2">
                {showReferenceList && (
                  <div className="flex flex-wrap gap-2">
                    {references.map(reference => (
                      <FileReferenceChip
                        key={reference.id}
                        path={reference.path}
                        onRemove={() => {
                          const nextValue = removeReferenceText(props.value, reference)
                          emitChange(nextValue)
                          setReferences(current =>
                            current.filter(currentReference => currentReference.id !== reference.id)
                          )
                          requestAnimationFrame(() => {
                            const textArea = textAreaRef.current
                            if (!textArea) return
                            textArea.focus()
                            textArea.setSelectionRange(reference.start, reference.start)
                            recomputeActiveMention()
                          })
                        }}
                      />
                    ))}
                  </div>
                )}

                {props.allowAttachments && (
                  <div className="overflow-x-auto">
                    <div className="flex space-x-3 pb-1">
                      <AnimatePresence mode="popLayout">
                        {props.files?.map(file => {
                          return (
                            <FilePreview
                              key={file.name + String(file.lastModified)}
                              file={file}
                              onRemove={() => {
                                props.setFiles(files => {
                                  if (!files) return null

                                  const filtered = Array.from(files).filter(f => f !== file)
                                  if (filtered.length === 0) return null
                                  return filtered
                                })
                              }}
                            />
                          )
                        })}
                      </AnimatePresence>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <FileReferenceAutocomplete
            isOpen={showAutocomplete}
            suggestions={mentionSuggestions}
            highlightedIndex={highlightedSuggestionIndex}
            onSelect={selectFilePath}
            onClose={() => setActiveMention(null)}
            position={autocompletePosition}
          />
        </div>
      </div>

      <div className="absolute right-3 top-3 z-20 flex gap-2">
        {props.allowAttachments && (
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            aria-label="Attach a file"
            onClick={async () => {
              const files = await showFileUploadDialog()
              addFiles(files)
            }}
          >
            <Paperclip className="h-4 w-4" />
          </Button>
        )}
        {isSpeechSupported && (
          <Button
            type="button"
            variant="outline"
            className={cn('h-8 w-8', isListening && 'text-primary')}
            aria-label="Voice input"
            size="icon"
            onClick={toggleListening}
          >
            <Mic className="h-4 w-4" />
          </Button>
        )}
        {isGenerating && stop ? (
          <Button
            type="button"
            size="icon"
            className="h-8 w-8"
            aria-label="Stop generating"
            onClick={stop}
          >
            <Square className="h-3 w-3 animate-pulse" fill="currentColor" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            className="h-8 w-8 transition-opacity"
            aria-label="Send message"
            disabled={
              isGenerating ||
              (props.value === '' && !(props.allowAttachments && props.files?.length))
            }
          >
            <ArrowUp className="h-5 w-5" />
          </Button>
        )}
      </div>

      {props.allowAttachments && <FileUploadOverlay isDragging={isDragging} />}

      <RecordingControls
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        audioStream={audioStream}
        textAreaHeight={textAreaHeight}
        onStopRecording={stopRecording}
      />
    </div>
  )
}
MessageInput.displayName = 'MessageInput'

interface FileUploadOverlayProps {
  isDragging: boolean
}

function FileUploadOverlay({ isDragging }: FileUploadOverlayProps) {
  return (
    <AnimatePresence>
      {isDragging && (
        <motion.div
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center space-x-2 rounded-xl border border-dashed border-border bg-background text-sm text-muted-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden
        >
          <Paperclip className="h-4 w-4" />
          <span>Drop your images here to attach them.</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function showFileUploadDialog() {
  const input = document.createElement('input')

  input.type = 'file'
  input.multiple = true
  input.accept = 'image/*'
  input.click()

  return new Promise<Array<File> | null>(resolve => {
    input.onchange = e => {
      const files = (e.currentTarget as HTMLInputElement).files

      if (files) {
        resolve(Array.from(files).filter(file => file.type.startsWith('image/')))
        return
      }

      resolve(null)
    }
  })
}

function getCaretCoordinates(textArea: HTMLTextAreaElement, position: number) {
  const style = window.getComputedStyle(textArea)
  const mirror = document.createElement('div')
  const marker = document.createElement('span')

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordWrap = 'break-word'
  mirror.style.overflow = 'hidden'
  mirror.style.font = style.font
  mirror.style.padding = style.padding
  mirror.style.border = style.border
  mirror.style.letterSpacing = style.letterSpacing
  mirror.style.lineHeight = style.lineHeight
  mirror.style.width = `${textArea.clientWidth}px`

  mirror.textContent = textArea.value.slice(0, position)
  marker.textContent = textArea.value.slice(position) || '.'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)

  const top = marker.offsetTop - textArea.scrollTop
  const left = marker.offsetLeft - textArea.scrollLeft
  const lineHeight = Number.parseFloat(style.lineHeight || '20') || 20

  document.body.removeChild(mirror)

  return { left, top, lineHeight }
}

function TranscribingOverlay() {
  return (
    <motion.div
      className="flex h-full w-full flex-col items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="relative">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <motion.div
          className="absolute inset-0 h-8 w-8 animate-pulse rounded-full bg-primary/20"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1.2, opacity: 1 }}
          transition={{
            duration: 1,
            repeat: Infinity,
            repeatType: 'reverse',
            ease: 'easeInOut',
          }}
        />
      </div>
      <p className="mt-4 text-sm font-medium text-muted-foreground">Transcribing audio...</p>
    </motion.div>
  )
}

interface RecordingPromptProps {
  isVisible: boolean
  onStopRecording: () => void
}

function RecordingPrompt({ isVisible, onStopRecording }: RecordingPromptProps) {
  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ top: 0, filter: 'blur(5px)' }}
          animate={{
            top: -40,
            filter: 'blur(0px)',
            transition: {
              type: 'spring',
              filter: { type: 'tween' },
            },
          }}
          exit={{ top: 0, filter: 'blur(5px)' }}
          className="absolute left-1/2 flex -translate-x-1/2 cursor-pointer overflow-hidden whitespace-nowrap rounded-full border bg-background py-1 text-center text-sm text-muted-foreground"
          onClick={onStopRecording}
        >
          <span className="mx-2.5 flex items-center">
            <Info className="mr-2 h-3 w-3" />
            Click to finish recording
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface RecordingControlsProps {
  isRecording: boolean
  isTranscribing: boolean
  audioStream: MediaStream | null
  textAreaHeight: number
  onStopRecording: () => void
}

function RecordingControls({
  isRecording,
  isTranscribing,
  audioStream,
  textAreaHeight,
  onStopRecording,
}: RecordingControlsProps) {
  if (isRecording) {
    return (
      <div
        className="absolute inset-[1px] z-50 overflow-hidden rounded-xl"
        style={{ height: textAreaHeight - 2 }}
      >
        <AudioVisualizer stream={audioStream} isRecording={isRecording} onClick={onStopRecording} />
      </div>
    )
  }

  if (isTranscribing) {
    return (
      <div
        className="absolute inset-[1px] z-50 overflow-hidden rounded-xl"
        style={{ height: textAreaHeight - 2 }}
      >
        <TranscribingOverlay />
      </div>
    )
  }

  return null
}
