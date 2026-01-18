import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useStream } from '@langchain/langgraph-sdk/react'
import { z } from 'zod'
import { useQueryClient } from '@tanstack/react-query'
import { MessageInput } from '@/components/ui/message-input'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { threadsSearchQuery } from '@/queries/threads'

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
    apiUrl: 'http://localhost:2024',
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

  useEffect(() => {
    subscribe({
      formState: {
        values: true,
      },
      callback: data => {
        localStorage.setItem(STORAGE_KEY, data.values.projectPath)
      },
    })
  }, [])

  return (
    <div className="w-full h-full flex flex-col gap-10 justify-center items-center">
      <h2 className="text-3xl font-bold">Start New Chat</h2>

      <form
        onSubmit={handleSubmit(data => {
          stream.submit(
            { messages: [{ type: 'human', content: data.initialPrompt }] },
            { threadId: crypto.randomUUID(), streamResumable: true }
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
