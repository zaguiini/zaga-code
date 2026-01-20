import { Link } from '@tanstack/react-router'
import { PlusIcon } from 'lucide-react'
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'

export function AppSidebar({
  threads,
}: {
  threads: Array<{ id: string; title?: string; isActive?: boolean }>
}) {
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
                  <SidebarMenuButton asChild>
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
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}
