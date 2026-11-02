import { useCallback, useEffect, useState } from 'react'
import { BRAND } from '@/lib/brand'

/** User-facing application pages, in navigation order. */
export const PAGES = ['overview', 'agents', 'leases', 'activity', 'wallet', 'settings', 'deploy', 'deploy-testnet'] as const
/** The public landing page is the root route; design remains an internal URL-only page. */
export type PageId = (typeof PAGES)[number] | 'design' | 'landing'

const TITLES: Record<PageId, string> = {
  landing: 'Spending control for AI agents on Arc',
  overview: 'Overview',
  agents: 'Agents',
  leases: 'Leases',
  activity: 'Activity',
  wallet: 'Wallet',
  settings: 'Settings',
  deploy: 'Deploy',
  'deploy-testnet': 'Testnet deployment',
  design: 'Design system',
}

export const pageTitle = (page: PageId): string => TITLES[page]

function readPage(): PageId {
  const value = new URLSearchParams(window.location.search).get('page')
  if (value === 'design') return 'design'
  if ((PAGES as readonly string[]).includes(value ?? '')) return value as PageId
  return value === null ? 'landing' : 'overview'
}

/**
 * Minimal query-string routing keeps app pages shareable. The root URL is public;
 * the dashboard is explicitly opened with ?page=overview.
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
    if (next === 'landing') url.searchParams.delete('page')
    else url.searchParams.set('page', next)
    window.history.pushState(null, '', url)
    setPage(next)
    window.scrollTo({ top: 0 })
  }, [])

  return [page, navigate]
}
