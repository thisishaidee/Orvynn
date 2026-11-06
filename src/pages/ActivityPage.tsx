import { History, ArrowDownLeft, ArrowUpRight, ShieldCheck, Activity as ActivityIcon, Copy, ExternalLink } from 'lucide-react'
import { arc, arcTestnet } from 'viem/chains'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { Card, CardHeader, DataTable, PageHeader, StatusBadge, StatCard, type Column } from '@/components/ui'
import { NotConnectedNotice } from '@/components/agentpay/Notices'
import { copyToClipboard } from '@/lib/clipboard'
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

function getColumns(explorerBase?: string): Column<ActivityItem>[] {
  return [
  { key: 'type', header: 'Type', primary: true, cell: (a) => ACTIVITY_LABELS[a.type] },
  {
    key: 'who',
    header: 'Agent / lease',
    cell: (a) => (
      <span className="flex flex-col">
        <span className="num font-mono text-support" title={a.agent}>{a.agent ? shortAddress(a.agent) : 'Not available'}</span>
        <button
          type="button"
          onClick={() => void copyToClipboard(a.leaseId).then(() => toast.success(`Lease ID ${a.leaseId} copied`)).catch(() => toast.error('Could not copy lease ID'))}
          className="mt-0.5 inline-flex min-h-8 w-fit items-center gap-1.5 text-support text-brand-blue"
          aria-label={`Copy lease ID ${a.leaseId}`}
        >
          Lease {a.leaseId}<Copy className="size-3" aria-hidden />
        </button>
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
  {
    key: 'explorer',
    header: 'Transaction',
    hideOnTablet: true,
    mobileFullWidth: true,
    cell: (a) => explorerBase && a.txHash !== '0x' ? (
      <a href={`${explorerBase}/tx/${a.txHash}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1.5 text-support font-medium text-brand-blue hover:underline">
        View on explorer <ExternalLink className="size-3.5" aria-hidden />
      </a>
    ) : <span className="text-ink-mute">Unavailable</span>,
  },
  ]
}

const TRACKED: ActivityType[] = ['LeaseCreated', 'Deposited', 'Spent', 'Revoked', 'Withdrawn', 'AllowlistUpdated']

export function ActivityPage() {
  const { isConnected, chainId } = useAccount()
  const source = useActivity()
  const explorerBase = chainId === arc.id
    ? arc.blockExplorers.default.url
    : chainId === arcTestnet.id
      ? arcTestnet.blockExplorers.default.url
      : undefined

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
          <CardHeader title="Transaction history" description="Confirmed on-chain lease activity. Open any transaction in the Arc explorer to inspect its receipt and details." className="mb-0" />
        </div>
        <DataTable
          caption="Transaction history"
          columns={getColumns(explorerBase)}
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

      <p className="text-support text-ink-soft">Rows here come from confirmed contract events, so they represent successful on-chain actions. Rejected wallet prompts and reverted transactions do not emit these events and are not included in this event history.</p>

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
