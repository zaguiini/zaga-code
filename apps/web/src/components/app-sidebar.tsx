import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { client } from '@/lib/ai-client'
import { cn } from '@/lib/utils'

export function AppSidebar({
  activeThreadId,
  threads,
}: {
  activeThreadId?: string
  threads: Array<{ id: string; title?: string; isActive?: boolean }>
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const deleteThread = useMutation({
    mutationFn: (threadId: string) => client.threads.delete(threadId),
    onSuccess: (_, threadId) => {
      window.sessionStorage.removeItem(`resume:${threadId}`)
      queryClient.invalidateQueries({ queryKey: ['threads'] })
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
                <SidebarMenuItem key={item.id} title={item.title || item.id}>
                  <SidebarMenuButton asChild isActive={item.isActive}>
                    <Link
                      to="/$threadId"
                      params={{ threadId: item.id }}
                      className={cn(
                        item.isActive && 'bg-sidebar-accent',
                        !item.title && 'text-muted-foreground italic'
                      )}
                    >
                      <span>{item.title || item.id}</span>
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
    </Sidebar>
  )
}
