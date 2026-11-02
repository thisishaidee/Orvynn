import { describe, expect, test } from 'bun:test'
import type { Address, PublicClient } from 'viem'
import { activityAgent, currentPeriodSpent, currentWindowIndex } from '../src/lib/agentpay-accounting'
import { getLogsChunked } from '../src/lib/agentpay-logs'

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
      getBlockNumber: async () => 600_000_000n,
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
    expect(calls).toBe(10_000)
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
