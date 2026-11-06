import { useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { Archive, ArchiveRestore, Copy, KeyRound, Plus, ShieldCheck, Clock3, WalletCards } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, ConfirmDialog, DataTable, Notice, PageHeader, ProgressBar, StatusBadge, StatCard, type Column } from '@/components/ui'
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
import { copyToClipboard } from '@/lib/clipboard'

type Filter = 'all' | LeaseStatus | 'archived'
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'expired', label: 'Expired' },
  { id: 'revoked', label: 'Revoked' },
  { id: 'archived', label: 'Archived' },
]

function archiveStorageKey(chainId?: number, address?: string) {
  return chainId && address ? `orvynn:archived-leases:${chainId}:${address.toLowerCase()}` : null
}

export function LeasesPage() {
  const source = useLeases()
  const { address, chainId } = useAccount()
  const storageKey = archiveStorageKey(chainId, address)
  const [archivedIds, setArchivedIds] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [openLeaseIds, setOpenLeaseIds] = useState<string[]>([])
  const [createOpen, setCreateOpen] = useState(false)
  const [revokeTarget, setRevokeTarget] = useState<Lease | undefined>()
  const [revoking, setRevoking] = useState(false)
  const transactions = useAgentPayTransactions()

  useEffect(() => {
    if (!storageKey) {
      setArchivedIds(new Set())
      return
    }
    try {
      const stored: unknown = JSON.parse(window.localStorage.getItem(storageKey) ?? '[]')
      setArchivedIds(new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []))
    } catch {
      setArchivedIds(new Set())
      toast.error('Could not read archived leases', { description: 'Your on-chain leases are unaffected.' })
    }
  }, [storageKey])

  const withStatus = useMemo(() => source.items.map((lease) => ({ lease, status: leaseStatus(lease), archived: archivedIds.has(lease.id) })), [source.items, archivedIds])
  const rows = withStatus.filter((r) => filter === 'archived' ? r.archived : !r.archived && (filter === 'all' || r.status === filter))
  const ready = source.state === 'ready'
  const count = (f: Filter) => (ready ? String(withStatus.filter((r) => f === 'archived' ? r.archived : !r.archived && (f === 'all' || r.status === f)).length) : '0')

  const openLeaseDetails = (leaseId: string) => {
    setOpenLeaseIds((current) => {
      if (current.includes(leaseId)) return current
      if (current.length >= 2) {
        toast.info('Close one lease detail before opening another.')
        return current
      }
      return [...current, leaseId]
    })
  }

  const closeLeaseDetails = (leaseId: string) => {
    setOpenLeaseIds((current) => current.filter((id) => id !== leaseId))
  }

  const setArchived = (lease: Lease, archived: boolean) => {
    if (!storageKey) {
      toast.error('Connect your wallet to manage archived leases.')
      return
    }
    const next = new Set(archivedIds)
    if (archived) next.add(lease.id)
    else next.delete(lease.id)
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...next]))
      setArchivedIds(next)
      toast.success(archived ? `Lease ${lease.id} archived` : `Lease ${lease.id} restored`, {
        description: 'This changes only your dashboard view. The on-chain lease is unchanged.',
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
      mobileFullWidth: true,
      cell: ({ lease, archived }) => (
        <span className="inline-flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => openLeaseDetails(lease.id)}>View</Button>
          <Button size="sm" variant="ghost" onClick={() => void copyToClipboard(lease.id).then(() => toast.success(`Lease ID ${lease.id} copied`)).catch(() => toast.error("Could not copy lease ID"))} aria-label={`Copy lease ID ${lease.id}`}><Copy className="size-3.5" aria-hidden /> Copy ID</Button>
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
        <StatCard loading={source.state === "loading"} label="Total leases" value={ready ? withStatus.length : 0} icon={<WalletCards className="size-4" />} hint="Created from this wallet" />
        <StatCard loading={source.state === "loading"} label="Active" value={ready ? withStatus.filter((r) => r.status === 'active' && !r.archived).length : 0} icon={<ShieldCheck className="size-4" />} hint="Currently available to agents" />
        <StatCard loading={source.state === "loading"} label="Expired or revoked" value={ready ? withStatus.filter((r) => r.status !== 'active' && !r.archived).length : 0} icon={<Clock3 className="size-4" />} hint="No longer spendable" />
        <StatCard loading={source.state === "loading"} label="Archived" value={ready ? withStatus.filter((r) => r.archived).length : 0} icon={<Archive className="size-4" />} hint="Hidden from the main list" />
      </div>
      <NotConnectedNotice subject="Leases" />
      {source.refreshError && (
        <Notice tone="warning" title="Lease list may be out of date">
          {source.refreshError}
          <span className="ml-2 inline-flex">
            <Button size="sm" variant="secondary" onClick={() => source.refetch?.()}>Retry</Button>
          </span>
        </Notice>
      )}
      <CreateLeaseModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => setOpenLeaseIds([])} />
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
          <CardHeader title="Your leases" description="Monitor spending limits, expiry dates and agent permissions." className="mb-0" />
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
          loading={source.state === 'loading'}
          error={source.state === 'error' ? source.reason : undefined}
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
          <h2 id="lease-detail-heading" className="text-section">Lease details</h2>
          <p className="text-support text-ink-soft">
            {openLeaseIds.length > 0
              ? `${openLeaseIds.length} of 2 lease detail views open. Close a view before opening another when both are in use.`
              : 'Open a lease to inspect its permissions, balance and actions.'}
          </p>
        </div>
        {openLeaseIds.length === 0 ? (
          <LeaseDetail />
        ) : (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {openLeaseIds.map((id) => {
              const lease = source.items.find((item) => item.id === id)
              return lease ? <LeaseDetail key={id} lease={lease} onClose={() => closeLeaseDetails(id)} /> : null
            })}
          </div>
        )}
      </section>
    </div>
  )
}
