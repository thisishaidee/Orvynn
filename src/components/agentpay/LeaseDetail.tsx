import { useState } from 'react'
import { Copy, X } from 'lucide-react'
import { isAddress, parseUnits, type Address } from 'viem'
import { toast } from 'sonner'
import { Button, Card, CardHeader, ConfirmDialog, Field, Input, Modal, Notice, ProgressBar, Select, StatusBadge } from '@/components/ui'
import { InfoList, InfoRow, SupportChips } from '@/components/agentpay/Notices'
import { formatDateTime, formatPeriod, formatUsdc, leaseStatus, remainingAllowance, shortAddress, type Lease } from '@/lib/agentpay'
import { useAgentPayTransactions } from '@/lib/agentpay-transactions'
import { useUsdcBalance } from '@/lib/wallet'
import { copyToClipboard } from '@/lib/clipboard'

const Dash = () => <span className="text-ink-mute" aria-label="Not available">—</span>

function PermissionRow({ label, children, hint, inContract = true, inApp = true }: { label: string; children: React.ReactNode; hint?: React.ReactNode; inContract?: boolean; inApp?: boolean }) {
  return (
    <InfoRow label={label} hint={hint}>
      <span className="flex flex-col gap-1.5 md:items-end">
        <span>{children}</span>
        <SupportChips inContract={inContract} inApp={inApp} />
      </span>
    </InfoRow>
  )
}

