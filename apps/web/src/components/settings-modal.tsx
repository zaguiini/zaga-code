import { useCallback, useEffect, useState } from 'react'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { KNOWN_OPENAI_CONTEXT_WINDOWS } from '@zaga/agent/constants'
import { Controller, useForm } from 'react-hook-form'
import type { Settings } from '@zaga/agent/settings'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { THEME_PREFERENCE_CHANGED_EVENT, applyTheme } from '@/lib/theme'

type McpServers = Settings['mcpServers']

type Tab = 'general' | 'mcps'
type Provider = 'lm-studio' | 'openai'

type GeneralFormValues = {
  provider: Provider
  model: string
  apiBase: string
  apiKey: string
  theme: Settings['theme']
}

const DEFAULT_GENERAL_VALUES: GeneralFormValues = {
  provider: 'lm-studio',
  model: 'qwen3.6-35b-a3b@4bit',
  apiBase: 'http://localhost:1234/v1',
  apiKey: '',
  theme: 'system',
}

type McpFormValues = {
  mcpServers: McpServers
  newName: string
  newTransport: 'http' | 'stdio'
}

const OPENAI_MODELS = Object.keys(KNOWN_OPENAI_CONTEXT_WINDOWS)

function getGeneralFormValues(settings?: Settings): GeneralFormValues {
  if (!settings) return DEFAULT_GENERAL_VALUES

  if (settings.connection.provider === 'openai') {
    return {
      provider: 'openai',
      model: settings.connection.model,
      apiBase: DEFAULT_GENERAL_VALUES.apiBase,
      apiKey: settings.connection.apiKey,
      theme: settings.theme,
    }
  }

  return {
    provider: 'lm-studio',
    model: settings.connection.model,
    apiBase: settings.connection.apiBase,
    apiKey: '',
    theme: settings.theme,
  }
}

