import { History, ArrowDownLeft, ArrowUpRight, ShieldCheck, Activity as ActivityIcon } from 'lucide-react'
import { useAccount } from 'wagmi'
import { Card, CardHeader, DataTable, PageHeader, StatusBadge, StatCard, type Column } from '@/components/ui'
import { NotConnectedNotice } from '@/components/agentpay/Notices'
import { SourceEmpty } from '@/components/agentpay/SourceEmpty'
import {
  ACTIVITY_LABELS,
  formatDateTime,
  formatUsdc,
  shortAddress,
  useActivity,
  type ActivityItem,
  type ActivityType,
} from '@/lib/agentpay'

const AMOUNT_EVENTS: ActivityType[] = ['Deposited', 'Spent', 'Withdrawn']

const columns: Column<ActivityItem>[] = [
  { key: 'type', header: 'Type', primary: true, cell: (a) => ACTIVITY_LABELS[a.type] },
  {
    key: 'who',
    header: 'Agent / lease',
    cell: (a) => (
      <span className="flex flex-col">
        <span className="num font-mono text-support" title={a.agent}>{a.agent ? shortAddress(a.agent) : 'Not available'}</span>
        <span className="text-support text-ink-soft">Lease {a.leaseId}</span>
      </span>
    ),
  },
  {
    key: 'recipient',
    header: 'Recipient',
    hideOnTablet: true,
    cell: (a) => (a.recipient ? <span className="num font-mono text-support" title={a.recipient}>{shortAddress(a.recipient)}</span> : <span className="text-ink-mute">Not applicable</span>),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    cell: (a) => {
      if (a.amount !== undefined) return <span className="num">{formatUsdc(a.amount)} USDC</span>
      return <span className="num">{AMOUNT_EVENTS.includes(a.type) ? '0.00 USDC' : 'Not applicable'}</span>
    },
  },
  { key: 'date', header: 'Date', cell: (a) => (a.timestamp ? formatDateTime(a.timestamp) : <span className="text-ink-mute">Unavailable</span>) },
  { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status === 'success' ? 'success' : a.status === 'failed' ? 'failed' : 'pending'} /> },
]

const TRACKED: ActivityType[] = ['LeaseCreated', 'Deposited', 'Spent', 'Revoked', 'Withdrawn', 'AllowlistUpdated']

export function ActivityPage() {
  const { isConnected } = useAccount()
  const source = useActivity()

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        eyebrow="Activity"
        title="Activity"
        description="A record of everything that happened on your leases: payments, deposits, withdrawals and revocations."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard loading={isConnected && source.state === "loading"} label="Events loaded" value={source.state === 'ready' ? source.items.length : 0} icon={<ActivityIcon className="size-4" />} hint="Contract activity in this view" />
        <StatCard loading={isConnected && source.state === "loading"} label="Payments" value={source.state === 'ready' ? source.items.filter((a) => a.type === 'Spent').length : 0} icon={<ArrowUpRight className="size-4" />} hint="Agent spending events" />
        <StatCard loading={isConnected && source.state === "loading"} label="Deposits" value={source.state === 'ready' ? source.items.filter((a) => a.type === 'Deposited').length : 0} icon={<ArrowDownLeft className="size-4" />} hint="Funds added to leases" />
        <StatCard loading={isConnected && source.state === "loading"} label="Revocations" value={source.state === 'ready' ? source.items.filter((a) => a.type === 'Revoked').length : 0} icon={<ShieldCheck className="size-4" />} hint="Access removed" />
      </div>
      <NotConnectedNotice subject="Activity" />

      <Card padding="none" className="overflow-hidden">
        <div className="border-b border-line bg-gradient-to-r from-brand-mist/70 to-transparent p-4 sm:p-5 lg:p-6">
          <CardHeader title="Transaction history" description="An on-chain record of lease funding, spending and permission changes." className="mb-0" />
        </div>
        <DataTable
          caption="Transaction history"
          columns={columns}
          rows={source.items}
          getRowId={(a) => a.id}
          loading={source.state === 'loading'}
          error={source.state === 'error' ? source.reason : undefined}
          empty={
            <SourceEmpty
              state={source.state}
              reason={source.reason}
              subject="Activity"
              verb="is"
              icon={History}
              readyTitle="No activity yet"
              readyDescription="Payments, deposits and withdrawals on your leases will be listed here."
            />
          }
        />
      </Card>

      <Card tone="soft">
        <CardHeader title="What will be recorded" description="Each of these contract events becomes a row in the history." className="mb-3" />
        <ul className="flex flex-wrap gap-2">
          {TRACKED.map((t) => (
            <li key={t} className="rounded-full bg-surface px-3 py-1.5 text-label text-ink shadow-card">
              {ACTIVITY_LABELS[t]}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
