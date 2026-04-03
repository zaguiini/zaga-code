import { Outlet, createFileRoute, useMatchRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { threadsSearchQuery } from '@/queries/threads'

export const Route = createFileRoute('/_layout')({
  component: RouteComponent,
  ssr: false,
})

function RouteComponent() {
  const routerState = useMatchRoute()

  const threadRouteParams = routerState({ to: '/$threadId' })

  const threads = useSuspenseQuery(threadsSearchQuery())

  return (
    <SidebarProvider defaultOpen={threads.data.length > 0}>
      <AppSidebar
        activeThreadId={threadRouteParams ? threadRouteParams.threadId : undefined}
        threads={threads.data.map(thread => ({
          id: thread.thread_id,
          title: thread.metadata?.title as string | undefined,
          isActive: threadRouteParams ? thread.thread_id === threadRouteParams.threadId : false,
        }))}
      />
      <main className="w-full min-w-0 h-screen relative p-4">
        <Outlet />
        <SidebarTrigger className="absolute top-4 left-4 bg-background" />
      </main>
    </SidebarProvider>
  )
}