export function SettingsModal({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>('general')
  const settings = useSettings()

  const tabs: Array<{ value: Tab; label: string; disabled?: boolean }> = [
    { value: 'general', label: 'General' },
    { value: 'mcps', label: 'MCPs' },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure your Zaga Code instance.</DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b">
          {tabs.map(t => (
            <button
              key={t.value}
              type="button"
              disabled={t.disabled}
              onClick={() => setTab(t.value)}
              className={`cursor-pointer px-3 py-2 text-sm font-medium border-b-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                tab === t.value
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1">
          {tab === 'general' && <GeneralTab {...settings} />}
          {tab === 'mcps' && <McpTab {...settings} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function useSettings() {
  const [data, setData] = useState<Settings | null>(null)

  const load = useCallback(() => {
    window.zaga!.getSettings().then(d => {
      setData(d)
    })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { data, reload: load, setData }
}

function GeneralTab({ data, reload }: ReturnType<typeof useSettings>) {
  const [saving, setSaving] = useState(false)
  const {
    clearErrors,
    control,
    formState: { errors, isDirty },
    register,
    handleSubmit,
    setValue,
    watch,
  } = useForm<GeneralFormValues>({
    defaultValues: getGeneralFormValues(data ?? undefined),
  })

  const provider = watch('provider')
  const model = watch('model')
  const apiBase = watch('apiBase')
  const theme = watch('theme')

  useEffect(() => {
    if (provider !== 'openai') {
      clearErrors('apiKey')
      if (!apiBase) {
        setValue('apiBase', DEFAULT_GENERAL_VALUES.apiBase, {
          shouldDirty: true,
        })
      }
      return
    }

    if (!model || !OPENAI_MODELS.includes(model)) {
      setValue('model', OPENAI_MODELS[0] ?? '', {
        shouldDirty: true,
      })
    }
  }, [apiBase, clearErrors, model, provider, setValue])

  const onSubmit = handleSubmit(values => {
    if (!data) return

    setSaving(true)
    const connection: Settings['connection'] =
      values.provider === 'openai'
        ? {
            provider: 'openai',
            model: values.model,
            apiKey: values.apiKey,
          }
        : {
            provider: 'lm-studio',
            model: values.model,
            apiBase: values.apiBase,
          }

    window
      .zaga!.updateSettings({
        connection,
        theme: values.theme,
        mcpServers: data.mcpServers,
      })
      .then(async () => {
        const savedSettings = await window.zaga!.getSettings()
        void applyTheme(savedSettings.theme)
        window.dispatchEvent(
          new CustomEvent(THEME_PREFERENCE_CHANGED_EVENT, {
            detail: { theme: savedSettings.theme },
          })
        )
        reload()
      })
      .finally(() => setSaving(false))
  })

  return (
    <form className="flex flex-col gap-4 py-2" onSubmit={onSubmit}>
      <input type="hidden" {...register('theme')} />
      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-provider">Provider</Label>
        <Controller
          control={control}
          name="provider"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="settings-provider" className="w-full h-10">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lm-studio">LM Studio</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="settings-model">Model</Label>
        {provider === 'openai' ? (
          <Controller
            control={control}
            name="model"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="settings-model" className="w-full h-10">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {OPENAI_MODELS.map(openAiModel => (
                    <SelectItem key={openAiModel} value={openAiModel}>
                      {openAiModel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        ) : (
          <Input id="settings-model" placeholder="qwen3.6-35b-a3b@4bit" {...register('model')} />
        )}
      </div>

      {provider === 'lm-studio' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-apiBase">API Base URL</Label>
          <Input
            id="settings-apiBase"
            placeholder="http://localhost:1234/v1"
            {...register('apiBase')}
          />
        </div>
      )}

      {provider === 'openai' && (
        <div className="flex flex-col gap-2">
          <Label htmlFor="settings-apiKey">API Key</Label>
          <Input
            id="settings-apiKey"
            type="password"
            {...register('apiKey', {
              validate: value => value.trim().length > 0 || 'API key is required for OpenAI',
            })}
          />
          {errors.apiKey && <p className="text-sm text-destructive">{errors.apiKey.message}</p>}
        </div>
      )}
      <fieldset className="flex justify-between gap-3 rounded-md border p-3">
        <div className="flex flex-col gap-1">
          <Label>Theme</Label>
          <p className="text-sm text-muted-foreground">Choose light, dark, or follow system.</p>
        </div>
        <ButtonGroup>
          <ThemeButton
            active={theme === 'system'}
            label="System"
            onClick={() => setValue('theme', 'system', { shouldDirty: true })}
          />
          <ThemeButton
            active={theme === 'light'}
            label="Light"
            onClick={() => setValue('theme', 'light', { shouldDirty: true })}
          />
          <ThemeButton
            active={theme === 'dark'}
            label="Dark"
            onClick={() => setValue('theme', 'dark', { shouldDirty: true })}
          />
        </ButtonGroup>
      </fieldset>
      <div className="flex justify-end">
        <Button type="submit" disabled={!isDirty || saving}>
          Save
        </Button>
      </div>
    </form>
  )
}

function ThemeButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'secondary'}
      onClick={onClick}
      role="radio"
      aria-checked={active}
    >
      {label}
    </Button>
  )
}

function McpTab({ data, reload, setData }: ReturnType<typeof useSettings>) {
  const [saving, setSaving] = useState(false)
  const {
    control,
    formState: { isDirty },
    getValues,
    reset,
    setValue,
    watch,
  } = useForm<McpFormValues>({
    defaultValues: {
      mcpServers: {},
      newName: '',
      newTransport: 'http',
    },
  })

  useEffect(() => {
    reset({
      mcpServers: data?.mcpServers ?? {},
      newName: '',
      newTransport: 'http',
    })
  }, [data, reset])

  const currentServers = watch('mcpServers')
  const newName = watch('newName')
  const newTransport = watch('newTransport')

  function save(updated: McpServers) {
    if (!data) return

    setSaving(true)
    window
      .zaga!.updateSettings({ ...data, mcpServers: updated })
      .then(() => {
        const nextData = { ...data, mcpServers: updated }
        setData(nextData)
        reset({
          mcpServers: updated,
          newName: '',
          newTransport: 'http',
        })
        return reload()
      })
      .finally(() => setSaving(false))
  }

  function addServer() {
    const name = newName.trim()
    if (!name) return

    const entry: McpServers[string] =
      newTransport === 'http'
        ? { transport: 'http', url: '', enabled: true }
        : { transport: 'stdio', command: '', args: [], enabled: true }
    setValue('mcpServers', { ...currentServers, [name]: entry }, { shouldDirty: true })
    setValue('newName', '', { shouldDirty: false })
  }

  function removeServer(name: string) {
    const { [name]: _, ...rest } = currentServers
    setValue('mcpServers', rest, { shouldDirty: true })
  }

  function updateServer(name: string, server: McpServers[string]) {
    setValue('mcpServers', { ...currentServers, [name]: server }, { shouldDirty: true })
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {Object.entries(currentServers).map(([name, server]) => (
        <McpServerEntry
          key={name}
          name={name}
          server={server}
          onUpdate={s => updateServer(name, s)}
          onRemove={() => removeServer(name)}
        />
      ))}

      {Object.keys(currentServers).length === 0 && (
        <p className="text-sm text-muted-foreground py-2">No MCP servers configured.</p>
      )}

      <div className="flex items-end gap-2 border-t pt-4">
        <div className="flex flex-col gap-1 flex-1">
          <Label htmlFor="new-mcp-name" className="text-xs">
            Server name
          </Label>
          <Input
            id="new-mcp-name"
            placeholder="my-server"
            value={newName}
            onChange={e => setValue('newName', e.target.value, { shouldDirty: false })}
            onKeyDown={e => e.key === 'Enter' && addServer()}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="new-mcp-transport" className="text-xs">
            Transport
          </Label>
          <Controller
            control={control}
            name="newTransport"
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="new-mcp-transport" className="h-9 min-w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="http">HTTP</SelectItem>
                  <SelectItem value="stdio">Stdio</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
        </div>
        <Button type="button" variant="outline" size="sm" onClick={addServer}>
          <PlusIcon className="size-4" />
          Add
        </Button>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={!isDirty || saving}
          onClick={() => save(getValues('mcpServers'))}
        >
          Save
        </Button>
      </div>
    </div>
  )
}

function McpServerEntry({
  name,
  server,
  onUpdate,
  onRemove,
}: {
  name: string
  server: McpServers[string]
  onUpdate: (server: McpServers[string]) => void
  onRemove: () => void
}) {
  const enabled = server.enabled ?? true

  return (
    <div className="rounded-md border p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-medium">{name}</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={enabled ? 'outline' : 'secondary'}
            size="sm"
            aria-pressed={enabled}
            onClick={() => onUpdate({ ...server, enabled: !enabled })}
          >
            {enabled ? 'Enabled' : 'Disabled'}
          </Button>
          <span className="text-xs text-muted-foreground uppercase">{server.transport}</span>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onRemove}>
            <Trash2Icon className="size-3.5" />
          </Button>
        </div>
      </div>

      {server.transport === 'http' ? (
        <div className="flex flex-col gap-1">
          <Label className="text-xs">URL</Label>
          <Input
            placeholder="http://localhost:3000/mcp"
            value={server.url}
            onChange={e => onUpdate({ ...server, url: e.target.value })}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Command</Label>
            <Input
              placeholder="npx"
              value={server.command}
              onChange={e => onUpdate({ ...server, command: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Args (comma-separated)</Label>
            <Input
              placeholder="-y,@modelcontextprotocol/server-filesystem,/tmp"
              value={server.args.join(',')}
              onChange={e =>
                onUpdate({
                  ...server,
                  args: e.target.value ? e.target.value.split(',') : [],
                })
              }
            />
          </div>
        </>
      )}
    </div>
  )
}
