import { describe, expect, test } from 'bun:test'
import type { PublicClient } from 'viem'
import { getBlockTimestamps } from '../src/lib/block-timestamps'

describe('Activity block timestamp cache', () => {
  test('reuses recent timestamps for the same client and block', async () => {
    let calls = 0
    const client = {
      getBlock: async () => {
        calls += 1
        return { timestamp: 1234n }
      },
    } as unknown as PublicClient

    const first = await getBlockTimestamps(client, [10n, 10n])
    const second = await getBlockTimestamps(client, [10n])

    expect(first.get('10')).toBe(1234)
    expect(second.get('10')).toBe(1234)
    expect(calls).toBe(1)
  })

  test('deduplicates concurrent reads for the same block', async () => {
    let calls = 0
    let resolveBlock: ((value: { timestamp: bigint }) => void) | undefined
    const client = {
      getBlock: () => {
        calls += 1
        return new Promise<{ timestamp: bigint }>((resolve) => { resolveBlock = resolve })
      },
    } as unknown as PublicClient

    const first = getBlockTimestamps(client, [20n])
    const second = getBlockTimestamps(client, [20n])
    await Promise.resolve()
    resolveBlock?.({ timestamp: 5678n })

    const [a, b] = await Promise.all([first, second])
    expect(a.get('20')).toBe(5678)
    expect(b.get('20')).toBe(5678)
    expect(calls).toBe(1)
  })

  test('does not cache failed reads as timestamps', async () => {
    let calls = 0
    const client = {
      getBlock: async () => {
        calls += 1
        if (calls === 1) throw new Error('temporary RPC failure')
        return { timestamp: 9999n }
      },
    } as unknown as PublicClient

    expect((await getBlockTimestamps(client, [30n])).has('30')).toBe(false)
    expect((await getBlockTimestamps(client, [30n])).get('30')).toBe(9999)
    expect(calls).toBe(2)
  })

  test('keeps caches isolated between clients', async () => {
    const makeClient = (timestamp: bigint) => ({
      getBlock: async () => ({ timestamp }),
    }) as unknown as PublicClient

    const first = await getBlockTimestamps(makeClient(111n), [40n])
    const second = await getBlockTimestamps(makeClient(222n), [40n])
    expect(first.get('40')).toBe(111)
    expect(second.get('40')).toBe(222)
  })
})
