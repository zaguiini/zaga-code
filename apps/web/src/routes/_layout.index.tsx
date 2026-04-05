import { createFileRoute, useNavigate, useSearch } from '@tanstack/react-router'
import { z } from 'zod'
import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { MessageInput } from '@/components/ui/message-input'

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
  const [projectPath, setProjectPath] = useState(
    urlProjectPath ?? localStorage.getItem(STORAGE_KEY) ?? ''
  )
  const [prompt, setPrompt] = useState('')
  const invalidateThreads = trpc.useUtils().threads.list.invalidate

  return (
    <div className="w-full h-full flex flex-col gap-10 justify-center items-center">
      <h2 className="text-3xl font-bold">Start New Chat</h2>
      <form
        onSubmit={async e => {
          e.preventDefault()
          if (!projectPath.trim() || !prompt.trim()) return
          localStorage.setItem(STORAGE_KEY, projectPath)

          const { threadId } = await createThread.mutateAsync({ projectPath })

          invalidateThreads()

          // Hand off prompt to thread route via sessionStorage.
          // Thread route reads it on mount and calls stream.submit automatically.
          sessionStorage.setItem(`pending-prompt:${threadId}`, prompt)

          void navigate({ to: '/$threadId', params: { threadId } })
        }}
        className="w-full max-w-xl flex flex-col gap-6"
      >
        <div className="flex flex-col gap-2">
          <label htmlFor="projectPath" className="text-sm font-medium">
            Project Path
          </label>
          <input
            id="projectPath"
            type="text"
            placeholder="/path/to/your/project"
            value={projectPath}
            onChange={e => setProjectPath(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </div>
        <MessageInput
          placeholder="Ask Zaga Code"
          isGenerating={createThread.isPending}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
        />
      </form>
    </div>
  )
}
