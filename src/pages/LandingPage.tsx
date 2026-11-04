import { ArrowRight, Check, Clock3, LockKeyhole, Wallet, ShieldCheck, Activity, Users } from 'lucide-react'
import { BRAND } from '@/lib/brand'

const steps = [
  { title: 'Create a lease', text: 'Choose a delegate wallet, set a spending cap and expiry, and optionally restrict who it can pay.', icon: LockKeyhole },
  { title: 'Fund it with USDC', text: 'Deposit the amount you want available. The spending cap and deposited balance remain separate controls.', icon: Wallet },
  { title: 'Stay in control', text: 'Monitor activity, revoke future spending, and withdraw the USDC that remains in the lease.', icon: Activity },
]

const features = [
  { eyebrow: 'PERMISSION LAYER', title: 'Give every agent a boundary.', text: 'Create separate leases with defined spending limits and expiry dates.', action: 'Explore leases', href: '/?page=leases', icon: ShieldCheck, art: 'blue' },
  { eyebrow: 'PAYMENT CONTROL', title: 'Decide where funds can go.', text: 'Optionally restrict a delegate to wallet addresses you approve.', action: 'Recipient rules', href: '/?page=leases', icon: Check, art: 'teal' },
  { eyebrow: 'OWNER OVERSIGHT', title: 'Keep control after funding.', text: 'Review activity, stop future spending, and withdraw remaining funds.', action: 'View activity', href: '/?page=activity', icon: Activity, art: 'violet' },
]

function OrvynnMark({ className }: { className?: string }) {
  return <svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true" className={className}>
    <path d="M30.5 30.5V6.5A24 24 0 0 0 6.5 30.5Z" /><path d="M37.5 26.5H61.5A24 24 0 0 0 37.5 2.5Z" /><path d="M33.5 33.5V57.5A24 24 0 0 0 57.5 33.5Z" /><path d="M30.5 33.5H6.5A24 24 0 0 0 30.5 57.5Z" />
  </svg>
}

function FeatureArt({ tone }: { tone: string }) {
  const tones: Record<string, string> = {
    blue: 'from-[#163D79] via-[#5B9FE8] to-[#DDEBFA]',
    teal: 'from-[#147D83] via-[#69B8B4] to-[#E0F0EA]',
    violet: 'from-[#7D83C8] via-[#B7BCE8] to-[#F0EFFA]',
  }
  return <div className={`relative h-40 overflow-hidden bg-gradient-to-br ${tones[tone]} sm:h-44`}>
    <div className="absolute -right-8 -top-16 size-64 rounded-full border border-white/40 bg-white/10 shadow-[inset_0_0_55px_rgba(255,255,255,.3)]" />
    <div className="absolute -bottom-32 left-8 h-64 w-[78%] rotate-[-18deg] rounded-[48%] border border-white/50 bg-white/10 shadow-[0_0_60px_rgba(255,255,255,.25)]" />
    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />
  </div>
}

