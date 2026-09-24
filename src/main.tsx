import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import App from './App'
import { ToastProvider } from './components/ui/toast'
import { isSupabaseConfigured } from './data/supabase'
import { AuthProvider } from './features/auth/AuthProvider'
import { applyTheme } from './lib/theme'
import './index.css'

applyTheme('system')

// Dữ liệu lấy từ Supabase qua TanStack Query: tự làm mới khi quay lại tab (docs/08 E7).
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: 1 } },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          {isSupabaseConfigured ? (
            <AuthProvider>
              <App />
            </AuthProvider>
          ) : (
            <App />
          )}
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
