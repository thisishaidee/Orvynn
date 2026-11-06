import type { Lease } from '@/lib/agentpay'

export type LeaseStatus = 'active' | 'unfunded' | 'depleted' | 'unknown' | 'expired' | 'revoked'

/**
 * Derive a display status without confusing a zero balance with a never-funded
 * lease. Funding history is supplied by on-chain Deposited events.
 */
export function leaseStatus(
  lease: Pick<Lease, 'revoked' | 'expiry' | 'balance' | 'everFunded'>,
  nowSeconds = Math.floor(Date.now() / 1000),
): LeaseStatus {
  if (lease.revoked) return 'revoked'
  if (nowSeconds >= lease.expiry) return 'expired'
  if (lease.balance > 0n) return 'active'
  if (lease.everFunded === false) return 'unfunded'
  if (lease.everFunded === true) return 'depleted'
  return 'unknown'
}
