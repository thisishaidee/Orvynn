import { describe, expect, test } from 'bun:test'
import type { Address, PublicClient } from 'viem'
import { activityAgent, currentPeriodSpent, currentWindowIndex } from '../src/lib/agentpay-accounting'
import { getLogsChunked, isRateLimitError, isRangeLimitError } from '../src/lib/agentpay-logs'
import { leaseStatus } from '../src/lib/lease-status'

const DELEGATE = '0x1111111111111111111111111111111111111111' as Address
const OWNER = '0x2222222222222222222222222222222222222222' as Address

describe('period rollover matches AgentPay.sol', () => {
  test('reports stored spent when the current window index matches lastWindowIndex', () => {
    expect(currentWindowIndex(1050n, 1000n, 100n)).toBe(0n)
    expect(currentPeriodSpent({
      nowSeconds: 1050n,
      windowStart: 1000n,
      periodSeconds: 100n,
      lastWindowIndex: 0n,
      spentThisWindow: 40n,
    })).toBe(40n)
  })

  test('reports zero after the window rolls over', () => {
    expect(currentWindowIndex(1100n, 1000n, 100n)).toBe(1n)
    expect(currentPeriodSpent({
      nowSeconds: 1100n,
      windowStart: 1000n,
      periodSeconds: 100n,
      lastWindowIndex: 0n,
      spentThisWindow: 40n,
    })).toBe(0n)
  })

  test('uses the same integer division as the contract', () => {
    expect(currentWindowIndex(2500n, 1000n, 700n)).toBe(2n)
    expect(currentPeriodSpent({
      nowSeconds: 2500n,
      windowStart: 1000n,
      periodSeconds: 700n,
      lastWindowIndex: 2n,
      spentThisWindow: 7n,
    })).toBe(7n)
  })
})

describe('activity agent identity', () => {
  test('LeaseCreated uses the event delegate, not the owner', () => {
    expect(activityAgent('LeaseCreated', { delegate: DELEGATE }, OWNER)).toBe(DELEGATE)
  })

  test('other events use the lease delegate and never the owner', () => {
    expect(activityAgent('Spent', {}, DELEGATE)).toBe(DELEGATE)
    expect(activityAgent('Deposited', { delegate: undefined }, DELEGATE)).toBe(DELEGATE)
    expect(activityAgent('Spent', {}, undefined)).toBeUndefined()
  })
})

describe('event pagination completeness', () => {
  test('throws instead of returning partial logs when the chunk limit is hit', async () => {
    let calls = 0
    const client = {
      getBlockNumber: async () => 1_000_050_000n,
      getLogs: async () => {
        calls += 1
        return []
      },
    } as unknown as PublicClient

    await expect(getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event: { type: 'event', name: 'LeaseCreated', inputs: [] } as never,
      fromBlock: 0n,
    })).rejects.toThrow(/Incomplete event history/)
    expect(calls).toBe(0)
  })
})

describe('allowlist read failure', () => {
  test('does not turn a failed AllowlistUpdated read into an empty list', async () => {
    const client = {
      getBlockNumber: async () => 10n,
      getLogs: async () => {
        throw new Error('allowlist rpc failed')
      },
    } as unknown as PublicClient

    await expect(getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event: { type: 'event', name: 'AllowlistUpdated', inputs: [] } as never,
      fromBlock: 0n,
    })).rejects.toThrow('allowlist rpc failed')
  })
})

describe('Arc RPC error classification', () => {
  test('recognises genuine provider throttling without treating it as a range limit', () => {
    const error = new Error('rate limit exceeded')
    expect(isRateLimitError(error)).toBe(true)
    expect(isRangeLimitError(error)).toBe(false)
  })

  test('recognises HTTP 429 throttling responses, including status-only errors', () => {
    expect(isRateLimitError({ status: 429, message: 'Too many requests' })).toBe(true)
    expect(isRangeLimitError({ status: 429, message: 'Too many requests' })).toBe(false)
    expect(isRateLimitError({ status: 429 })).toBe(true)
    expect(isRangeLimitError({ status: 429 })).toBe(false)
  })

  test('keeps explicit block-range errors eligible for adaptive splitting', () => {
    const error = new Error('eth_getLogs block range too large')
    expect(isRangeLimitError(error)).toBe(true)
    expect(isRateLimitError(error)).toBe(false)
  })

  test('recognises Arc request-limit wording as a splittable range limit', () => {
    const error = new Error('Request exceeds defined limit')
    expect(isRangeLimitError(error)).toBe(true)
    expect(isRateLimitError(error)).toBe(false)
  })

  test('splits Arc request-size errors even when details contain generic rate-limit wording', async () => {
    const error = new Error('Request exceeds defined limit. Details: rate limit exceeded')
    expect(isRangeLimitError(error)).toBe(true)
    expect(isRateLimitError(error)).toBe(false)

    const ranges: Array<[bigint, bigint]> = []
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock])
        if (toBlock - fromBlock + 1n > 5_000n) throw error
        return []
      },
    } as unknown as PublicClient

    await getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event: { type: 'event', name: 'LeaseCreated', inputs: [] } as never,
      fromBlock: 0n,
      toBlock: 9_999n,
    })

    expect(ranges).toEqual([
      [0n, 9_999n],
      [0n, 4_999n],
      [5_000n, 9_999n],
    ])
  })
})

describe('lease funding status', () => {
  const baseLease = {
    revoked: false,
    expiry: 2_000_000_000,
    balance: 0n,
  }

  test('marks a never-funded lease as unfunded', () => {
    expect(leaseStatus({ ...baseLease, everFunded: false }, 1_900_000_000)).toBe('unfunded')
  })

  test('marks a previously funded zero-balance lease as depleted', () => {
    expect(leaseStatus({ ...baseLease, everFunded: true }, 1_900_000_000)).toBe('depleted')
  })

  test('does not guess when zero-balance funding history is unavailable', () => {
    expect(leaseStatus({ ...baseLease, everFunded: null }, 1_900_000_000)).toBe('unknown')
  })

  test('keeps a funded lease active while it still holds funds', () => {
    expect(leaseStatus({ ...baseLease, balance: 1n, everFunded: true }, 1_900_000_000)).toBe('active')
  })

  test('expiry and revocation take precedence over funding status', () => {
    expect(leaseStatus({ ...baseLease, everFunded: false }, 2_000_000_000)).toBe('expired')
    expect(leaseStatus({ ...baseLease, everFunded: false, revoked: true }, 1_900_000_000)).toBe('revoked')
  })
})
