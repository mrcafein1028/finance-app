import type { ReactNode } from 'react'
import { Navigate } from 'react-router'
import { ErrorState, LoadingState } from '../../components/ui/Money'
import { useSettings } from '../../data/queries'

/** Chưa hoàn tất onboarding (W0) → chuyển tới /onboarding trước khi vào app. */
export function RequireOnboarding({ children }: { children: ReactNode }) {
  const { data: settings, isLoading, error } = useSettings()
  if (isLoading) return <LoadingState />
  if (error) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <ErrorState error={error} />
      </div>
    )
  }
  if (!settings?.onboardingCompleted) return <Navigate to="/onboarding" replace />
  return children
}

/** Ngược lại: đã hoàn tất thì không vào lại /onboarding. */
export function RedirectIfOnboarded({ children }: { children: ReactNode }) {
  const { data: settings, isLoading } = useSettings()
  if (isLoading) return <LoadingState />
  if (settings?.onboardingCompleted) return <Navigate to="/" replace />
  return children
}
