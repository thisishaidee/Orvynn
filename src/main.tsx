/* Orvynn application entry point. */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { config } from './config'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reuse recent chain reads when moving between pages instead of rescanning
      // the same history on every mount. Mutations explicitly invalidate affected data.
      staleTime: 30_000,
      gcTime: 10 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
          <App />
          <Toaster position="top-center" richColors closeButton duration={4500} visibleToasts={3} />
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

