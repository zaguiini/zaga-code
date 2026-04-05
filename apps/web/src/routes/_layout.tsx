import { Outlet, createFileRoute, useMatchRoute } from '@tanstack/react-router'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from '@/components/app-sidebar'
import { trpc } from '@/lib/trpc'

export const Route = createFileRoute('/_layout')({
  component: RouteComponent,
})

function RouteComponent() {
  const routerState = useMatchRoute()

  const threadRouteParams = routerState({ to: '/$threadId' })

  const [{ threads }] = trpc.threads.list.useSuspenseQuery()

  return (
    <SidebarProvider defaultOpen={threads.length > 0}>
      <AppSidebar
        activeThreadId={threadRouteParams ? threadRouteParams.threadId : undefined}
        threads={threads.map(thread => ({
          id: thread.threadId,
          title: thread.firstMessage ?? undefined,
          isActive: threadRouteParams ? thread.threadId === threadRouteParams.threadId : false,
        }))}
      />
      <main className="w-full min-w-0 h-screen relative p-4">
        <Outlet />
        <SidebarTrigger className="absolute top-4 left-4 bg-background" />
      </main>
    </SidebarProvider>
  )
}
