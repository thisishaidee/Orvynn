import { Ban, Gauge, ListChecks, type LucideIcon } from 'lucide-react'
import { useAccount } from 'wagmi'
import { Badge, Button, Card, CardHeader, PageHeader, StatCard } from '@/components/ui'
import { InfoList, InfoRow } from '@/components/agentpay/Notices'
import { BRAND } from '@/lib/brand'
import { useNetworkInfo } from '@/lib/wallet'
import { getAgentPayAddress } from '@/lib/agentpay-address'
import type { PageId } from '@/lib/route'
import { useLeases, leaseStatus } from '@/lib/agentpay'

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Gauge, title: 'Per-period cap', text: 'An agent can spend up to its limit each period, and the limit resets on its own.' },
  { icon: ListChecks, title: 'Approved recipients', text: 'Optionally restrict every payment to addresses you have approved.' },
  { icon: Ban, title: 'Revoke any time', text: 'Cut off an agent instantly and withdraw whatever is left.' },
]

/** Product introduction plus a setup checklist driven by real wallet state. No balances or leases are shown. */
export function OverviewPage({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const { isConnected } = useAccount()
  const leases = useLeases()
  const activeLeaseCount = leases.state === 'ready' ? leases.items.filter((lease) => leaseStatus(lease) === 'active').length : undefined
  const network = useNetworkInfo()
  const contractAddress = getAgentPayAddress(network.chainId)
  const contractConfigured = Boolean(contractAddress)

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader eyebrow={BRAND.name} title="Overview" description={BRAND.tagline} actions={<Button size="sm" variant="secondary" onClick={() => onNavigate("activity")}>View activity</Button>} />

      <Card tone="featured" padding="lg">
        <p className="text-overline uppercase text-brand-pale">Spending control for AI agents</p>
        <h2 className="mt-2 max-w-xl text-page-sm md:text-page">Give agents a spending limit, not your keys.</h2>
        <p className="mt-2 max-w-xl text-body text-brand-pale">
          Lease USDC to an agent with a cap, an expiry and an optional recipient list. The contract enforces the rules.
        </p>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Leases" value={leases.state === 'ready' ? leases.items.length : undefined} hint="Permissions created from this wallet" />
        <StatCard label="Active leases" value={activeLeaseCount} hint="Currently within their rules" />
      </div>

      <ul className="grid gap-4 md:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title}>
            <Card tone="soft" className="h-full">
              <span className="mb-3 flex size-10 items-center justify-center rounded-control bg-surface text-brand-blue shadow-card" aria-hidden>
                <Icon className="size-5" />
              </span>
              <h3 className="text-label text-ink">{title}</h3>
              <p className="mt-1 text-support text-ink-soft">{text}</p>
            </Card>
          </li>
        ))}
      </ul>

      <Card className="overflow-hidden">
        <div className="mb-4 rounded-xl bg-brand-mist/70 p-4 sm:p-5">
          <p className="text-overline uppercase text-brand-blue">Workspace readiness</p>
          <h2 className="mt-1 text-section text-brand-navy">Your Orvynn control centre</h2>
          <p className="mt-1 text-support text-ink-soft">A live checklist of the wallet and contract connection required before managing agent spending.</p>
        </div>
        <CardHeader title="Setup status" description="What is ready and what is not, based on your wallet right now." />
        <InfoList>
          <InfoRow label="Wallet">
            <span className="inline-flex flex-wrap items-center gap-3 md:justify-end">
              <Badge tone={isConnected ? 'success' : 'neutral'}>{isConnected ? 'Connected' : 'Not connected'}</Badge>
              <Button size="sm" variant="ghost" onClick={() => onNavigate('wallet')}>
                Open Wallet
              </Button>
            </span>
          </InfoRow>
          <InfoRow label="Network" hint={isConnected ? network.label : undefined}>
            {isConnected ? <Badge tone={network.supported ? 'success' : 'warning'}>{network.supported ? 'Supported' : 'Not supported'}</Badge> : <Badge tone="neutral">Waiting for wallet</Badge>}
          </InfoRow>
          <InfoRow label="Contract connection" hint={contractConfigured ? `Configured for ${network.label}.` : 'The contract address is not configured for this network yet.'}>
            <Badge tone={contractConfigured ? 'success' : 'warning'}>{contractConfigured ? 'Address configured' : 'Not configured'}</Badge>
          </InfoRow>
          <InfoRow label="Leases, agents and activity" hint="Read from the configured contract when your wallet is on the matching Arc network.">
            <Badge tone={contractConfigured && isConnected && network.supported ? 'success' : 'neutral'}>{contractConfigured && isConnected && network.supported ? 'Ready to read' : 'Waiting for setup'}</Badge>
          </InfoRow>
        </InfoList>
      </Card>
    </div>
  )
}
