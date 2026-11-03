import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { Archive, ArchiveRestore, KeyRound, Plus, ShieldCheck, Clock3, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, ConfirmDialog, DataTable, PageHeader, ProgressBar, StatusBadge, StatCard, type Column } from '@/components/ui'
import { LeaseDetail } from '@/components/agentpay/LeaseDetail'
import { CreateLeaseModal } from '@/components/agentpay/CreateLeaseModal'
import { NotConnectedNotice } from '@/components/agentpay/Notices'
import { SourceEmpty } from '@/components/agentpay/SourceEmpty'
import {
  formatDateTime,
  formatUsdc,
  leaseStatus,
  remainingAllowance,
  shortAddress,
  useLeases,
  type Lease,
  type LeaseStatus,
} from '@/lib/agentpay'
import { cn } from '@/lib/cn'
import { useAgentPayTransactions } from '@/lib/agentpay-transactions'
import { leaseArchiveStorageKey, readArchivedLeaseIds, writeArchivedLeaseIds } from '@/lib/lease-archive'

type Filter = 'all' | LeaseStatus | 'archived'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'expired', label: 'Expired' },
  { id: 'revoked', label: 'Revoked' },
  { id: 'archived', label: 'Archived' },
]

export function LeasesPage() {
  const source = useLeases()
  const { address, chainId } = useAccount()
  const storageKey = leaseArchiveStorageKey(chainId, address)
  const [archiveState, setArchiveState] = useState<{ key: string | null; ids: Set<string> }>({ key: null, ids: new Set() })
  const [filter, setFilter] = useState<Filter>('all')
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [createOpen, setCreateOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Lease | undefined>()
  const [revoking, setRevoking] = useState(false)
  const transactions = useAgentPayTransactions()

  useEffect(() => {
    if (!storageKey) {
      setArchiveState({ key: null, ids: new Set() })
      return
    }
    try {
      setArchiveState({ key: storageKey, ids: readArchivedLeaseIds(window.localStorage, storageKey) })
    } catch {
      setArchiveState({ key: storageKey, ids: new Set() })
      toast.error('Could not read archived leases', { description: 'Your on-chain leases are unaffected.' })
    }
  }, [storageKey])

  // Do not briefly show archived leases as active while a wallet/network's
  // browser-local archive preference is still being restored.
  const archiveReady = archiveState.key === storageKey
  const archivedIds = archiveReady ? archiveState.ids : new Set<string>()
  const withStatus = useMemo(() => source.items.map((lease) => ({ lease, status: leaseStatus(lease), archived: archivedIds.has(lease.id) })), [source.items, archivedIds])
  const rows = archiveReady
    ? withStatus.filter((r) => filter === 'archived' ? r.archived : !r.archived && (filter === 'all' || r.status === filter))
    : []
  const selected = source.items.find((l) => l.id === selectedId)
  const ready = source.state === 'ready' && archiveReady
  const count = (f: Filter) => (ready ? String(withStatus.filter((r) => f === 'archived' ? r.archived : !r.archived && (f === 'all' || r.status === f)).length) : '—')

  const setArchived = (lease: Lease, archived: boolean) => {
    if (!storageKey) {
      toast.error('Connect your wallet to manage archived leases.')
      return
    }
    if (!archiveReady) {
      toast.error('Archive preferences are still loading. Try again in a moment.')
      return
    }
    try {
      // Re-read before writing so a wallet/network change or rapid update
      // cannot overwrite a newer archive set held in browser storage.
      const next = readArchivedLeaseIds(window.localStorage, storageKey)
      if (archived) next.add(lease.id)
      else next.delete(lease.id)
      writeArchivedLeaseIds(window.localStorage, storageKey, next)
      setArchiveState({ key: storageKey, ids: next })
      toast.success(archived ? 'Lease ' + lease.id + ' archived' : 'Lease ' + lease.id + ' restored', {
        description: 'Saved on this site in this browser for this wallet and network. The on-chain lease is unchanged.',
      })
    } catch {
      toast.error('Could not save this archive change', { description: 'Your on-chain lease is unaffected.' })
    }
  }

  const columns: Column<{ lease: Lease; status: LeaseStatus; archived: boolean }>[] = [
    {
      key: 'agent',
      header: 'Agent',
      primary: true,
      cell: ({ lease }) => (
        <span className="flex flex-col">
          <span className="num font-mono text-support" title={lease.delegate}>{shortAddress(lease.delegate)}</span>
          <span className="text-support font-normal text-ink-soft">Lease {lease.id}</span>
        </span>
      ),
    },
    { key: 'cap', header: 'Cap per period', align: 'right', cell: ({ lease }) => <span className="num">{formatUsdc(lease.cap)} USDC</span> },
    {
      key: 'spent',
      header: 'Spent / remaining',
      hideOnTablet: true,
      cell: ({ lease, status }) => (
        <div className="min-w-36">
          <ProgressBar size="sm" tone="auto" value={Number(lease.spentThisPeriod)} max={Number(lease.cap)} />
          <p className="num mt-1 text-support text-ink-soft">
            {formatUsdc(lease.spentThisPeriod)} spent · {formatUsdc(remainingAllowance(lease, status))} left
          </p>
        </div>
      ),
    },
    { key: 'expiry', header: 'Expiry', cell: ({ lease }) => formatDateTime(lease.expiry) },
    { key: 'recipients', header: 'Recipients', hideOnTablet: true, cell: ({ lease }) => (lease.allowlistEnabled ? 'Approved only' : 'Any recipient') },
    { key: 'status', header: 'Status', cell: ({ status }) => <StatusBadge status={status} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      cell: ({ lease, archived }) => (
        <span className="inline-flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setSelectedId(lease.id)}>View</Button>
          <Button size="sm" variant="secondary" onClick={() => setArchived(lease, !archived)}>
            {archived ? <ArchiveRestore className="size-3.5" aria-hidden /> : <Archive className="size-3.5" aria-hidden />}
            {archived ? 'Restore' : 'Archive'}
          </Button>
          {!archived && <Button size="sm" variant="destructive" disabled={transactions.state !== 'ready' || leaseStatus(lease) !== 'active'} onClick={() => setRevokeTarget(lease)}>Revoke</Button>}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        eyebrow="Leases"
        title="Leases"
        description="A lease is a spending agreement between you and an agent: how much it may spend, how often, until when, and to whom."
        actions={<Button iconLeft={<Plus className="size-4" aria-hidden />} onClick={() => setCreateOpen(true)}>Create lease</Button>}
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total leases" value={ready ? withStatus.length : undefined} loading={source.state === 'loading' || !archiveReady} icon={<WalletCards className="size-4" />} hint="Created from this wallet" />
        <StatCard label="Active" value={ready ? withStatus.filter((r) => r.status === 'active' && !r.archived).length : undefined} loading={source.state === 'loading' || !archiveReady} icon={<ShieldCheck className="size-4" />} hint="Currently available to agents" />
        <StatCard label="Expired or revoked" value={ready ? withStatus.filter((r) => r.status !== 'active' && !r.archived).length : undefined} loading={source.state === 'loading' || !archiveReady} icon={<Clock3 className="size-4" />} hint="No longer spendable" />
        <StatCard label="Archived" value={ready ? withStatus.filter((r) => r.archived).length : undefined} loading={source.state === 'loading' || !archiveReady} icon={<Archive className="size-4" />} hint="Hidden from the main list" />
      </div>
      <NotConnectedNotice subject="Leases" />
      <CreateLeaseModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => setSelectedId(undefined)} />
      <ConfirmDialog
        open={Boolean(revokeTarget)}
        title="Revoke this lease?"
        description="The agent will no longer be able to spend from this lease. This action cannot be undone."
        confirmLabel="Revoke lease"
        tone="destructive"
        loading={revoking}
        onCancel={() => { if (!revoking) setRevokeTarget(undefined) }}
        onConfirm={() => {
          if (!revokeTarget || revoking) return
          setRevoking(true)
          void transactions.revoke(BigInt(revokeTarget.id)).then((result) => {
            toast.success('Lease revoked', { description: result.hash })
            setRevokeTarget(undefined)
          }).catch((cause) => {
            const message = cause instanceof Error ? cause.message : 'The revoke transaction failed.'
            toast.error('Could not revoke lease', { description: message })
          }).finally(() => setRevoking(false))
        }}
      />

      <Card padding="none" className="overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-line bg-gradient-to-r from-brand-mist/70 to-transparent p-4 sm:p-5 lg:p-6">
          <CardHeader title="Your leases" description="Monitor spending limits, expiry dates and agent permissions. Archive preferences are saved on this site in this browser for this wallet and network." className="mb-0" />
          <div role="tablist" aria-label="Filter leases by status" className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                role="tab"
                type="button"
                aria-selected={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'flex min-h-12 flex-col items-center justify-center gap-0 rounded-control px-2 text-label transition-colors sm:h-11 sm:min-h-0 sm:flex-row sm:gap-2 sm:px-4',
                  filter === f.id ? 'bg-brand-navy text-white' : 'bg-brand-mist text-ink-soft hover:text-ink',
                )}
              >
                {f.label}
                <span className="num text-support opacity-80">{count(f.id)}</span>
              </button>
            ))}
          </div>
        </div>
        <DataTable
          caption="Leases"
          columns={columns}
          rows={rows}
          getRowId={(r) => r.lease.id}
          loading={source.state === 'loading' || (source.state === 'ready' && !archiveReady)}
          error={source.state === 'error' ? source.reason : undefined}
          onRetry={source.refetch}
          empty={
            <SourceEmpty
              state={source.state}
              reason={source.reason}
              subject="Leases"
              icon={KeyRound}
              readyTitle={filter === 'all' ? 'No leases yet' : filter === 'archived' ? 'No archived leases' : `No ${filter} leases`}
              readyDescription={filter === 'archived' ? 'Leases you archive will appear here. You can restore them at any time.' : 'Create a lease to give an agent a spending limit.'}
            />
          }
        />
      </Card>

      <section aria-labelledby="lease-detail-heading" className="space-y-3">
        <div>
          <h2 id="lease-detail-heading" className="text-section">Lease detail</h2>
          <p className="text-support text-ink-soft">
            {selected ? 'Permissions and actions for the selected lease.' : 'Layout preview. Values appear here when you select a lease.'}
          </p>
        </div>
        <LeaseDetail lease={selected} />
      </section>
    </div>
  )
}
