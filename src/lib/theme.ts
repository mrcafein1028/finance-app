import type { Settings } from '../schemas'

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
let unsubscribe: (() => void) | null = null

/** Gắn lớp .dark lên <html>; chế độ "system" tự theo hệ điều hành khi nó đổi. */
export function applyTheme(theme: Settings['theme']): void {
  unsubscribe?.()
  unsubscribe = null
  const set = (dark: boolean) => document.documentElement.classList.toggle('dark', dark)

  if (theme !== 'system' || !media) {
    set(theme === 'dark')
    return
  }
  set(media.matches)
  const onChange = (e: MediaQueryListEvent) => set(e.matches)
  media.addEventListener('change', onChange)
  unsubscribe = () => media.removeEventListener('change', onChange)
}
