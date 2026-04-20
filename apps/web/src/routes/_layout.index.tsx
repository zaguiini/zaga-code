import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { FolderOpen } from 'lucide-react'
import { z } from 'zod'
import { useState } from 'react'
import type { Settings } from '@zaga/agent/settings'
import { trpc } from '@/lib/trpc'
import { MessageInput } from '@/components/ui/message-input'
import { fileToDataUrl } from '@/lib/file-to-data-url'

declare global {
  interface Window {
    zaga?: {
      pickDirectory: () => Promise<string | null>
      getSettings: () => Promise<Settings>
      updateSettings: (data: Settings) => Promise<{ ok: true }>
    }
  }
}

const searchSchema = z.object({
  projectPath: z.string().optional(),
})

export const Route = createFileRoute('/_layout/')({
  component: NewChat,
  validateSearch: searchSchema,
})

const STORAGE_KEY = 'agent-project-path'

function NewChat() {
  const navigate = useNavigate()
  const { projectPath: urlProjectPath } = useSearch({ from: '/_layout/' })
  const createThread = trpc.threads.create.useMutation()
  const startRun = trpc.runs.start.useMutation()
  const [projectPath, setProjectPath] = useState(
    urlProjectPath ?? localStorage.getItem(STORAGE_KEY) ?? ''
  )
  const [prompt, setPrompt] = useState('')
  const [files, setFiles] = useState<Array<File> | null>(null)
  const utils = trpc.useUtils()
  const trimmedProjectPath = projectPath.trim()
  const threadFilesQuery = trpc.threads.files.useQuery(
    { projectPath: trimmedProjectPath },
    { enabled: trimmedProjectPath.length > 0 }
  )

  const { zaga } = window

  return (
    <div className="w-full h-full flex flex-col gap-10 justify-center items-center">
      <h2 className="text-3xl font-bold">Start New Chat</h2>
      <form
        onSubmit={async e => {
          e.preventDefault()
          const trimmedPrompt = prompt.trim()
          const attachedFiles = files ?? []
          if (!trimmedProjectPath || (!trimmedPrompt && attachedFiles.length === 0)) return

          localStorage.setItem(STORAGE_KEY, trimmedProjectPath)

          const images = await Promise.all(attachedFiles.map(fileToDataUrl))
          const { threadId } = await createThread.mutateAsync({ projectPath: trimmedProjectPath })
          await startRun.mutateAsync({
            threadId,
            input: { text: trimmedPrompt, images },
          })

          void utils.threads.list.invalidate()
          void utils.threads.get.invalidate({ threadId })
          void utils.runs.get.invalidate({ threadId })

          void navigate({ to: '/$threadId', params: { threadId } })
        }}
        className="w-full max-w-xl flex flex-col gap-6"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="projectPath" className="text-sm font-medium">
            Project Path
          </label>
          <div className="flex gap-2">
            <input
              id="projectPath"
              type="text"
              placeholder="/path/to/your/project"
              value={projectPath}
              onChange={e => setProjectPath(e.target.value)}
              className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            {zaga && (
              <button
                type="button"
                onClick={async () => {
                  const picked = await zaga.pickDirectory()
                  if (picked) setProjectPath(picked)
                }}
                className="inline-flex items-center justify-center rounded-md border border-border bg-background px-3 py-2 text-sm hover:bg-accent"
                title="Browse…"
              >
                <FolderOpen className="size-4" />
              </button>
            )}
          </div>
        </div>
        <MessageInput
          allowAttachments
          filePaths={threadFilesQuery.data?.files ?? []}
          folderPaths={threadFilesQuery.data?.folders ?? []}
          files={files}
          setFiles={setFiles}
          placeholder="Ask Zaga Code"
          isGenerating={createThread.isPending || startRun.isPending}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
        />
      </form>
    </div>
  )
}
