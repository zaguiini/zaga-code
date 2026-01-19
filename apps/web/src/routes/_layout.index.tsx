import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useStream } from '@langchain/langgraph-sdk/react'
import { client } from '@/lib/ai-client'
import { MessageInput } from '@/components/ui/message-input'
import { Input } from '@/components/ui/input'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { threadsSearchQuery } from '@/queries/threads'
import { env } from '@/env'

const createConversationInputValidator = z.object({
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

  const stream = useStream({
    apiUrl: env.VITE_LANGGRAPH_API_URL,
    assistantId: 'agent',
    onCreated: run => {
      window.sessionStorage.setItem(`resume:${run.thread_id}`, run.run_id)

      queryClient.invalidateQueries(threadsSearchQuery())

      navigate({
        to: '/$conversationId',
        params: { conversationId: run.thread_id },
      })
    },
    onFinish: (_, run) => {
      if (run?.thread_id) {
        window.sessionStorage.removeItem(`resume:${run.thread_id}`)
      }
    },
  })

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
    resolver: zodResolver(createConversationInputValidator),
  })

  const projectPath = watch('projectPath')

  const { mutate, isPending } = useMutation({
    mutationFn: () => {
      return client.runs.create(null, 'project-setup', {
        input: {
          projectPath: projectPath,
          status: 'indexing',
          filesIndexed: 0,
          chunksIndexed: 0,
        },
      })
    },
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
        onSubmit={handleSubmit(data => {
          const threadId = crypto.randomUUID()

          stream.submit(
            {
              messages: [
                { type: 'human', content: data.initialPrompt, additional_kwargs: { threadId } },
              ],
            },
            {
              threadId,
              streamResumable: true,
              context: { threadId },
              config: { configurable: { threadId } },
            }
          )
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
              {...register('projectPath', {
                onBlur: () => {
                  mutate()
                },
              })}
            />
            {isPending && <FieldDescription>Indexing project, please wait...</FieldDescription>}
            {errors.projectPath?.message && <FieldError>{errors.projectPath.message}</FieldError>}
          </Field>
        </FieldGroup>
        <MessageInput
          placeholder="Ask Zaga Code"
          isGenerating={false}
          disabled={isPending}
          value={watch('initialPrompt')}
          {...register('initialPrompt')}
        />
      </form>
    </div>
  )
}