export function PermissionsSection({ lease }: { lease?: Lease }) {
  const status = lease ? leaseStatus(lease) : undefined
  if (!lease) {
    return (
      <Card>
        <CardHeader title="Permissions" description="Lease rules and recipient permissions." />
        <p className="text-support text-ink-soft">No lease selected. Select a lease above to view its spending cap, period, expiry and approved recipients.</p>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader title="Permissions" description="What the agent is allowed to do under this lease. The contract enforces these rules." />
      <InfoList>
        <PermissionRow label="Per-period spending cap">{lease ? <span className="num">{formatUsdc(lease.cap)} USDC</span> : <Dash />}</PermissionRow>
        <PermissionRow label="Spending period" hint="The cap resets automatically at the start of each period.">{lease ? formatPeriod(lease.periodSeconds) : <Dash />}</PermissionRow>
        <PermissionRow label="Expiry">{lease ? formatDateTime(lease.expiry) : <Dash />}</PermissionRow>
        <PermissionRow label="Recipient allowlist">{lease ? (lease.allowlistEnabled ? 'On: only approved recipients' : 'Off: any recipient') : <Dash />}</PermissionRow>
        <PermissionRow label="Approved recipients" hint="This list is reconstructed from the contract's AllowlistUpdated events.">
          {lease?.allowedRecipients?.length ? (
            <ul className="space-y-1">{lease.allowedRecipients.map((a) => <li key={a} className="num font-mono text-support" title={a}>{shortAddress(a)}</li>)}</ul>
          ) : <Dash />}
        </PermissionRow>
        <PermissionRow label="Revocation">{status ? (status === 'revoked' ? 'Revoked: the agent can no longer spend' : 'Not revoked') : <Dash />}</PermissionRow>
      </InfoList>
    </Card>
  )
}

export function LeaseDetail({ lease, onClose }: { lease?: Lease; onClose?: () => void }) {
  const tx = useAgentPayTransactions()
  const walletBalance = useUsdcBalance()
  const status = lease ? leaseStatus(lease) : undefined
  const remaining = lease && status ? remainingAllowance(lease, status) : undefined
  const [action, setAction] = useState<'deposit' | 'recipient' | null>(null)
  const [amount, setAmount] = useState('')
  const [approvedAmount, setApprovedAmount] = useState<bigint>(0n)
  const [recipient, setRecipient] = useState('')
  const [allowed, setAllowed] = useState('true')
  const [busy, setBusy] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [error, setError] = useState('')

  const copyLeaseId = async () => {
    if (!lease) return
    try {
      await copyToClipboard(lease.id)
      toast.success(`Lease ID ${lease.id} copied`)
    } catch (cause) {
      toast.error('Could not copy lease ID', { description: cause instanceof Error ? cause.message : 'Select and copy the ID manually.' })
    }
  }

  const closeAction = () => {
    if (busy) return
    setAction(null); setAmount(''); setApprovedAmount(0n); setRecipient(''); setAllowed('true'); setError('')
  }
  const depositUnits = /^\d+(\.\d{1,6})?$/.test(amount) ? parseUnits(amount || '0', 6) : 0n
  const approveDeposit = async () => {
    setError('')
    if (depositUnits <= 0n) { setError('Enter a positive USDC amount with up to six decimal places.'); return }
    setBusy(true)
    try {
      const result = await tx.approveUsdc(depositUnits)
      setApprovedAmount(depositUnits)
      toast.success('USDC approval confirmed', { description: result.hash })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The approval failed.'
      setError(message); toast.error('USDC approval failed', { description: message })
    } finally { setBusy(false) }
  }
  const submitDeposit = async () => {
    if (!lease) return
    setError('')
    if (depositUnits <= 0n) { setError('Enter a positive USDC amount with up to six decimal places.'); return }
    if (approvedAmount < depositUnits) { setError('Approve this exact deposit amount first, then confirm the deposit separately.'); return }
    setBusy(true)
    try {
      const result = await tx.deposit(BigInt(lease.id), depositUnits)
      toast.success('Lease funded', { description: result.hash })
      walletBalance.refetch()
      closeAction()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The deposit failed.'
      setError(message); toast.error('Could not fund lease', { description: message })
    } finally { setBusy(false) }
  }
  const submitRecipient = async () => {
    if (!lease) return
    setError('')
    if (!isAddress(recipient.trim()) || recipient.trim().toLowerCase() === '0x0000000000000000000000000000000000000000') {
      setError('Enter a valid, non-zero recipient address.'); return
    }
    setBusy(true)
    try {
      const result = await tx.setAllowlist(BigInt(lease.id), recipient.trim() as Address, allowed === 'true')
      toast.success(allowed === 'true' ? 'Recipient approved' : 'Recipient removed', { description: result.hash })
      closeAction()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The recipient update failed.'
      setError(message); toast.error('Could not update recipient', { description: message })
    } finally { setBusy(false) }
  }
  const confirmRevoke = async () => {
    if (!lease || busy) return
    setBusy(true)
    try {
      const result = await tx.revoke(BigInt(lease.id))
      toast.success('Lease revoked', { description: result.hash })
      setRevokeOpen(false)
    } catch (cause) {
      toast.error('Could not revoke lease', { description: cause instanceof Error ? cause.message : 'The revoke transaction failed.' })
    } finally { setBusy(false) }
  }
  const confirmWithdraw = async () => {
    if (!lease || busy) return
    setBusy(true)
    try {
      const result = await tx.withdraw(BigInt(lease.id))
      toast.success('Lease funds withdrawn', { description: result.hash })
      walletBalance.refetch()
      setWithdrawOpen(false)
    } catch (cause) {
      toast.error('Could not withdraw funds', { description: cause instanceof Error ? cause.message : 'The withdrawal failed.' })
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title={lease ? `Lease ${lease.id}` : 'No lease selected'}
          description={lease ? <>Agent <span className="num font-mono">{shortAddress(lease.delegate)}</span></> : 'Select a lease from the list to see its details.'}
          action={lease ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {status && <StatusBadge status={status} />}
              <Button size="sm" variant="secondary" onClick={() => void copyLeaseId()}>
                <Copy className="size-3.5" aria-hidden /> Copy ID
              </Button>
              {onClose && <Button size="sm" variant="ghost" onClick={onClose}><X className="size-3.5" aria-hidden /> Close</Button>}
            </div>
          ) : undefined}
        />
        {lease ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <div><p className="text-label text-ink-soft">Spent this period</p><p className="num mt-1 text-figure-sm">{formatUsdc(lease.spentThisPeriod)} USDC</p></div>
            <div><p className="text-label text-ink-soft">Remaining allowance</p><p className="num mt-1 text-figure-sm">{remaining !== undefined ? `${formatUsdc(remaining)} USDC` : 'Unavailable'}</p></div>
            <div><p className="text-label text-ink-soft">Funds in lease</p><p className="num mt-1 text-figure-sm">{formatUsdc(lease.balance)} USDC</p></div>
          </div>
        ) : (
          <p className="text-support text-ink-soft">Select a lease from the list to view its spending and balance information.</p>
        )}
        {lease && <ProgressBar className="mt-5" label="Period spending" valueLabel={`${formatUsdc(lease.spentThisPeriod)} of ${formatUsdc(lease.cap)} USDC`} value={Number(lease.spentThisPeriod)} max={Number(lease.cap)} tone="auto" />}
      </Card>
      <PermissionsSection lease={lease} />
      <Card>
        <CardHeader title="Actions" description="Transactions are submitted only after you confirm them in your wallet." />
        {!lease ? <p className="text-support text-ink-soft">Select a lease to manage its funds and recipients.</p> : (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button variant="secondary" disabled={tx.state !== 'ready'} onClick={() => setAction('deposit')}>Add funds</Button>
            <Button variant="secondary" disabled={tx.state !== 'ready' || !lease.allowlistEnabled} onClick={() => setAction('recipient')}>Manage recipients</Button>
            <Button variant="secondary" disabled={tx.state !== 'ready' || lease.balance === 0n} onClick={() => setWithdrawOpen(true)}>Withdraw funds</Button>
            <Button variant="destructive" disabled={tx.state !== 'ready' || status !== 'active'} onClick={() => setRevokeOpen(true)}>Revoke lease</Button>
          </div>
        )}
        {tx.state !== 'ready' && <p className="mt-3 text-support text-ink-soft">{tx.reason || 'Connect a wallet on an Arc network with a deployed Orvynn contract.'}</p>}
      </Card>

      <Modal open={action === 'deposit'} onClose={closeAction} dismissible={!busy} title="Add funds" description="USDC approval and the lease deposit are separate wallet transactions.">
        <div className="space-y-4">
          <Field label="Deposit amount" hint="USDC, up to six decimal places.">
            {(props) => <Input {...props} type="number" min="0.000001" step="0.000001" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50.00" />}
          </Field>
          {walletBalance.state === 'ready' && depositUnits > (walletBalance.raw ?? 0n) && (
            <Notice tone="warning" title="Insufficient wallet USDC balance">
              Your wallet has {walletBalance.formatted} USDC, but this deposit requires {formatUsdc(depositUnits)} USDC. Add USDC to your wallet or lower the deposit amount.
            </Notice>
          )}
          {walletBalance.state === 'loading' && <p className="text-support text-ink-soft">Checking your wallet USDC balance…</p>}
          {walletBalance.state === 'error' && <Notice tone="warning" title="Wallet balance unavailable">Orvynn will verify the balance directly on-chain before submitting the deposit.</Notice>}
          {error && <Notice tone="danger" title="Deposit not completed">{error}</Notice>}
          <div className="flex flex-col gap-2 border-t border-line pt-4 sm:flex-row sm:flex-wrap sm:justify-end">
            <Button variant="secondary" className="min-h-11 w-full sm:w-auto" disabled={busy} onClick={closeAction}>Cancel</Button>
            <Button variant="secondary" className="min-h-11 w-full sm:w-auto" loading={busy} disabled={tx.state !== 'ready' || depositUnits <= 0n || approvedAmount >= depositUnits || (walletBalance.raw !== undefined && depositUnits > walletBalance.raw)} onClick={() => void approveDeposit()}>Approve USDC</Button>
            <Button className="min-h-11 w-full sm:w-auto" loading={busy} disabled={tx.state !== 'ready' || depositUnits <= 0n || approvedAmount < depositUnits || (walletBalance.raw !== undefined && depositUnits > walletBalance.raw)} onClick={() => void submitDeposit()}>Deposit funds</Button>
          </div>
        </div>
      </Modal>

      <Modal open={action === 'recipient'} onClose={closeAction} dismissible={!busy} title="Manage recipient" description="Approve or remove one recipient for this lease.">
        <div className="space-y-4">
          <Field label="Recipient wallet address">{(props) => <Input {...props} value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="0x…" spellCheck={false} autoCapitalize="none" />}</Field>
          <Field label="Permission">{(props) => <Select {...props} value={allowed} onChange={(e) => setAllowed(e.target.value)}><option value="true">Approve recipient</option><option value="false">Remove recipient</option></Select>}</Field>
          {error && <Notice tone="danger" title="Recipient update failed">{error}</Notice>}
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button variant="secondary" disabled={busy} onClick={closeAction}>Cancel</Button>
            <Button loading={busy} disabled={tx.state !== 'ready'} onClick={() => void submitRecipient()}>Save permission</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog open={revokeOpen} title="Revoke this lease?" description="The agent will no longer be able to spend from this lease. This cannot be undone." confirmLabel="Revoke lease" tone="destructive" loading={busy} onCancel={() => { if (!busy) setRevokeOpen(false) }} onConfirm={() => void confirmRevoke()} />
      <ConfirmDialog open={withdrawOpen} title="Withdraw lease funds?" description={lease ? `Withdraw the full remaining balance of ${formatUsdc(lease.balance)} USDC to your connected owner wallet.` : undefined} confirmLabel="Withdraw funds" loading={busy} onCancel={() => { if (!busy) setWithdrawOpen(false) }} onConfirm={() => void confirmWithdraw()} />
    </div>
  )
}
