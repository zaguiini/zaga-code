import { useMutation } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon, SettingsIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import { trpc, trpcClient } from '@/lib/trpc'
import { SettingsModal } from '@/components/settings-modal'

export function AppSidebar({
  activeThreadId,
  threads,
}: {
  activeThreadId?: string
  threads: Array<{ id: string; title?: string; isActive?: boolean }>
}) {
  const navigate = useNavigate()
  const invalidateThreads = trpc.useUtils().threads.list.invalidate
  const [settingsOpen, setSettingsOpen] = useState(false)

  const deleteThread = useMutation({
    mutationFn: (threadId: string) => trpcClient.threads.delete.mutate({ threadId }),
    onSuccess: (_, threadId) => {
      window.sessionStorage.removeItem(`resume:${threadId}`)

      invalidateThreads()

      if (threadId === activeThreadId) {
        navigate({ to: '/' })
      }
    },
    onError: () => {
      toast.error('Failed to delete chat.')
    },
  })
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Chats</SidebarGroupLabel>
          <SidebarGroupAction asChild>
            <Link to="/">
              <PlusIcon />
              <span className="sr-only">New Chat</span>
            </Link>
          </SidebarGroupAction>
          <SidebarGroupContent>
            <SidebarMenu>
              {threads.map(item => (
                <SidebarMenuItem key={item.id} title={item.title}>
                  <SidebarMenuButton asChild isActive={item.isActive}>
                    <Link
                      to="/$threadId"
                      params={{ threadId: item.id }}
                      className={cn(
                        item.isActive && 'bg-sidebar-accent',
                        !item.title && 'text-muted-foreground italic'
                      )}
                    >
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  <SidebarMenuAction
                    showOnHover
                    type="button"
                    disabled={deleteThread.isPending && deleteThread.variables === item.id}
                    aria-label="Delete chat"
                    onClick={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      deleteThread.mutate(item.id)
                    }}
                  >
                    <Trash2Icon />
                  </SidebarMenuAction>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      {window.zaga && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="cursor-pointer" onClick={() => setSettingsOpen(true)}>
                <SettingsIcon className="size-4" />
                <span className="font-bold">Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
        </SidebarFooter>
      )}
    </Sidebar>
  )
}
