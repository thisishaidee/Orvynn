import { useState } from 'react'
import { isAddress, parseUnits, type Address } from 'viem'
import { toast } from 'sonner'
import { Button, Field, Input, Modal, Notice, Select } from '@/components/ui'
import { useAgentPayTransactions } from '@/lib/agentpay-transactions'
import { useUsdcBalance } from '@/lib/wallet'

const periods = [
  { label: 'Hourly', value: '3600' },
  { label: 'Daily', value: '86400' },
  { label: 'Weekly', value: '604800' },
  { label: 'Every 30 days', value: '2592000' },
]

export function CreateLeaseModal({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const tx = useAgentPayTransactions()
  const walletBalance = useUsdcBalance()
  const [delegate, setDelegate] = useState('')
  const [cap, setCap] = useState('')
  const [period, setPeriod] = useState('86400')
  const [expiry, setExpiry] = useState('')
  const [allowlist, setAllowlist] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const reset = () => {
    setDelegate('')
    setCap('')
    setPeriod('86400')
    setExpiry('')
    setAllowlist(false)
    setError('')
  }
  const close = () => {
    if (busy) return
    reset()
    onClose()
  }

  const submit = async () => {
    setError('')
    if (!isAddress(delegate.trim())) return setError('Enter a valid EVM wallet address.')
    if (!/^\d+(\.\d{1,6})?$/.test(cap)) return setError('Enter a positive USDC cap with up to six decimal places.')
    const capUnits = parseUnits(cap, 6)
    if (capUnits <= 0n) return setError('The spending cap must be greater than zero.')
    const expirySeconds = Math.floor(new Date(expiry).getTime() / 1000)
    if (!Number.isFinite(expirySeconds) || expirySeconds <= Math.floor(Date.now() / 1000)) {
      return setError('Choose an expiry date and time in the future.')
    }
    if (tx.state !== 'ready') return setError(tx.reason || 'Transactions are not available.')
    setBusy(true)
    try {
      const result = await tx.createLease({
        delegate: delegate.trim() as Address,
        cap: capUnits,
        periodSeconds: BigInt(period),
        expiry: BigInt(expirySeconds),
        allowlistEnabled: allowlist,
        initialDeposit: 0n,
      })
      toast.success('Lease created', { description: result.hash })
      reset()
      onCreated()
      onClose()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Lease creation failed.'
      setError(message)
      toast.error('Lease creation failed', { description: message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={open} onClose={close} dismissible={!busy} size="md"
      title="Create a lease"
      description="Define the agent, spending cap, period and expiry. This creates an unfunded lease."
      footer={<>
        <Button variant="secondary" onClick={close} disabled={busy}>Cancel</Button>
        <Button onClick={() => void submit()} loading={busy} disabled={tx.state !== 'ready'}>Create lease</Button>
      </>}>
      <div className="space-y-4">
        {tx.state !== 'ready' && <Notice tone="warning" title="Transactions unavailable">{tx.reason || 'Connect a wallet and configure the deployed Orvynn contract address.'}</Notice>}
        <Field label="Agent wallet address">
          {(props) => <Input {...props} value={delegate} onChange={(e) => setDelegate(e.target.value)} placeholder="0x…" spellCheck={false} autoCapitalize="none" />}
        </Field>
        <Field label="Spending cap per period" hint={walletBalance.state === 'ready' ? `Wallet balance: ${walletBalance.formatted} USDC.` : "USDC, up to six decimal places."}>
          {(props) => <Input {...props} type="number" min="0.000001" step="0.000001" value={cap} onChange={(e) => setCap(e.target.value)} placeholder="Enter amount (e.g. 1.00)" />}
        </Field>
        {walletBalance.state === 'ready' && /^\d+(\.\d{1,6})?$/.test(cap) && parseUnits(cap, 6) > (walletBalance.raw ?? 0n) && (
          <Notice tone="warning" title="Spending cap is higher than your wallet balance">
            Your wallet currently has {walletBalance.formatted} USDC. The cap is a per-period permission, not money deposited into the lease. This lease will be created unfunded, and the agent cannot spend until you add funds.
          </Notice>
        )}
        {walletBalance.state === 'loading' && <p className="text-support text-ink-soft">Reading your current wallet USDC balance…</p>}
        {walletBalance.state === 'error' && <Notice tone="warning" title="Wallet balance could not be verified">You can still create this unfunded lease. Orvynn will check your balance again before any deposit.</Notice>}
        <Field label="Spending period">
          {(props) => <Select {...props} value={period} onChange={(e) => setPeriod(e.target.value)}>
            {periods.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>}
        </Field>
        <Field label="Lease expiry" hint="Tap the field to choose both the expiry date and time.">
          {(props) => (
            <Input
              {...props}
              type="datetime-local"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              onClick={(event) => {
                const input = event.currentTarget
                if (typeof input.showPicker === 'function') {
                  try {
                    input.showPicker()
                  } catch {
                    input.focus()
                  }
                }
              }}
              className="cursor-pointer"
            />
          )}
        </Field>
        <label className="flex items-start gap-3 rounded-card border border-line p-3 text-body">
          <input type="checkbox" checked={allowlist} onChange={(e) => setAllowlist(e.target.checked)} className="mt-1 size-4" />
          <span><strong className="font-medium">Restrict recipients</strong><span className="mt-0.5 block text-support text-ink-soft">Only recipients you approve later can receive payments.</span></span>
        </label>
        {busy && <p role="status" aria-live="polite" className="text-support text-ink-soft">Waiting for your wallet confirmation and for Arc to confirm the transaction. This can take a few seconds.</p>}
        {error && <Notice tone="danger" title="Could not create lease">{error}</Notice>}
      </div>
    </Modal>
  )
}
