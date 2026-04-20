import { X } from 'lucide-react'

interface FileReferenceChipProps {
  path: string
  onRemove: () => void
}

export function FileReferenceChip({ path, onRemove }: FileReferenceChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2 py-1 text-xs text-foreground">
      <span className="truncate max-w-[260px]">@{path}</span>
      <button
        type="button"
        onClick={onRemove}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground"
        aria-label={`Remove @${path} reference`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  )
}
