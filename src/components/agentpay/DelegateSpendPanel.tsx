import { useMemo, useState } from 'react'
import { isAddress, parseUnits, type Address } from 'viem'
import { toast } from 'sonner'
import { Button, Card, CardHeader, Field, Input, Modal, Notice, Select, StatusBadge } from '@/components/ui'
import { formatUsdc, leaseStatus, remainingAllowance, shortAddress, useDelegateLeases } from '@/lib/agentpay'
import { useAgentPayTransactions } from '@/lib/agentpay-transactions'

type RequestStage = 'details' | 'review'

export function DelegateSpendPanel() {
  const source = useDelegateLeases()
  const tx = useAgentPayTransactions()
  const activeLeases = useMemo(() => source.items.filter((lease) => leaseStatus(lease) === 'active'), [source.items])
  const [leaseId, setLeaseId] = useState('')
  const [recipient, setRecipient] = useState('')
  const [amount, setAmount] = useState('')
  const [purpose, setPurpose] = useState('')
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<RequestStage>('details')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const selected = activeLeases.find((lease) => lease.id === leaseId) ?? activeLeases[0]
  const units = /^\d+(\.\d{1,6})?$/.test(amount) ? parseUnits(amount || '0', 6) : 0n
  const available = selected ? remainingAllowance(selected, leaseStatus(selected)) : 0n

  const resetRequest = () => {
    setOpen(false)
    setStage('details')
    setRecipient('')
    setAmount('')
    setPurpose('')
    setError('')
  }

  const prepareRequest = () => {
    setError('')
    if (!selected) { setError('No active lease is assigned to this wallet.'); return }
    if (!isAddress(recipient.trim()) || recipient.trim().toLowerCase() === '0x0000000000000000000000000000000000000000') {
      setError('Enter a valid, non-zero recipient address.'); return
    }
    if (units <= 0n) { setError('Enter a positive USDC amount with up to six decimal places.'); return }
    if (units > available) { setError('This request exceeds the lease’s currently available allowance or balance.'); return }
    if (!purpose.trim()) { setError('Add a short reason for this payment request.'); return }
    setStage('review')
  }

  const approveRequest = async () => {
    setError('')
    if (!selected) { setError('The selected lease is no longer available.'); setStage('details'); return }
    if (!isAddress(recipient.trim()) || units <= 0n || units > available) {
      setError('The request details or available lease amount changed. Review the request again.')
      setStage('details')
      return
    }
    setBusy(true)
    try {
      // spend() re-reads live Arc state, checks every lease rule and simulates
      // the exact call before asking the connected delegate wallet to sign.
      const result = await tx.spend(BigInt(selected.id), recipient.trim() as Address, units)
      toast.success('Agent payment confirmed', { description: result.hash })
      resetRequest()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'The payment was not completed.'
      setError(message)
      toast.error('Payment not completed', { description: message })
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader
        title="Agent payment requests"
        description="Review a payment request from an agent. Orvynn checks the assigned lease, then your delegate wallet must explicitly approve the transaction."
      />
      {source.state !== 'ready' ? (
        <Notice tone={source.state === 'error' ? 'danger' : 'info'} title={source.state === 'missing-address' ? 'Contract address not configured' : source.state === 'unsupported-network' ? 'Unsupported network' : source.state === 'disconnected' ? 'Wallet not connected' : 'Loading assigned leases'}>
          {source.reason}
        </Notice>
      ) : source.refreshing && activeLeases.length === 0 ? (
        <Notice tone="info" title="Checking assigned leases on Arc">
          Your previous lease snapshot is empty. Orvynn is checking the live network before confirming that no active leases are assigned.
        </Notice>
      ) : activeLeases.length === 0 ? (
        <Notice tone="info" title="No active leases assigned">
          This connected wallet is not currently the delegate on an active lease. Ask the lease owner to create or fund a lease for this wallet.
        </Notice>
      ) : (
        <div className="space-y-4">
          {source.refreshing && (
            <Notice tone="info" title="Refreshing lease data">
              Showing your last saved lease snapshot while Orvynn verifies the current limits on Arc. Payment approval stays disabled until this refresh finishes.
            </Notice>
          )}
          {source.refreshError && (
            <Notice tone="warning" title="Live lease check failed">
              Your saved snapshot is shown for reference only. Payment requests are disabled until Arc responds successfully. {source.refreshError}
              <span className="mt-2 block"><Button size="sm" variant="secondary" onClick={() => source.refetch?.()}>Retry live check</Button></span>
            </Notice>
          )}
          <div className="rounded-control border border-line bg-brand-mist p-3 sm:p-4">
            <p className="text-overline uppercase text-ink-soft">How the approval works</p>
            <ol className="mt-2 grid gap-2 text-support text-ink sm:grid-cols-3">
              <li><span className="font-semibold text-brand-blue">01</span> Agent submits a request</li>
              <li><span className="font-semibold text-brand-blue">02</span> Orvynn checks the live lease</li>
              <li><span className="font-semibold text-brand-blue">03</span> Delegate approves in wallet</li>
            </ol>
          </div>
          <p className="text-support text-ink-soft">This request composer demonstrates the delegate approval path. An external AI agent can submit the same structured request through the Orvynn Agent API.</p>
          <Field label="Assigned lease">
            {(props) => <Select {...props} value={selected?.id ?? ''} onChange={(event) => setLeaseId(event.target.value)}>
              {activeLeases.map((lease) => <option key={lease.id} value={lease.id}>Lease {lease.id} · {formatUsdc(lease.cap)} USDC cap · owner {shortAddress(lease.owner)}</option>)}
            </Select>}
          </Field>
          {selected && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-brand-mist p-3">
              <span className="text-support text-ink-soft">Available to spend now</span>
              <strong className="num text-label">{formatUsdc(available)} USDC</strong>
            </div>
          )}
          <Button disabled={source.refreshing || Boolean(source.refreshError) || tx.state !== 'ready' || !selected || available === 0n} onClick={() => { setError(''); setStage('details'); setOpen(true) }}>
            Create payment request
          </Button>
        </div>
      )}
      <Modal
        open={open}
        onClose={() => { if (!busy) resetRequest() }}
        dismissible={!busy}
        title={stage === 'details' ? 'New agent payment request' : 'Review payment request'}
        description={stage === 'details'
          ? 'Enter the payment an agent is requesting. No transaction is sent at this stage.'
          : 'Check the details before opening your wallet. Orvynn will verify the live lease again before signing.'}
      >
        <div className="space-y-4">
          {stage === 'details' ? (
            <>
              <Field label="Recipient address">
                {(props) => <Input {...props} value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" spellCheck={false} autoCapitalize="none" />}
              </Field>
              <Field label="Amount" hint={selected ? `Maximum available: ${formatUsdc(available)} USDC` : undefined}>
                {(props) => <Input {...props} type="number" min="0.000001" step="0.000001" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="10.00" />}
              </Field>
              <Field label="Payment reason" hint="A short explanation attached to this request in the app.">
                {(props) => <Input {...props} value={purpose} onChange={(event) => setPurpose(event.target.value)} placeholder="Pay for completed work" maxLength={160} />}
              </Field>
              {selected && <div className="flex items-center justify-between text-support text-ink-soft"><span>Lease {selected.id}</span><StatusBadge status="active" /></div>}
              {error && <Notice tone="danger" title="Request needs attention">{error}</Notice>}
              <div className="flex justify-end gap-2 border-t border-line pt-4">
                <Button variant="secondary" disabled={busy} onClick={resetRequest}>Cancel</Button>
                <Button disabled={!selected || units <= 0n} onClick={prepareRequest}>Review request</Button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-control border border-line bg-brand-mist p-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-support text-ink-soft">Requested payment</span>
                  <StatusBadge status="active" />
                </div>
                <p className="num mt-2 text-2xl font-semibold">{amount} USDC</p>
                <p className="mt-3 text-support text-ink-soft">Reason</p>
                <p className="text-body">{purpose}</p>
                <p className="mt-3 text-support text-ink-soft">Recipient</p>
                <p className="break-all font-mono text-support">{recipient}</p>
                <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-support">
                  <span>Lease {selected?.id} · available before payment</span>
                  <strong className="num">{formatUsdc(available)} USDC</strong>
                </div>
              </div>
              <Notice tone="info" title="Wallet approval is still required">
                Orvynn re-reads the lease on Arc and simulates the exact payment. Only after those checks pass will your connected delegate wallet ask you to sign. The reason is app context; the contract enforces the recipient, amount, lease and spending limits.
              </Notice>
              {error && <Notice tone="danger" title="Payment not completed">{error}</Notice>}
              <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
                <Button variant="secondary" disabled={busy} onClick={() => { setError(''); setStage('details') }}>Edit request</Button>
                <Button loading={busy} disabled={tx.state !== 'ready' || !selected || units <= 0n || units > available} onClick={() => void approveRequest()}>
                  Approve with wallet
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>
    </Card>
  )
}
