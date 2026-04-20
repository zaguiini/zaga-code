import { useEffect, useRef } from 'react'
import { FileIcon, FolderIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'

export type FileReferenceSuggestion = {
  kind: 'file' | 'folder'
  path: string
}

interface FileReferenceAutocompleteProps {
  isOpen: boolean
  suggestions: Array<FileReferenceSuggestion>
  highlightedIndex: number
  onSelect: (suggestion: FileReferenceSuggestion) => void
  onClose: () => void
  position: { left: number; top: number }
}

export function FileReferenceAutocomplete({
  isOpen,
  suggestions,
  highlightedIndex,
  onSelect,
  onClose,
  position,
}: FileReferenceAutocompleteProps) {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!isOpen) return
    const activeItem = itemRefs.current[highlightedIndex]
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, isOpen, suggestions.length])

  return (
    <Popover
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose()
      }}
    >
      <PopoverAnchor asChild>
        <div
          aria-hidden
          className="absolute h-0 w-0"
          style={{ left: position.left, top: position.top }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[min(460px,calc(100vw-40px))] p-0"
        side="top"
        align="start"
        sideOffset={8}
        avoidCollisions={true}
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
      >
        {suggestions.length > 0 ? (
          <ul className="max-h-56 overflow-y-auto py-1" role="listbox" aria-label="File references">
            {suggestions.map((suggestion, index) => {
              const isHighlighted = index === highlightedIndex
              return (
                <li key={`${suggestion.kind}:${suggestion.path}`}>
                  <button
                    ref={element => {
                      itemRefs.current[index] = element
                    }}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                      isHighlighted ? 'bg-accent text-accent-foreground' : 'text-popover-foreground'
                    )}
                    onMouseDown={event => {
                      event.preventDefault()
                      onSelect(suggestion)
                    }}
                  >
                    {suggestion.kind === 'folder' ? (
                      <FolderIcon className="h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <FileIcon className="h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="truncate">{suggestion.path}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="px-3 py-2 text-xs text-muted-foreground">No matching paths</div>
        )}
      </PopoverContent>
    </Popover>
  )
}
