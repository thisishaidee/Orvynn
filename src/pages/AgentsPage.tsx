import { useMemo } from 'react'
import { ArrowRight, Bot, ShieldCheck, WalletCards, Activity } from 'lucide-react'
import { Badge, Card, CardHeader, DataTable, PageHeader, StatusBadge, StatCard, type Column } from '@/components/ui'
import { NotConnectedNotice } from '@/components/agentpay/Notices'
import { SourceEmpty } from '@/components/agentpay/SourceEmpty'
import { DelegateSpendPanel } from '@/components/agentpay/DelegateSpendPanel'
import { leaseStatus, shortAddress, useLeases, type Lease } from '@/lib/agentpay'

interface AgentRow {
  address: string
  leases: Lease[]
  canSpend: boolean
}

const STEPS = [
  'You create a lease that names the agent’s wallet address.',
  'You set a spending cap, a period, an expiry and, if you want, an approved recipient list.',
  'The agent can spend only within those rules. You can revoke at any time.',
]

export function AgentsPage() {
  const source = useLeases()

  // The contract has no agent registry: an agent is simply the delegate address on a lease.
  const agents = useMemo<AgentRow[]>(() => {
    const map = new Map<string, Lease[]>()
    for (const lease of source.items) map.set(lease.delegate, [...(map.get(lease.delegate) ?? []), lease])
    return [...map].map(([address, leases]) => ({ address, leases, canSpend: leases.some((l) => leaseStatus(l) === 'active') }))
  }, [source.items])

  const columns: Column<AgentRow>[] = [
    {
      key: 'agent',
      header: 'Agent',
      primary: true,
      cell: () => (
        <span className="flex flex-col">
          <span>Unnamed agent</span>
          <span className="text-support font-normal text-ink-soft">Identified by wallet address</span>
        </span>
      ),
    },
    { key: 'address', header: 'Wallet address', cell: (a) => <span className="num font-mono text-support" title={a.address}>{shortAddress(a.address)}</span> },
    {
      key: 'lease',
      header: 'Lease',
      cell: (a) => (a.leases.length === 1 ? `Lease ${a.leases[0].id}` : `${a.leases.length} leases`),
    },
    {
      key: 'status',
      header: 'Spending status',
      cell: (a) => (a.canSpend ? <StatusBadge status="active" /> : <Badge tone="neutral">Cannot spend</Badge>),
    },
  ]

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        eyebrow="Agents"
        title="Agents"
        description="An agent is an AI program with its own wallet address. You give it a lease so it can pay within limits you set."
        actions={<a href="/?page=leases" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-brand-navy px-5 text-sm font-medium text-white shadow-card transition hover:bg-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue">Create a lease <ArrowRight className="size-4" aria-hidden /></a>}
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Agents identified" value={source.state === 'ready' ? agents.length : 0} icon={<Bot className="size-4" />} hint="Unique delegate wallets" />
        <StatCard label="Active agents" value={source.state === 'ready' ? agents.filter((a) => a.canSpend).length : 0} icon={<Activity className="size-4" />} hint="With an active lease" />
        <StatCard label="Leases assigned" value={source.state === 'ready' ? source.items.length : 0} icon={<WalletCards className="size-4" />} hint="Across all delegate wallets" />
      </div>
      <NotConnectedNotice subject="Agents" />

      <DelegateSpendPanel />

      <Card tone="featured" className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-8 -top-12 size-48 rounded-full border-[24px] border-white/5" />
        <div className="relative flex items-start gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white"><ShieldCheck className="size-5" /></span>
          <div><p className="text-overline uppercase text-brand-pale">Delegated access</p><h2 className="mt-1 text-section text-white">An agent gets permission, not ownership.</h2><p className="mt-1 max-w-2xl text-support text-brand-pale">Every agent is identified by its wallet address. Its ability to spend comes from the leases you create and the rules enforced by the contract.</p></div>
        </div>
      </Card>
      <Card>
        <CardHeader title="How agents work in Orvynn" description="Three steps from authorization to controlled spending." />
        <ol className="space-y-3">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 text-body">
              <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-mist text-label text-brand-blue" aria-hidden>
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-support text-ink-soft">
          The contract stores agent addresses only, so an agent appears here once a lease names it. Names will be labels kept in this app.
        </p>
      </Card>

      <Card padding="none" className="overflow-hidden">
        <div className="border-b border-line bg-gradient-to-r from-brand-mist/70 to-transparent p-4 sm:p-5 lg:p-6">
          <CardHeader title="Your agents" description="Delegate wallets currently associated with your leases." className="mb-0" />
        </div>
        <DataTable
          caption="Agents"
          columns={columns}
          rows={agents}
          getRowId={(a) => a.address}
          loading={source.state === 'loading'}
          error={source.state === 'error' ? source.reason : undefined}
          empty={
            <SourceEmpty
              state={source.state}
              reason={source.reason}
              subject="Agents"
              icon={Bot}
              readyTitle="No agents yet"
              readyDescription="Authorize an agent by creating a lease for its wallet address."
            />
          }
        />
      </Card>
    </div>
  )
}
