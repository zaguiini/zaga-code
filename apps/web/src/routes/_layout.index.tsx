import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { client } from '@/lib/ai-client'
import { MessageInput } from '@/components/ui/message-input'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { threadsSearchQuery } from '@/queries/threads'

const createThreadInputValidator = z.object({
  projectPath: z.string(),
  initialPrompt: z.string(),
})

export const Route = createFileRoute('/_layout/')({
  component: NewChat,
  ssr: false,
})

const STORAGE_KEY = 'agent-project-path'

function NewChat() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    subscribe,
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    defaultValues: {
      projectPath: localStorage.getItem(STORAGE_KEY) || '',
    },
    resolver: zodResolver(createThreadInputValidator),
  })

  const saveToLocalStorage = useEffectEvent(({ values }: { values: { projectPath: string } }) => {
    const currentProjectPath = localStorage.getItem(STORAGE_KEY)
    if (currentProjectPath === values.projectPath) return
    localStorage.setItem(STORAGE_KEY, values.projectPath)
  })

  useEffect(() => {
    subscribe({
      formState: {
        values: true,
      },
      callback: saveToLocalStorage,
    })
  }, [])

  return (
    <div className="w-full h-full flex flex-col gap-10 justify-center items-center">
      <h2 className="text-3xl font-bold">Start New Chat</h2>

      <form
        onSubmit={handleSubmit(async data => {
          const context = {
            project_path: data.projectPath,
          }

          const title =
            data.initialPrompt.length <= 50
              ? data.initialPrompt
              : data.initialPrompt.substring(0, 50).trim() + '...'

          const { thread_id: threadId } = await client.threads.create({
            graphId: 'agent',
            metadata: { context, title },
          })

          return client.runs
            .create(threadId, 'agent', {
              input: {
                messages: [
                  { type: 'human', content: [{ type: 'text', text: data.initialPrompt }] },
                ],
                projectPath: data.projectPath,
              },
              config: { recursion_limit: 1000 },
              streamMode: ['messages', 'values', 'tools'],
              streamSubgraphs: true,
            })
            .then(run => {
              window.sessionStorage.setItem(`resume:${threadId}`, run.run_id)
              queryClient.invalidateQueries(threadsSearchQuery())

              navigate({
                to: '/$threadId',
                params: { threadId: run.thread_id },
              })
            })
        })}
        className="w-full max-w-xl flex flex-col gap-10"
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="projectPath">Project Path</FieldLabel>
            <Input
              id="projectPath"
              type="text"
              placeholder="Project Path"
              {...register('projectPath')}
            />
            {errors.projectPath?.message && <FieldError>{errors.projectPath.message}</FieldError>}
          </Field>
        </FieldGroup>
        <MessageInput
          placeholder="Ask Zaga Code"
          isGenerating={false}
          value={watch('initialPrompt')}
          {...register('initialPrompt')}
        />
      </form>
    </div>
  )
}
