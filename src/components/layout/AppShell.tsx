import { useEffect, useState, type ReactNode } from 'react'
import { ArrowUpRight, Github, Menu, X, BookOpen, Droplets, ExternalLink, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { BRAND } from '@/lib/brand'

export interface NavItem {
  id: string
  label: string
  icon: LucideIcon
}

function OrvynnMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M30.5 30.5V6.5A24 24 0 0 0 6.5 30.5Z" />
    <path d="M37.5 26.5H61.5A24 24 0 0 0 37.5 2.5Z" />
    <path d="M33.5 33.5V57.5A24 24 0 0 0 57.5 33.5Z" />
    <path d="M30.5 33.5H6.5A24 24 0 0 0 30.5 57.5Z" />
  </svg>
}

export function BrandMark({ showName = true, className }: { showName?: boolean; className?: string }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-control bg-white text-brand-navy ring-1 ring-white/15" aria-hidden>
        <OrvynnMark className="size-7" />
      </span>
      {showName && <span className="text-section tracking-tight">{BRAND.name}</span>}
    </div>
  )
}

interface SidebarContentProps {
  nav: NavItem[]
  activeId: string
  onNavigate: (id: string) => void
  footer?: ReactNode
}

function SidebarContent({ nav, activeId, onNavigate, footer }: SidebarContentProps) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav aria-label="Main navigation" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2">
        <ul className="space-y-1">
          {nav.map(({ id, label, icon: Icon }) => {
            const active = id === activeId
            return (
              <li key={id}>
                <button type="button" onClick={() => onNavigate(id)} aria-current={active ? 'page' : undefined} title={label}
                  className={cn('focus-ring-dark relative flex h-11 w-full items-center gap-3 rounded-control px-3 text-label transition-colors', active ? 'bg-white/10 text-white' : 'text-brand-pale hover:bg-white/5 hover:text-white')}>
                  {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-pale" aria-hidden />}
                  <Icon className="size-5 shrink-0" aria-hidden /><span>{label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
      <div className="mt-auto shrink-0 border-t border-white/10 px-3 pb-5 pt-5">
        <div className="rounded-xl border border-white/10 bg-white/[0.06] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Droplets className="size-4 text-[#A9CCFF]" aria-hidden />
            Testnet tools
          </div>
          <p className="mt-2 text-xs leading-5 text-brand-pale">
            Need test USDC? Switch your wallet to Arc Testnet, then get test funds from Circle.
          </p>
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring-dark mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-control bg-white px-3 text-xs font-semibold text-brand-navy transition-colors hover:bg-[#EAF2FC]"
          >
            <Droplets className="size-4" aria-hidden />
            Get test USDC
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        </div>
        <div className="mt-6 flex items-center justify-between px-1">
          <a href="/docs" className="inline-flex items-center gap-1.5 text-xs text-brand-pale transition-colors hover:text-white">
            <BookOpen className="size-3.5" aria-hidden />
            Documentation
          </a>
          {footer}
        </div>
      </div>
    </div>
  )
}

export interface AppShellProps {
  nav: NavItem[]
  activeId: string
  onNavigate: (id: string) => void
  sidebarFooter?: ReactNode
  topBarActions?: ReactNode | ((tone: 'dark' | 'light') => ReactNode)
  children: ReactNode
}

export function AppShell({ nav, activeId, onNavigate, sidebarFooter, topBarActions, children }: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const actions = (tone: 'dark' | 'light') => (typeof topBarActions === 'function' ? topBarActions(tone) : topBarActions)
  useEffect(() => {
    if (!mobileMenuOpen) return

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    const previousBodyOverflow = document.body.style.overflow
    const previousHtmlOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)

    return () => {
      document.body.style.overflow = previousBodyOverflow
      document.documentElement.style.overflow = previousHtmlOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [mobileMenuOpen])

  const handleNavigate = (id: string) => {
    onNavigate(id)
    setMobileMenuOpen(false)
  }

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-control bg-brand-navy px-4 py-2 text-label text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden h-dvh min-h-dvh w-[var(--ap-sidebar-rail)] bg-brand-navy bg-navy-gradient text-white md:block lg:w-[var(--ap-sidebar-wide)] xl:w-[var(--ap-sidebar-wider)]">
        <div className="flex h-full flex-col">
          <div className="flex h-16 shrink-0 items-center justify-center px-2 lg:justify-start lg:px-5">
            <BrandMark showName={false} className="text-white lg:hidden" /><BrandMark className="hidden text-white lg:flex" />
          </div>
          <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-2 py-2 lg:px-3">
            <ul className="space-y-1">
              {nav.map(({ id, label, icon: Icon }) => {
                const active = id === activeId
                return <li key={id}><button type="button" onClick={() => onNavigate(id)} aria-current={active ? 'page' : undefined} aria-label={label} title={label}
                  className={cn('focus-ring-dark relative flex h-11 w-full items-center justify-center gap-3 rounded-control px-2 text-label transition-colors lg:justify-start lg:px-3', active ? 'bg-white/10 text-white' : 'text-brand-pale hover:bg-white/5 hover:text-white')}>
                  {active && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-brand-pale" aria-hidden />}<Icon className="size-5 shrink-0" aria-hidden /><span className="hidden lg:inline">{label}</span>
                </button></li>
              })}
            </ul>
          </nav>
          {sidebarFooter && <div className="hidden shrink-0 border-t border-white/10 p-3 lg:block">{sidebarFooter}</div>}
        </div>
      </aside>

      <header className="sticky top-0 z-30 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between border-b border-white/10 bg-brand-navy bg-navy-gradient px-4 pt-[env(safe-area-inset-top)] text-white md:hidden">
        <BrandMark className="min-w-0 text-white" />
        <div className="flex shrink-0 items-center gap-2">
          {topBarActions && <div>{actions('dark')}</div>}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation-drawer"
            className="focus-ring-dark inline-flex size-11 items-center justify-center rounded-control text-white transition-colors hover:bg-white/10"
          >
            {mobileMenuOpen ? <X className="size-6" aria-hidden /> : <Menu className="size-6" aria-hidden />}
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={() => setMobileMenuOpen(false)}
          className="fixed inset-x-0 bottom-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-40 bg-[#101D35]/45 backdrop-blur-[2px] md:hidden"
        />
      )}
      <aside
        id="mobile-navigation-drawer"
        aria-label="Mobile navigation"
        aria-hidden={!mobileMenuOpen}
        className={cn(
          'fixed bottom-0 left-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 w-[min(18rem,86vw)] overflow-y-auto overscroll-contain border-r border-white/10 bg-brand-navy bg-navy-gradient text-white shadow-2xl transition-transform duration-300 ease-out md:hidden',
          mobileMenuOpen ? 'visible translate-x-0' : 'invisible -translate-x-full pointer-events-none',
        )}
      >
        <SidebarContent nav={nav} activeId={activeId} onNavigate={handleNavigate} footer={sidebarFooter} />
      </aside>

      <div className="md:pl-[var(--ap-sidebar-rail)] lg:pl-[var(--ap-sidebar-wide)] xl:pl-[var(--ap-sidebar-wider)]">
        <main id="main" className="page-wash min-h-dvh bg-canvas">
          <div className="mx-auto w-full max-w-[1200px] px-4 pb-8 pt-6 sm:px-6 md:px-8 md:pb-24 md:pt-8 xl:max-w-[1360px] xl:px-10">
            {topBarActions && <div className="mb-6 hidden justify-end md:flex">{actions('light')}</div>}
            {children}
            <footer className="relative mt-14 overflow-hidden rounded-[24px] bg-[#101D35] text-white shadow-[0_18px_48px_rgba(23,41,75,.12)]">
              <div className="pointer-events-none absolute inset-0 opacity-20"><img src="/images/orvynn-particle-hero.svg" alt="" className="h-full w-full object-cover object-center" /></div>
              <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full border border-white/10" />
              <div className="relative flex flex-col gap-7 p-5 sm:p-7 lg:flex-row lg:items-end lg:justify-between">
                <div className="max-w-lg">
                  <BrandMark className="text-white" />
                  <p className="mt-5 max-w-md text-sm leading-6 text-white/65">Spending limits for AI agents, enforced by smart contract.</p>
                  <span className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[.14em] text-[#BFD5F0]"><span className="size-1.5 rounded-full bg-[#8FB9EB]" /> Built for Arc · USDC</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <a href="/docs" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-xs font-medium text-white/85 transition hover:border-white/30 hover:bg-white/10 hover:text-white"><BookOpen className="size-4" /> Docs</a><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-full border border-white/15 px-4 text-xs font-medium text-white/85 transition hover:border-white/30 hover:bg-white/10 hover:text-white"><Github className="size-4" /> Source code <ArrowUpRight className="size-3.5" /></a>
                  <a href="https://arc.network" target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-full bg-white px-4 text-xs font-semibold text-brand-navy transition hover:bg-[#EAF2FC]">Explore Arc <ArrowUpRight className="size-3.5" /></a>
                </div>
              </div>
              <div className="relative flex flex-col gap-1 border-t border-white/10 px-5 py-3 text-[11px] text-white/45 sm:flex-row sm:items-center sm:justify-between sm:px-7"><span>{BRAND.name} · {BRAND.tagline}</span><span>USDC spending permissions on Arc.</span></div>
            </footer>
          </div>
        </main>
      </div>
    </div>
  )
}
