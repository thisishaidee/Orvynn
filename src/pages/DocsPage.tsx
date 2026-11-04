import { ArrowLeft, ArrowUpRight, BookOpen, Code2, Compass, Github, LockKeyhole, ShieldCheck, Wallet } from 'lucide-react'
import { BRAND } from '@/lib/brand'

const sections = [
  { id: 'start-here', label: 'Start here', icon: Compass },
  { id: 'how-it-works', label: 'How it works', icon: BookOpen },
  { id: 'using-orvynn', label: 'Using Orvynn', icon: Wallet },
  { id: 'developers', label: 'For developers', icon: Code2 },
  { id: 'security', label: 'Security and limits', icon: ShieldCheck },
]

function SectionTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) {
  return <div className="max-w-3xl"><p className="text-[11px] font-semibold uppercase tracking-[.16em] text-brand-blue">{eyebrow}</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-brand-navy sm:text-3xl">{title}</h2>{children && <div className="mt-3 text-sm leading-7 text-ink-soft sm:text-base">{children}</div>}</div>
}

function DocCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <article className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_26px_rgba(23,41,75,.04)] sm:p-6"><h3 className="text-base font-semibold text-brand-navy">{title}</h3><div className="mt-2 text-sm leading-6 text-ink-soft">{children}</div></article>
}

