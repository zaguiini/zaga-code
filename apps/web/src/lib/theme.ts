import type { Settings } from '@zaga/agent/settings'

export type SystemTheme = 'light' | 'dark'

export const THEME_PREFERENCE_CHANGED_EVENT = 'zaga:theme-preference-changed'

export function applyResolvedTheme(theme: SystemTheme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

async function resolveThemePreference(theme: Settings['theme']): Promise<SystemTheme> {
  if (theme !== 'system') return theme

  try {
    if (window.zaga?.getSystemTheme) {
      return await window.zaga.getSystemTheme()
    }
  } catch {
    // Fall through to browser media query.
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export async function applyTheme(theme: Settings['theme']) {
  applyResolvedTheme(await resolveThemePreference(theme))
}