export function LandingPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="min-h-dvh overflow-hidden bg-canvas text-ink">
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
        <a href="/" className="flex items-center gap-3" aria-label={BRAND.name + ' home'}>
          <span className="flex size-10 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-card"><OrvynnMark className="size-7" /></span>
          <span className="text-base font-semibold tracking-tight">{BRAND.name}</span>
        </a>
        <div className="flex items-center gap-3">
          <a href="/docs" className="text-sm font-medium text-ink-soft transition hover:text-ink">Docs</a><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="hidden text-sm font-medium text-ink-soft transition hover:text-ink sm:inline-flex">Source code</a>
          <button onClick={onLaunch} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-brand-navy shadow-card transition hover:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Open app <ArrowRight className="size-4" aria-hidden /></button>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-7xl items-center gap-9 px-5 pb-16 pt-10 sm:px-8 sm:pb-20 sm:pt-14 lg:grid-cols-[.9fr_1.1fr] lg:gap-14 lg:px-10 lg:pb-24 lg:pt-20">
          <div className="max-w-2xl">
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium uppercase tracking-[.14em] text-brand-blue"><span className="size-1.5 rounded-full bg-brand-blue" /> Built for Arc</p>
            <h1 className="mt-6 text-[2.45rem] font-light leading-[1.08] tracking-[-.045em] text-brand-navy sm:text-[3.35rem] lg:text-[4.1rem]">Give agents a spending limit, <span className="text-brand-blue">not your keys.</span></h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink-soft sm:text-lg sm:leading-8">{BRAND.name} gives AI-agent delegates bounded USDC spending permissions on Arc. Set the rules, fund a lease, and stay in control of what happens next.</p>
            <div className="mt-7 flex flex-col gap-3 min-[420px]:flex-row">
              <button onClick={onLaunch} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-brand-navy px-6 text-sm font-medium text-white shadow-[0_12px_30px_rgba(23,41,75,.16)] transition hover:bg-brand-blue">Launch Orvynn <ArrowRight className="size-4" aria-hidden /></button>
              <a href="#how-it-works" className="inline-flex min-h-12 items-center justify-center rounded-full border border-line bg-white px-6 text-sm font-medium text-brand-navy transition hover:bg-surface-muted">How it works</a>
            </div>
            <p className="mt-5 text-xs leading-5 text-ink-mute">On-chain spending rules. Owner-controlled leases. USDC on Arc.</p>
          </div>

          <div className="relative mx-auto w-full max-w-[620px]">
            <div className="absolute -inset-5 rounded-[2rem] bg-[radial-gradient(ellipse,rgba(112,159,216,.24),transparent_70%)] blur-2xl" />
            <article className="relative isolate overflow-hidden rounded-[28px] bg-[#0E0E0F] text-white shadow-[0_28px_80px_rgba(23,41,75,.2)]">
              <div className="relative h-[220px] overflow-hidden sm:h-[270px] lg:h-[300px]">
                <img src="/images/orvynn-particle-hero.svg" alt="Particle illustration connecting an owner and an AI agent" className="absolute inset-0 h-full w-full object-cover object-center" />
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-[#101820]" />
                <div className="absolute left-5 top-5 rounded-full border border-white/15 bg-black/25 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[.16em] text-white/75 backdrop-blur sm:left-7 sm:top-7">Owner → agent permission</div>
              </div>
              <div className="relative bg-gradient-to-b from-[#101820] to-[#111820] px-5 pb-6 pt-1 sm:px-7 sm:pb-7">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[10px] font-medium uppercase tracking-[.16em] text-white/55">LEASE BALANCE</p><p className="mt-2 text-3xl font-light tracking-tight sm:text-4xl">12,450.00 <span className="text-base text-white/65">USDC</span></p></div>
                  <span className="mt-1 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-[10px] font-medium text-emerald-200">Example data</span>
                </div>
                <div className="mt-5 flex items-center justify-between gap-4 text-xs text-white/65"><span>Monthly spending limit</span><span>25,000 USDC</span></div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-1/2 rounded-full bg-gradient-to-r from-[#5C9FE9] to-[#9CCBFA]" /></div>
                <div className="mt-2 flex justify-between text-[11px] text-white/45"><span>50% allocated</span><span>50% available</span></div>\n                <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-5 text-white/45">Sample figures for illustration only. This is not live wallet or lease data.</p>
              </div>
            </article>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 pb-20 sm:px-8 sm:pb-24 lg:px-10">
          <div className="mb-8 flex flex-col gap-3 sm:mb-10 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl"><p className="text-[11px] font-medium uppercase tracking-[.16em] text-brand-blue">Control, built in</p><h2 className="mt-3 text-[2rem] font-light leading-[1.1] tracking-[-.035em] text-brand-navy sm:text-[2.8rem]">A safer way to delegate spending.</h2></div>
            <p className="max-w-sm text-sm leading-6 text-ink-soft">Give agents room to operate without giving them unrestricted access to your funds.</p>
          </div>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {features.map(({ eyebrow, title, text, action, href, icon: Icon, art }) => <article key={title} className="group overflow-hidden rounded-[24px] border border-[#E9E8E4] bg-white shadow-[0_14px_38px_rgba(27,38,55,.055)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_20px_48px_rgba(27,38,55,.09)]">
              <FeatureArt tone={art} />
              <div className="relative -mt-3 bg-gradient-to-b from-white/0 via-white/95 to-white px-6 pb-7 pt-5 sm:px-7">
                <p className="text-[10px] font-medium uppercase tracking-[.15em] text-brand-blue">{eyebrow}</p>
                <h3 className="mt-3 text-xl font-medium leading-snug tracking-[-.025em] text-brand-navy">{title}</h3>
                <p className="mt-2 min-h-12 text-sm leading-6 text-ink-soft">{text}</p>
                <a href={href} aria-label={`${action}: ${title}`} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-4 text-xs font-medium text-brand-navy transition hover:border-brand-pale hover:bg-brand-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"><Icon className="size-3.5 text-brand-blue" />{action}<ArrowRight className="size-3.5" aria-hidden /></a>
              </div>
            </article>)}
          </div>
        </section>

        <section id="how-it-works" className="border-y border-line bg-white/70 py-16 sm:py-20">
          <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
            <div className="max-w-2xl"><p className="text-[11px] font-medium uppercase tracking-[.15em] text-brand-blue">How it works</p><h2 className="mt-3 text-[2rem] font-light leading-[1.1] tracking-[-.035em] text-brand-navy sm:text-[2.8rem]">A clear boundary between an agent and your funds.</h2><p className="mt-4 leading-7 text-ink-soft">Instead of handing a delegate unrestricted wallet access, give it a specific permission enforced by the contract.</p></div>
            <div className="mt-10 grid gap-4 md:grid-cols-3 md:gap-5">
              {steps.map(({ title, text, icon: Icon }, index) => <article key={title} className="group relative overflow-hidden rounded-[22px] border border-[#DCE6F2] bg-white p-5 shadow-[0_10px_28px_rgba(23,41,75,.045)] transition duration-300 hover:-translate-y-1 hover:border-[#B9CDE6] hover:shadow-[0_18px_38px_rgba(23,41,75,.09)] sm:p-7">
                <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#315B91] via-[#6C8FCB] to-[#A9C4E8]" />
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-flex items-center rounded-full border border-[#DCE6F2] bg-[#F5F8FC] px-3 py-1 text-[10px] font-semibold uppercase tracking-[.14em] text-brand-blue">Step 0{index + 1}</span>
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#EAF2FC] to-[#E8E5F7] text-brand-blue ring-1 ring-[#DCE6F2] transition group-hover:scale-105"><Icon className="size-5" /></span>
                </div>
                <h3 className="mt-6 text-lg font-semibold tracking-[-.02em] text-brand-navy sm:text-xl">{title}</h3>
                <p className="mt-2 text-sm leading-6 text-ink-soft">{text}</p>
                <div className="mt-6 h-px w-full bg-gradient-to-r from-[#DCE6F2] via-[#E9EEF6] to-transparent" />
                <p className="mt-3 text-[11px] font-medium tracking-wide text-brand-blue">{index === 0 ? 'DEFINE PERMISSIONS' : index === 1 ? 'ADD FUNDS' : 'RETAIN OVERSIGHT'}</p>
              </article>)}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-24 lg:px-10">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
            <div><p className="text-[11px] font-medium uppercase tracking-[.16em] text-brand-blue">Designed around control</p><h2 className="mt-3 text-[2rem] font-light leading-[1.1] tracking-[-.035em] text-brand-navy sm:text-[2.65rem]">Permission without giving up ownership.</h2><p className="mt-4 max-w-md leading-7 text-ink-soft">Each lease is a separate set of spending rules. You decide the delegate, the limit, the duration and whether recipients need to be pre-approved.</p></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <article className="overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_12px_32px_rgba(27,38,55,.045)]"><div className="h-24 bg-[radial-gradient(ellipse_at_75%_25%,rgba(105,161,224,.55),transparent_55%),linear-gradient(135deg,#EAF1F9,#D8E7F7)]" /><div className="-mt-2 bg-gradient-to-b from-white/0 to-white px-6 pb-6 pt-4"><span className="flex size-10 items-center justify-center rounded-xl bg-[#EAF1F9] text-brand-blue"><Users className="size-5" /></span><h3 className="mt-4 text-base font-medium text-brand-navy">Recipient restrictions</h3><p className="mt-2 text-sm leading-6 text-ink-soft">Optionally limit payments to wallet addresses you approve.</p></div></article>
              <article className="overflow-hidden rounded-[24px] border border-line bg-white shadow-[0_12px_32px_rgba(27,38,55,.045)]"><div className="h-24 bg-[radial-gradient(ellipse_at_25%_25%,rgba(92,180,170,.5),transparent_55%),linear-gradient(135deg,#E8F4F0,#D5EAE3)]" /><div className="-mt-2 bg-gradient-to-b from-white/0 to-white px-6 pb-6 pt-4"><span className="flex size-10 items-center justify-center rounded-xl bg-[#E7F2EF] text-[#267F79]"><Clock3 className="size-5" /></span><h3 className="mt-4 text-base font-medium text-brand-navy">Owner control</h3><p className="mt-2 text-sm leading-6 text-ink-soft">Revoke a lease to stop future payments. Withdrawals are a separate action.</p></div></article>
            </div>
          </div>
          <div className="mt-10 rounded-[20px] border border-line bg-white px-5 py-5 text-sm leading-6 text-ink-soft sm:px-6"><strong className="text-brand-navy">A note on funds:</strong> Revoking a lease stops future spending; it does not automatically withdraw the remaining balance. The owner must submit a separate withdrawal transaction. Funds already spent cannot be recovered.</div>
        </section>

        <section className="px-5 pb-20 sm:px-8 sm:pb-24 lg:px-10">
          <div className="relative mx-auto max-w-7xl overflow-hidden rounded-[28px] bg-[#101820] px-6 py-12 text-white shadow-[0_24px_70px_rgba(23,41,75,.17)] sm:px-10 sm:py-16">
            <div className="pointer-events-none absolute inset-0 opacity-30"><img src="/images/orvynn-particle-hero.svg" alt="" className="h-full w-full object-cover object-center" /></div>
            <div className="relative mx-auto max-w-2xl text-center"><p className="text-[10px] font-medium uppercase tracking-[.17em] text-[#AFCBEA]">Take control of agent spending</p><h2 className="mt-4 text-[2rem] font-light leading-[1.1] tracking-[-.035em] sm:text-[2.7rem]">Set the rules before the first payment.</h2><p className="mt-4 leading-7 text-white/65">Create a lease and give your delegate only the permissions it needs.</p><button onClick={onLaunch} className="mt-8 inline-flex min-h-12 items-center gap-2 rounded-full bg-white px-6 text-sm font-medium text-brand-navy transition hover:bg-mist">Open Orvynn <ArrowRight className="size-4" /></button></div>
          </div>
        </section>
      </main>

      <footer className="relative overflow-hidden bg-canvas">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-[.12]"><img src="/images/orvynn-particle-hero.svg" alt="" className="h-full w-full object-cover object-[center_42%]" /></div>
        <div className="relative mx-auto max-w-7xl px-5 pb-10 pt-12 sm:px-8 sm:pb-12 sm:pt-14 lg:px-10">
          <div className="flex flex-col gap-6 pb-8 sm:flex-row sm:items-center sm:justify-between">
            <div><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="text-base font-normal text-brand-navy transition hover:text-brand-blue">Contact via GitHub</a><p className="mt-2 text-sm text-ink-soft">Questions, feedback or contributions.</p></div>
            <div className="flex items-center justify-between gap-5 sm:justify-end">
              <a href={BRAND.repoUrl} target="_blank" rel="noreferrer" aria-label="Orvynn on GitHub" className="inline-flex size-10 items-center justify-center rounded-full text-brand-navy transition hover:bg-white hover:text-brand-blue"><svg viewBox="0 0 24 24" aria-hidden="true" className="size-5" fill="currentColor"><path d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.56.1.76-.24.76-.54v-2.1c-3.1.67-3.76-1.31-3.76-1.31-.5-1.28-1.23-1.62-1.23-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.71 1.15 1.71 1.15.99 1.7 2.6 1.21 3.23.93.1-.72.39-1.21.7-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.05 1.15a10.6 10.6 0 0 1 5.55 0c2.11-1.45 3.05-1.15 3.05-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.29-2.61 5.24-5.1 5.51.4.35.75 1.03.75 2.08v3.07c0 .3.2.65.77.54A11.1 11.1 0 0 0 12 .9Z"/></svg></a>
              <button onClick={onLaunch} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-sm font-medium text-brand-navy shadow-card transition hover:bg-surface-muted">Open app <ArrowRight className="size-4" aria-hidden /></button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-8 pt-5 sm:grid-cols-2 sm:gap-10 lg:grid-cols-3 lg:gap-16">
            <div><p className="text-[11px] font-medium uppercase tracking-[.08em] text-ink-mute">Product</p><nav aria-label="Product links" className="mt-4 flex flex-col items-start gap-3 text-[15px] leading-6 text-ink"><a href="#how-it-works" className="transition hover:text-brand-blue">How it works</a><a href="/docs" className="transition hover:text-brand-blue">Documentation</a><a href="/?page=overview" className="transition hover:text-brand-blue">Overview</a><a href="/?page=leases" className="transition hover:text-brand-blue">Leases</a></nav></div>
            <div><p className="text-[11px] font-medium uppercase tracking-[.08em] text-ink-mute">Developers</p><nav aria-label="Developer links" className="mt-4 flex flex-col items-start gap-3 text-[15px] leading-6 text-ink"><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="transition hover:text-brand-blue">GitHub repository</a><a href={BRAND.repoUrl + '/tree/main/contracts'} target="_blank" rel="noreferrer" className="transition hover:text-brand-blue">Smart contracts</a></nav></div>
            <div><p className="text-[11px] font-medium uppercase tracking-[.08em] text-ink-mute">Company</p><nav aria-label="Company links" className="mt-4 flex flex-col items-start gap-3 text-[15px] leading-6 text-ink"><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="transition hover:text-brand-blue">About Orvynn</a><a href="https://arc.network" target="_blank" rel="noreferrer" className="transition hover:text-brand-blue">Built for Arc</a></nav></div>
          </div>
          <div className="mt-10 flex flex-col gap-2 text-xs leading-5 text-ink-mute sm:flex-row sm:items-center sm:justify-between"><p>{BRAND.name} · {BRAND.tagline}</p><p>USDC spending permissions on Arc.</p></div>
        </div>
      </footer>
    </div>
  )
}