export function DocsPage({ onLaunch }: { onLaunch: () => void }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold text-brand-navy"><span className="flex size-8 items-center justify-center rounded-lg bg-brand-navy text-white">O</span>{BRAND.name}<span className="font-normal text-ink-mute">/ Docs</span></a>
          <div className="flex items-center gap-2"><a href="/" className="hidden min-h-10 items-center gap-2 rounded-full px-3 text-xs font-medium text-ink-soft hover:bg-white sm:inline-flex"><ArrowLeft className="size-3.5" /> Home</a><button onClick={onLaunch} className="inline-flex min-h-10 items-center gap-2 rounded-full bg-brand-navy px-4 text-xs font-semibold text-white transition hover:bg-brand-blue">Open app <ArrowUpRight className="size-3.5" /></button></div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-8 sm:px-6 sm:py-12 lg:grid-cols-[220px_minmax(0,1fr)] lg:px-8">
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <p className="px-3 text-[10px] font-semibold uppercase tracking-[.16em] text-ink-mute">Documentation</p>
          <nav aria-label="Documentation sections" className="mt-3 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
            {sections.map(({ id, label, icon: Icon }) => <a key={id} href={`#${id}`} className="flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-ink-soft transition hover:bg-white hover:text-brand-navy"><Icon className="size-4 shrink-0 text-brand-blue" />{label}</a>)}
          </nav>
          <div className="mt-6 hidden rounded-2xl border border-line bg-white p-4 lg:block"><p className="text-xs font-semibold text-brand-navy">Need the source?</p><p className="mt-1 text-xs leading-5 text-ink-soft">Read the implementation and contribute on GitHub.</p><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue">Open repository <ArrowUpRight className="size-3.5" /></a></div>
        </aside>

        <main className="min-w-0">
          <section id="start-here" className="scroll-mt-24">
            <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-brand-blue">Orvynn documentation</p>
            <h1 className="mt-3 max-w-4xl text-4xl font-light leading-[1.08] tracking-[-.04em] text-brand-navy sm:text-5xl lg:text-6xl">Give AI agents room to act. <span className="text-brand-blue">Keep spending under control.</span></h1>
            <p className="mt-5 max-w-3xl text-base leading-7 text-ink-soft sm:text-lg sm:leading-8">Orvynn is a self-custody USDC spending-lease application for AI-agent delegates on Arc. It lets a wallet owner give an agent a defined spending permission instead of unrestricted access to the owner's wallet.</p>
            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-brand-navy p-4 text-white"><p className="text-[10px] font-medium uppercase tracking-wider text-white/55">Network</p><p className="mt-1 text-lg font-medium">Arc</p><p className="text-xs text-white/65">Mainnet and testnet</p></div>
              <div className="rounded-2xl border border-line bg-white p-4"><p className="text-[10px] font-medium uppercase tracking-wider text-ink-mute">Asset</p><p className="mt-1 text-lg font-medium text-brand-navy">USDC</p><p className="text-xs text-ink-soft">6 decimal places</p></div>
              <div className="rounded-2xl border border-line bg-white p-4"><p className="text-[10px] font-medium uppercase tracking-wider text-ink-mute">Permission model</p><p className="mt-1 text-lg font-medium text-brand-navy">Spending leases</p><p className="text-xs text-ink-soft">Owner-defined boundaries</p></div>
            </div>
          </section>

          <section className="mt-16 scroll-mt-24" id="how-it-works">
            <SectionTitle eyebrow="The model" title="A lease creates a boundary between an agent and your funds.">The owner sets the permission. The delegate can spend only within the on-chain rules and available lease balance. The Orvynn smart contract enforces those rules on Arc.</SectionTitle>
            <div className="mt-6 grid gap-3 md:grid-cols-3">
              <DocCard title="1. Define permission">Choose the delegate wallet, spending cap and expiry. You can also restrict payments to approved recipient addresses.</DocCard>
              <DocCard title="2. Fund the lease">Approve USDC and deposit funds into the lease. The spending cap is a rule; the deposited balance is the amount available to spend.</DocCard>
              <DocCard title="3. Monitor and manage">Review activity, update recipient permissions, revoke future spending or withdraw the remaining balance as separate actions.</DocCard>
            </div>
            <div className="mt-4 rounded-2xl border border-[#DCE6F2] bg-[#F1F6FC] p-5 text-sm leading-6 text-brand-navy"><strong>Important:</strong> Revoking a lease stops future delegate spending. It does not automatically withdraw the remaining USDC. The owner must submit a separate withdrawal transaction.</div>
          </section>

          <section className="mt-16 scroll-mt-24" id="using-orvynn">
            <SectionTitle eyebrow="For owners and delegates" title="Using Orvynn">You can read this documentation without connecting a wallet. A wallet is required only when you use the app to read wallet-specific information or submit a transaction.</SectionTitle>
            <div className="mt-6 space-y-3">
              <DocCard title="For the lease owner">
                <ol className="list-decimal space-y-2 pl-5"><li>Open the app and connect a supported wallet on Arc Mainnet or Arc Testnet.</li><li>Create a lease for the delegate wallet, set its spending cap and expiry, and choose whether to enable recipient restrictions.</li><li>Approve the USDC allowance when prompted, then confirm the separate lease-funding transaction.</li><li>Use the lease and activity views to monitor spending. You can top up, change permitted recipients, revoke, or withdraw remaining funds.</li></ol>
              </DocCard>
              <DocCard title="For the agent delegate">The delegate uses the wallet address assigned to the lease. It can submit a spend only while the lease is active, within its spending rules, and with sufficient available balance. Each transaction still requires the delegate wallet to sign.</DocCard>
              <DocCard title="Supported networks">
                <ul className="list-disc space-y-1 pl-5"><li>Arc Mainnet (chain ID <code className="rounded bg-surface-muted px-1.5 py-0.5">5042</code>).</li><li>Arc Testnet (chain ID <code className="rounded bg-surface-muted px-1.5 py-0.5">5042002</code>).</li></ul>
                <p className="mt-2">The frontend is configured for these Arc networks. Ethereum is not a supported Orvynn network.</p>
              </DocCard>
            </div>
          </section>

          <section className="mt-16 scroll-mt-24" id="developers">
            <SectionTitle eyebrow="Build with Orvynn" title="Developer resources">The application is built with Solidity, Foundry, React, Vite, TypeScript, wagmi and viem. The contract is the enforcement layer; the frontend reads state and asks wallets to sign transactions.</SectionTitle>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <DocCard title="Smart contract and architecture"><p>Review the system components, owner/delegate responsibilities, transaction flow and network configuration.</p><a href={BRAND.repoUrl + '/blob/main/docs/architecture.md'} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-brand-blue">Read architecture <ArrowUpRight className="size-3.5" /></a></DocCard>
              <DocCard title="AI-agent integration"><p>Read the payment-preparation tool schema and server-side integration guidance. The preparation API validates and simulates; it does not sign or broadcast a transaction.</p><a href={BRAND.repoUrl + '/blob/main/agent/AI_AGENT_INTEGRATION.md'} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-brand-blue">Read integration guide <ArrowUpRight className="size-3.5" /></a></DocCard>
              <DocCard title="Repository and setup"><p>Explore the source, install dependencies and follow the build and test instructions in the project README.</p><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-brand-blue">View GitHub <ArrowUpRight className="size-3.5" /></a></DocCard>
              <DocCard title="Mainnet deployment"><p>Deployment is a separate on-chain operation. Review the repository's deployment guide before making any deployment changes.</p><a href={BRAND.repoUrl + '/blob/main/docs/deploy-agentpay-mainnet.md'} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 font-semibold text-brand-blue">Read deployment guide <ArrowUpRight className="size-3.5" /></a></DocCard>
            </div>
            <div className="mt-4 rounded-2xl border border-line bg-white p-5"><p className="text-xs font-semibold uppercase tracking-wider text-ink-mute">Arc Mainnet contract</p><p className="mt-2 break-all font-mono text-xs text-brand-navy sm:text-sm">0xA549B60313A86288d46323e5723AAa4c0fAA6363</p><a href="https://explorer.arc.io/address/0xA549B60313A86288d46323e5723AAa4c0fAA6363" target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-brand-blue">View on Arc Explorer <ArrowUpRight className="size-3.5" /></a></div>
          </section>

          <section className="mt-16 scroll-mt-24" id="security">
            <SectionTitle eyebrow="Know the boundaries" title="What Orvynn controls, and what it does not control">Orvynn is designed so wallet owners retain custody and the contract enforces lease permissions. Understand these boundaries before funding a lease.</SectionTitle>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <DocCard title="Your wallet keeps the keys">Orvynn does not receive or store wallet private keys. Wallets explicitly confirm transactions.</DocCard>
              <DocCard title="Funding takes two steps">USDC approval and lease funding are separate transactions. Review each transaction in your wallet before confirming.</DocCard>
              <DocCard title="Revocation is not a refund">Revocation prevents future spending under the lease. It does not reverse completed payments or automatically return unused funds.</DocCard>
              <DocCard title="Tests are not an audit">Automated tests help catch implementation errors, but they are not an independent professional security audit. Smart-contract use carries risk.</DocCard>
            </div>
          </section>

          <section className="mt-16 rounded-3xl bg-brand-navy p-6 text-white sm:p-9">
            <div className="flex items-start gap-4"><LockKeyhole className="mt-1 size-6 shrink-0 text-brand-pale" /><div><h2 className="text-xl font-medium">Ready to explore the app?</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Open Orvynn to connect a wallet, create a lease or review an existing one. You can return to these docs at any time.</p><div className="mt-5 flex flex-wrap gap-3"><button onClick={onLaunch} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 text-xs font-semibold text-brand-navy hover:bg-brand-mist">Open Orvynn <ArrowUpRight className="size-3.5" /></button><a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/20 px-5 text-xs font-medium text-white hover:bg-white/10"><Github className="size-3.5" /> Source code</a></div></div></div>
          </section>
          <footer className="mt-10 border-t border-line pt-5 text-xs leading-5 text-ink-mute"><p>{BRAND.name} documentation · Built for Arc · USDC spending permissions.</p><p className="mt-1">Documentation describes the current implementation and is not financial, legal or security advice.</p></footer>
        </main>
      </div>
    </div>
  )
}
