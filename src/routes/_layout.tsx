import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { client } from '@/lib/ai-client'

export const Route = createFileRoute('/_layout')({
  component: RouteComponent,
  ssr: false,
})

function RouteComponent() {
  const conversations = useSuspenseQuery({
    queryKey: ['conversations'],
    queryFn: () => client.threads.search(),
  })

  return (
    <SidebarProvider defaultOpen={conversations.data.length > 0}>
      <AppSidebar
        conversations={conversations.data.map(conversation => ({
          id: conversation.thread_id,
          preview: conversation.thread_id,
        }))}
      />
      <main className="w-full h-screen relative p-4">
        <Outlet />
        <SidebarTrigger className="absolute top-4 left-4 bg-background" />
      </main>
    </SidebarProvider>
  )
}
