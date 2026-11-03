import { describe, expect, test } from 'bun:test'
import type { Address, Hex, PublicClient } from 'viem'
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
    expect(calls).toBe(0)
  })
})


describe('large bounded log ranges', () => {
  test('uses 50,000-block ranges for fewer RPC round trips', async () => {
    const ranges: Array<[bigint, bigint]> = []
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock])
        return []
      },
    } as unknown as PublicClient

    await expect(getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event: { type: 'event', name: 'LeaseCreated', inputs: [] } as never,
      fromBlock: 0n,
      toBlock: 100_000n,
    })).resolves.toEqual([])

    expect(ranges).toEqual([
      [0n, 49_999n],
      [50_000n, 99_999n],
      [100_000n, 100_000n],
    ])
  })


  test('does not split a rate-limited request into more RPC calls', async () => {
    const ranges: Array<[bigint, bigint]> = []
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock])
        throw new Error('HTTP 429: rate limit exceeded')
      },
    } as unknown as PublicClient

    await expect(getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event: { type: 'event', name: 'LeaseCreated', inputs: [] } as never,
      fromBlock: 0n,
      toBlock: 49_999n,
    })).rejects.toThrow(/rate limit exceeded/)

    expect(ranges).toEqual([[0n, 49_999n]])
  })

  test('does not split a timed-out request into more RPC calls', async () => {
    const ranges: Array<[bigint, bigint]> = []
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock])
        throw new Error('request timed out')
      },
    } as unknown as PublicClient

    await expect(getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event: { type: 'event', name: 'LeaseCreated', inputs: [] } as never,
      fromBlock: 0n,
      toBlock: 49_999n,
    })).rejects.toThrow(/timed out/)

    expect(ranges).toEqual([[0n, 49_999n]])
  })

  test('splits a rejected large range and still returns the complete result', async () => {
    const ranges: Array<[bigint, bigint]> = []
    const client = {
      getLogs: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        ranges.push([fromBlock, toBlock])
        if (toBlock - fromBlock + 1n > 25_000n) throw new Error('range too large')
        return []
      },
    } as unknown as PublicClient

    await expect(getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event: { type: 'event', name: 'LeaseCreated', inputs: [] } as never,
      fromBlock: 0n,
      toBlock: 49_999n,
    })).resolves.toEqual([])

    expect(ranges).toContainEqual([0n, 49_999n])
    expect(ranges).toContainEqual([0n, 24_999n])
    expect(ranges).toContainEqual([25_000n, 49_999n])
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

describe('bounded event log reads', () => {
  test('uses a lease-ID indexed event filter and respects a pinned snapshot', async () => {
    const calls: Array<Record<string, unknown>> = []
    const client = {
      getLogs: async (params: Record<string, unknown>) => {
        calls.push(params)
        return []
      },
    } as unknown as PublicClient

    const event = {
      type: 'event',
      name: 'Deposited',
      inputs: [{ name: 'leaseId', type: 'uint256', indexed: true }],
    } as never

    await expect(getLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      event,
      args: { leaseId: [1n, 2n] },
      fromBlock: 10n,
      toBlock: 20n,
    })).resolves.toEqual([])

    expect(calls).toHaveLength(1)
    expect(calls[0].fromBlock).toBe(10n)
    expect(calls[0].toBlock).toBe(20n)
    expect(calls[0].event).toEqual(event)
    expect(calls[0].args).toEqual({ leaseId: [1n, 2n] })
  })
})


describe('combined AgentPay activity log query', () => {
  test('uses one topic-filtered RPC query for all six event signatures and decodes the event', async () => {
    const { agentPayAbi } = await import('../src/lib/agentpay-abi')
    const { encodeAbiParameters, toEventSelector } = await import('viem')
    const { getActivityLogsChunked } = await import('../src/lib/agentpay-logs')
    const events = agentPayAbi.filter((item) => item.type === 'event')
    const revoked = events.find((event) => event.name === 'Revoked')
    if (!revoked) throw new Error('Revoked ABI event is missing')

    const leaseId = 7n
    const idTopic = encodeAbiParameters([{ type: 'uint256' }], [leaseId])
    const eventTopic = toEventSelector(revoked)
    const txHash = `0x${'11'.repeat(32)}` as const
    const requests: Array<Record<string, unknown>> = []
    const client = {
      request: async (request: Record<string, unknown>) => {
        requests.push(request)
        return [{
          data: '0x',
          topics: [eventTopic, idTopic],
          blockNumber: '0xa',
          transactionHash: txHash,
          logIndex: '0x0',
        }]
      },
    } as unknown as PublicClient

    const result = await getActivityLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      events,
      leaseIds: [leaseId],
      fromBlock: 10n,
      toBlock: 20n,
    })

    expect(requests).toHaveLength(1)
    const filter = (requests[0].params as Array<Record<string, unknown>>)[0]
    const topics = filter.topics as Hex[][]
    expect(topics[0]).toHaveLength(6)
    expect(topics[1]).toEqual([idTopic])
    expect(result).toHaveLength(1)
    expect(result[0].eventName).toBe('Revoked')
    expect(result[0].args.leaseId).toBe(leaseId)
    expect(result[0].blockNumber).toBe(10n)
    expect(result[0].logIndex).toBe(0)
  })
})
