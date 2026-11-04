import { useCallback, useEffect, useState } from 'react'
import { BRAND } from '@/lib/brand'

/** User-facing application pages, in navigation order. */
export const PAGES = ['overview', 'agents', 'leases', 'activity', 'wallet', 'settings', 'deploy'] as const
/** Public routes do not require a connected wallet. */
export type PageId = (typeof PAGES)[number] | 'design' | 'landing' | 'docs'

const TITLES: Record<PageId, string> = {
  landing: 'Spending control for AI agents on Arc',
  docs: 'Documentation',
  overview: 'Overview',
  agents: 'Agents',
  leases: 'Leases',
  activity: 'Activity',
  wallet: 'Wallet',
  settings: 'Settings',
  deploy: 'Deploy',
  design: 'Design system',
}

export const pageTitle = (page: PageId): string => TITLES[page]

function readPage(): PageId {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/'
  if (pathname === '/docs') return 'docs'
  if (pathname !== '/') return 'landing'

  const value = new URLSearchParams(window.location.search).get('page')
  if (value === 'design') return 'design'
  if ((PAGES as readonly string[]).includes(value ?? '')) return value as PageId
  return value === null ? 'landing' : 'overview'
}

/**
 * App pages retain query-string URLs. Public docs use /docs so the route is
 * readable, shareable and directly accessible without a wallet connection.
 */
export function useRoute(): [PageId, (page: PageId) => void] {
  const [page, setPage] = useState<PageId>(readPage)

  useEffect(() => {
    const onPop = () => setPage(readPage())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  useEffect(() => {
    document.title = page === 'landing'
      ? `${BRAND.name} — ${TITLES.landing}`
      : page === 'overview' ? BRAND.name : `${TITLES[page]} · ${BRAND.name}`
  }, [page])

  const navigate = useCallback((next: PageId) => {
    const url = new URL(window.location.href)
    if (next === 'docs') {
      url.pathname = '/docs'
      url.search = ''
      url.hash = ''
    } else {
      url.pathname = '/'
      if (next === 'landing') url.searchParams.delete('page')
      else url.searchParams.set('page', next)
    }
    window.history.pushState(null, '', url)
    setPage(next)
    window.scrollTo({ top: 0 })
  }, [])

  return [page, navigate]
}
