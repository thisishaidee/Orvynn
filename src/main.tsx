/* Orvynn application entry point. */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider, dehydrate, hydrate } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { config } from './config'
import App from './App'
import './index.css'

const DASHBOARD_CACHE_KEY = 'orvynn:query-cache:v1'

function encodeCache(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? { __orvynnBigInt: item.toString() } : item,
  )
}

function decodeCache(value: string): unknown {
  return JSON.parse(value, (_key, item) => {
    if (item && typeof item === 'object' && typeof item.__orvynnBigInt === 'string') {
      return BigInt(item.__orvynnBigInt)
    }
    return item
  })
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 24 * 60 * 60 * 1000,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
})

// Restore only successful, public AgentPay read data. This lets the dashboard
// render its last known on-chain snapshot immediately while fresh reads run.
try {
  const saved = window.localStorage.getItem(DASHBOARD_CACHE_KEY)
  if (saved) hydrate(queryClient, decodeCache(saved) as ReturnType<typeof dehydrate>)
} catch {
  // Storage can be unavailable in private browsing; live RPC reads still work.
}

queryClient.getQueryCache().subscribe(() => {
  try {
    const snapshot = dehydrate(queryClient, {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' && query.queryKey[0] === 'agentpay',
    })
    window.localStorage.setItem(DASHBOARD_CACHE_KEY, encodeCache(snapshot))
  } catch {
    // A full or unavailable storage area must never block dashboard reads.
  }
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
