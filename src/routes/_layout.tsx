import { Outlet, createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { threadsSearchQuery } from '@/queries/threads'

export const Route = createFileRoute('/_layout')({
  component: RouteComponent,
  ssr: false,
})

function RouteComponent() {
  const conversations = useSuspenseQuery({
    ...threadsSearchQuery(),
    refetchInterval: query => {
      if (!query.state.data) {
        return false
      }

      // Check if the most recent thread (first in list) doesn't have a title yet
      const mostRecentThread = query.state.data[0]

      const needsTitle = mostRecentThread && !mostRecentThread.metadata?.title

      // Poll every 2 seconds if the most recent thread needs a title
      return needsTitle ? 2_000 : false
    },
  })

  return (
    <SidebarProvider defaultOpen={conversations.data.length > 0}>
      <AppSidebar
        conversations={conversations.data.map(conversation => ({
          id: conversation.thread_id,
          title: conversation.metadata?.title as string | undefined,
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
