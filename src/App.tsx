import { lazy, Suspense, type ReactNode } from 'react'
import { Route, Routes } from 'react-router'
import { ROUTES } from './app/routes'
import { AppLayout } from './components/layout/AppLayout'
import { ConfigMissingPage } from './components/layout/ConfigMissingPage'
import { PlaceholderPage } from './components/layout/PlaceholderPage'
import { isSupabaseConfigured } from './data/supabase'
import { AccountDetailPage } from './features/accounts/AccountDetailPage'
import { AccountsPage } from './features/accounts/AccountsPage'
import { ForgotPasswordPage } from './features/auth/ForgotPasswordPage'
import { LoginPage } from './features/auth/LoginPage'
import { RedirectIfAuthenticated, RequireAuth } from './features/auth/RequireAuth'
import { ResetPasswordPage } from './features/auth/ResetPasswordPage'
import { SignupPage } from './features/auth/SignupPage'
import { ConsentPage } from './features/oauth/ConsentPage'
import { OnboardingPage } from './features/onboarding/OnboardingPage'
import { RedirectIfOnboarded, RequireOnboarding } from './features/onboarding/RequireOnboarding'
import { TransactionDialogProvider } from './features/transactions/TransactionDialogProvider'
import { TransactionsPage } from './features/transactions/TransactionsPage'
import { BudgetPage } from './features/budget/BudgetPage'
import { RecurringPage } from './features/recurring/RecurringPage'
import { InvestmentDetailPage } from './features/investments/InvestmentDetailPage'
import { InvestmentsPage } from './features/investments/InvestmentsPage'
import { LiabilitiesPage } from './features/liabilities/LiabilitiesPage'
import { LiabilityDetailPage } from './features/liabilities/LiabilityDetailPage'
import { SavingsDetailPage } from './features/savings/SavingsDetailPage'
import { SavingsPage } from './features/savings/SavingsPage'
import { DashboardPage } from './features/overview/DashboardPage'
import { LoadingState } from './components/ui/Money'
import { SettingsPage } from './features/settings/SettingsPage'

// Báo cáo & mô phỏng dùng thư viện biểu đồ (lớn) → tải khi mở trang, không làm chậm lần mở app đầu.
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'))
const WhatIfPage = lazy(() => import('./features/whatif/WhatIfPage'))

/** Trang đã xây; các trang còn lại hiện trang giữ chỗ theo lộ trình (docs/09). */
const PAGES: Record<string, ReactNode> = {
  '/': <DashboardPage />,
  '/reports': (
    <Suspense fallback={<LoadingState />}>
      <ReportsPage />
    </Suspense>
  ),
  '/what-if': (
    <Suspense fallback={<LoadingState />}>
      <WhatIfPage />
    </Suspense>
  ),
  '/accounts': <AccountsPage />,
  '/transactions': <TransactionsPage />,
  '/budget': <BudgetPage />,
  '/savings': <SavingsPage />,
  '/investments': <InvestmentsPage />,
  '/liabilities': <LiabilitiesPage />,
  '/settings': <SettingsPage />,
}

export default function App() {
  if (!isSupabaseConfigured) return <ConfigMissingPage />

  return (
    <Routes>
      <Route path="/login" element={<RedirectIfAuthenticated><LoginPage /></RedirectIfAuthenticated>} />
      <Route path="/signup" element={<RedirectIfAuthenticated><SignupPage /></RedirectIfAuthenticated>} />
      <Route path="/forgot-password" element={<RedirectIfAuthenticated><ForgotPasswordPage /></RedirectIfAuthenticated>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      {/* Trang đồng ý OAuth: Supabase chuyển người dùng tới đây khi Claude xin quyền (docs/12). */}
      <Route path="/oauth/consent" element={<RequireAuth><ConsentPage /></RequireAuth>} />
      <Route path="/onboarding" element={<RequireAuth><RedirectIfOnboarded><OnboardingPage /></RedirectIfOnboarded></RequireAuth>} />

      <Route
        element={
          <RequireAuth>
            <RequireOnboarding>
              <TransactionDialogProvider>
                <AppLayout />
              </TransactionDialogProvider>
            </RequireOnboarding>
          </RequireAuth>
        }
      >
        {ROUTES.map((r) => (
          <Route key={r.path} path={r.path} element={PAGES[r.path] ?? <PlaceholderPage title={r.label} phase={r.phase} />} />
        ))}
        <Route path="/accounts/:id" element={<AccountDetailPage />} />
        <Route path="/transactions/recurring" element={<RecurringPage />} />
        <Route path="/savings/:id" element={<SavingsDetailPage />} />
        <Route path="/investments/:id" element={<InvestmentDetailPage />} />
        <Route path="/liabilities/:id" element={<LiabilityDetailPage />} />
        <Route path="*" element={<PlaceholderPage title="Không tìm thấy trang" phase={0} />} />
      </Route>
    </Routes>
  )
}
