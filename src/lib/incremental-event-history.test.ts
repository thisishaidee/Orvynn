import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { loadIncrementalEventHistory } from './incremental-event-history'
import type { EventHistoryStorage } from './event-history-storage'

const identity = {
  chainId: 5042002,
  contract: '0x1111111111111111111111111111111111111111',
  wallet: '0x2222222222222222222222222222222222222222',
  scope: 'owner-lease-created' as const,
}
const snapshotHash = `0x${'a'.repeat(64)}`

function memoryStorage(): EventHistoryStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) },
  }
}

function event(blockNumber: bigint, suffix: string) {
  return {
    blockNumber,
    transactionHash: `0x${suffix.repeat(64)}`,
    logIndex: 0,
    args: { leaseId: blockNumber },
  }
}

describe('resumable incremental event history', () => {
  it('reuses completed ranges after a later range fails without checkpointing partial history', async () => {
    const storage = memoryStorage()
    const scanned: Array<[bigint, bigint]> = []
    let failSecondRange = true

    await assert.rejects(loadIncrementalEventHistory({
      identity,
      deploymentBlock: 100n,
      snapshotBlock: 10_100n,
      storage,
      getBlockHash: async () => snapshotHash,
      scan: async (from, to) => {
        scanned.push([from, to])
        if (from === 10_100n && failSecondRange) {
          failSecondRange = false
          throw new Error('temporary RPC failure')
        }
        return [event(from, from === 100n ? 'b' : 'c')]
      },
    }), /temporary RPC failure/)

    assert.deepEqual(scanned, [[100n, 10_099n], [10_100n, 10_100n]])

    const result = await loadIncrementalEventHistory({
      identity,
      deploymentBlock: 100n,
      snapshotBlock: 10_101n,
      storage,
      getBlockHash: async () => snapshotHash,
      scan: async (from, to) => {
        scanned.push([from, to])
        return [event(from, 'c')]
      },
    })

    assert.deepEqual(scanned, [
      [100n, 10_099n],
      [10_100n, 10_100n],
      [10_100n, 10_100n],
      [10_100n, 10_101n],
    ])
    assert.equal(result.events.length, 2)
    assert.equal(result.checkpoint.throughBlock, '10101')
  })

  it('does not reuse progress from a different pinned snapshot hash', async () => {
    const storage = memoryStorage()
    const scanned: Array<[bigint, bigint]> = []
    const firstHash = `0x${'a'.repeat(64)}`
    const secondHash = `0x${'d'.repeat(64)}`

    await assert.rejects(loadIncrementalEventHistory({
      identity,
      deploymentBlock: 100n,
      snapshotBlock: 10_100n,
      storage,
      getBlockHash: async () => firstHash,
      scan: async (from, to) => {
        scanned.push([from, to])
        if (from === 10_100n) throw new Error('stop after first range')
        return [event(from, 'e')]
      },
    }), /stop after first range/)

    const result = await loadIncrementalEventHistory({
      identity,
      deploymentBlock: 100n,
      snapshotBlock: 10_100n,
      storage,
      getBlockHash: async () => secondHash,
      scan: async (from, to) => {
        scanned.push([from, to])
        return [event(from, from === 100n ? 'f' : '1')]
      },
    })

    assert.deepEqual(scanned.slice(2), [[100n, 10_099n], [10_100n, 10_100n]])
    assert.equal(result.events.length, 2)
    assert.equal(result.checkpoint.blockHash, secondHash)
  })
})
