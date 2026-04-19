import React, { useEffect } from 'react'
import { motion } from 'framer-motion'
import { FileIcon, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface FilePreviewProps {
  file: File
  onRemove?: () => void
}

export const FilePreview = React.forwardRef<HTMLDivElement, FilePreviewProps>((props, ref) => {
  if (props.file.type.startsWith('image/')) {
    return <ImageFilePreview {...props} ref={ref} />
  }

  if (
    props.file.type.startsWith('text/') ||
    props.file.name.endsWith('.txt') ||
    props.file.name.endsWith('.md')
  ) {
    return <TextFilePreview {...props} ref={ref} />
  }

  return <GenericFilePreview {...props} ref={ref} />
})
FilePreview.displayName = 'FilePreview'

const ImageFilePreview = React.forwardRef<HTMLDivElement, FilePreviewProps>(
  ({ file, onRemove }, ref) => {
    const [objectUrl, setObjectUrl] = React.useState<string | null>(null)
    const [isOpen, setIsOpen] = React.useState(false)

    useEffect(() => {
      const nextObjectUrl = URL.createObjectURL(file)
      setObjectUrl(nextObjectUrl)

      return () => {
        URL.revokeObjectURL(nextObjectUrl)
      }
    }, [file])

    return (
      <motion.div
        ref={ref}
        className="relative flex max-w-[200px] rounded-md border p-1.5 pr-2 text-xs"
        layout
        initial={{ opacity: 0, y: '100%' }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: '100%' }}
      >
        {objectUrl ? (
          <Dialog open={isOpen} onOpenChange={setIsOpen}>
            <DialogTrigger asChild>
              <button
                type="button"
                className="cursor-pointer flex w-full items-center space-x-2 rounded-sm text-left outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring"
                title={`Open ${file.name} in full size`}
              >
                <img
                  alt={`Attachment ${file.name}`}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border bg-muted object-cover"
                  src={objectUrl}
                />
                <span className="w-full truncate text-muted-foreground">{file.name}</span>
              </button>
            </DialogTrigger>
            <DialogContent
              showCloseButton={false}
              className="w-auto max-w-[90vw] border-none bg-transparent p-0 shadow-none sm:max-w-5xl"
            >
              <DialogTitle className="sr-only">{file.name}</DialogTitle>
              <DialogDescription className="sr-only">
                Full-size preview for {file.name}
              </DialogDescription>
              <div className="inline-flex max-w-full items-center justify-center overflow-auto rounded-lg border bg-background/95 p-2 backdrop-blur">
                <img
                  alt={file.name}
                  className="h-auto max-h-[85vh] w-auto max-w-full rounded-md object-contain"
                  src={objectUrl}
                />
              </div>
            </DialogContent>
          </Dialog>
        ) : (
          <div className="flex w-full items-center space-x-2">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border bg-muted" />
            <span className="w-full truncate text-muted-foreground">{file.name}</span>
          </div>
        )}

        {onRemove ? (
          <button
            className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border bg-background"
            type="button"
            onClick={onRemove}
            aria-label="Remove attachment"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        ) : null}
      </motion.div>
    )
  }
)
ImageFilePreview.displayName = 'ImageFilePreview'

const TextFilePreview = React.forwardRef<HTMLDivElement, FilePreviewProps>(
  ({ file, onRemove }, ref) => {
    const [preview, setPreview] = React.useState<string>('')

    useEffect(() => {
      const reader = new FileReader()
      reader.onload = e => {
        const text = e.target?.result as string
        setPreview(text.slice(0, 50) + (text.length > 50 ? '...' : ''))
      }
      reader.readAsText(file)
    }, [file])

    return (
      <motion.div
        ref={ref}
        className="relative flex max-w-[200px] rounded-md border p-1.5 pr-2 text-xs"
        layout
        initial={{ opacity: 0, y: '100%' }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: '100%' }}
      >
        <div className="flex w-full items-center space-x-2">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border bg-muted p-0.5">
            <div className="h-full w-full overflow-hidden text-[6px] leading-none text-muted-foreground">
              {preview || 'Loading...'}
            </div>
          </div>
          <span className="w-full truncate text-muted-foreground">{file.name}</span>
        </div>

        {onRemove ? (
          <button
            className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border bg-background"
            type="button"
            onClick={onRemove}
            aria-label="Remove attachment"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        ) : null}
      </motion.div>
    )
  }
)
TextFilePreview.displayName = 'TextFilePreview'

const GenericFilePreview = React.forwardRef<HTMLDivElement, FilePreviewProps>(
  ({ file, onRemove }, ref) => {
    return (
      <motion.div
        ref={ref}
        className="relative flex max-w-[200px] rounded-md border p-1.5 pr-2 text-xs"
        layout
        initial={{ opacity: 0, y: '100%' }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: '100%' }}
      >
        <div className="flex w-full items-center space-x-2">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-sm border bg-muted">
            <FileIcon className="h-6 w-6 text-foreground" />
          </div>
          <span className="w-full truncate text-muted-foreground">{file.name}</span>
        </div>

        {onRemove ? (
          <button
            className="absolute -right-2 -top-2 flex h-4 w-4 items-center justify-center rounded-full border bg-background"
            type="button"
            onClick={onRemove}
            aria-label="Remove attachment"
          >
            <X className="h-2.5 w-2.5" />
          </button>
        ) : null}
      </motion.div>
    )
  }
)
GenericFilePreview.displayName = 'GenericFilePreview'
