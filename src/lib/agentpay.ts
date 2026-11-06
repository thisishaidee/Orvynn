import { formatUnits, type Address, type Hex } from 'viem'
import type { LeaseStatus } from '@/lib/lease-status'

/**
 * Domain model for the frontend. These types mirror what the AgentPay contract stores.
 * Read data comes from the configured Arc AgentPay deployment; unavailable sources are reported
 * explicitly and no record is ever invented.
 */

export type DataState =
  | 'disconnected'
  | 'unsupported-network'
  | 'missing-address'
  | 'not-connected'
  | 'loading'
  | 'error'
  | 'ready'

export interface Lease {
  id: string
  owner: Address
  /** The agent: the only address allowed to spend from this lease. */
  delegate: Address
  /** USDC base units (6 decimals). */
  cap: bigint
  periodSeconds: number
  /** Unix seconds. The lease cannot be spent from at or after this time. */
  expiry: number
  spentThisPeriod: bigint
  /** USDC currently held by the lease. */
  balance: bigint
  /** Whether any Deposited event exists for this lease; null when history could not be verified. */
  everFunded?: boolean | null
  allowlistEnabled: boolean
  /** The contract can only answer "is X allowed"; this list is rebuilt from AllowlistUpdated events. */
  allowedRecipients?: Address[]
  revoked: boolean
  /** Rollover-aware remaining allowance read from the contract. Absent when unread. */
  onChainRemaining?: bigint
}

export { leaseStatus } from '@/lib/lease-status'
export type { LeaseStatus } from '@/lib/lease-status'

/** min(unused cap this period, lease balance), the same rule the contract applies. */
export function remainingAllowance(lease: Lease, status: LeaseStatus): bigint {
  if (lease.onChainRemaining !== undefined) return lease.onChainRemaining
  if (status !== 'active') return 0n
  const unused = lease.cap > lease.spentThisPeriod ? lease.cap - lease.spentThisPeriod : 0n
  return unused < lease.balance ? unused : lease.balance
}

export type ActivityType = 'LeaseCreated' | 'Deposited' | 'Spent' | 'Revoked' | 'Withdrawn' | 'AllowlistUpdated'

export interface ActivityItem {
  id: string
  type: ActivityType
  leaseId: string
  agent?: Address
  recipient?: Address
  /** USDC base units (6 decimals). */
  amount?: bigint
  /** Unix seconds, when the block timestamp could be read. */
  timestamp?: number
  txHash: Hex
  status: 'success' | 'pending' | 'failed'
}

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  LeaseCreated: 'Lease created',
  Deposited: 'Funds added',
  Spent: 'Payment sent',
  Revoked: 'Lease revoked',
  Withdrawn: 'Funds withdrawn',
  AllowlistUpdated: 'Recipient permission updated',
}

export interface DataSource<T> {
  state: DataState
  items: T[]
  /** Plain-language explanation shown when `state` is not `ready`. */
  reason: string
  /** True when cached data is visible while the authoritative source refreshes. */
  refreshing?: boolean
  /** A background refresh failed while an older local snapshot remains visible. */
  refreshError?: string
  /** Retry the underlying read without navigating away from the current section. */
  refetch?: () => void
}

export { useOwnerLeases as useLeases, useOwnerActivityQuery as useActivity, useDelegateLeases } from '@/lib/agentpay-reads'

/** What the deployed contract can do today. `inApp` flips to true as each action is wired up. */
export const CONTRACT_ACTIONS = [
  { id: 'create', label: 'Create a lease', fn: 'createLease', inContract: true, inApp: true },
  { id: 'deposit', label: 'Add funds to a lease', fn: 'deposit', inContract: true, inApp: true },
  { id: 'allowlist', label: 'Approve or remove a recipient', fn: 'setAllowlist', inContract: true, inApp: true },
  { id: 'revoke', label: 'Revoke a lease', fn: 'revoke', inContract: true, inApp: true },
  { id: 'withdraw', label: 'Withdraw unspent funds', fn: 'withdraw', inContract: true, inApp: true },
  { id: 'spend', label: 'Spend as the agent', fn: 'spend', inContract: true, inApp: true },
] as const

export const ACTION_PENDING_REASON = 'This action is not yet available in the app.'

// ---- formatting (display only) ----

export function formatUsdc(raw: bigint): string {
  const [whole, fraction = ''] = formatUnits(raw, 6).split('.')
  return `${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function formatPeriod(seconds: number): string {
  const unit = (size: number, name: string) => {
    const n = seconds / size
    return `${n} ${name}${n === 1 ? '' : 's'}`
  }
  if (seconds % 86400 === 0) return unit(86400, 'day')
  if (seconds % 3600 === 0) return unit(3600, 'hour')
  if (seconds % 60 === 0) return unit(60, 'minute')
  return unit(1, 'second')
}

export function formatDateTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
