import { Outlet, createRootRoute } from '@tanstack/react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCallback, useEffect, useRef } from 'react'
import type { Settings } from '@zaga/agent/settings'
import { trpc, trpcClient } from '@/lib/trpc'
import { THEME_PREFERENCE_CHANGED_EVENT, applyResolvedTheme, applyTheme } from '@/lib/theme'
import '../styles.css'

const queryClient = new QueryClient()

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const cleanupSystemThemeListenerRef = useRef<(() => void) | null>(null)

  const applyThemePreference = useCallback(async (theme: Settings['theme']) => {
    cleanupSystemThemeListenerRef.current?.()
    cleanupSystemThemeListenerRef.current = null

    await applyTheme(theme)

    if (theme === 'system' && window.zaga?.onSystemThemeChange) {
      cleanupSystemThemeListenerRef.current = window.zaga.onSystemThemeChange(nextTheme => {
        applyResolvedTheme(nextTheme)
      })
    }
  }, [])

  useEffect(() => {
    window.zaga
      ?.getSettings()
      .then(settings => {
        return applyThemePreference(settings.theme)
      })
      .catch(() => {
        return applyThemePreference('system')
      })

    const onPreferenceChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ theme: Settings['theme'] }>).detail
      void applyThemePreference(detail.theme)
    }

    window.addEventListener(THEME_PREFERENCE_CHANGED_EVENT, onPreferenceChanged)

    return () => {
      cleanupSystemThemeListenerRef.current?.()
      cleanupSystemThemeListenerRef.current = null
      window.removeEventListener(THEME_PREFERENCE_CHANGED_EVENT, onPreferenceChanged)
    }
  }, [applyThemePreference])

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <Outlet />
      </trpc.Provider>
    </QueryClientProvider>
  )
}
