import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  advanceEventHistoryCheckpoint,
  eventHistoryCacheKey,
  mergeEventHistory,
  parseEventHistory,
  planEventHistoryScan,
  serializeEventHistory,
  type EventHistoryCheckpoint,
} from './event-history-cache'
import { readStoredEventHistory, writeStoredEventHistory, type EventHistoryStorage } from './event-history-storage'
import { loadIncrementalEventHistory } from './incremental-event-history'

const identity = {
  chainId: 5042,
  contract: '0xABCDEF',
  wallet: '0x123456',
  scope: 'owner-lease-created' as const,
}
const hashA = `0x${'a'.repeat(64)}`
const hashB = `0x${'b'.repeat(64)}`
const checkpoint: EventHistoryCheckpoint = {
  version: 1,
  chainId: 5042,
  contract: '0xabcdef',
  wallet: '0x123456',
  scope: 'owner-lease-created',
  throughBlock: '1000',
  blockHash: hashA,
}

describe('event history cache primitives', () => {
  it('scopes cache keys by chain, contract and wallet, case-insensitively', () => {
    assert.equal(eventHistoryCacheKey(identity), eventHistoryCacheKey({ ...identity, contract: '0xabcdef', wallet: '0x123456' }))
    assert.notEqual(eventHistoryCacheKey(identity), eventHistoryCacheKey({ ...identity, chainId: 5042002 }))
    assert.notEqual(eventHistoryCacheKey(identity), eventHistoryCacheKey({ ...identity, scope: 'delegate-lease-created' }))
  })

  it('keeps distinct event streams and activity filters get separate checkpoints', () => {
    assert.equal(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 1100n, checkpoint, identity: { ...identity, scope: 'activity' }, observedCheckpointBlockHash: hashA }).mode, 'rebuild')
  })

  it('round-trips bigint log fields and rejects malformed cache data', () => {
    const events = [{ blockNumber: 12n, args: { leaseId: 9n, amount: 2500000n } }]
    assert.deepEqual(parseEventHistory<typeof events[number]>(serializeEventHistory(events)), events)
    assert.equal(parseEventHistory('not-json'), undefined)
    assert.equal(parseEventHistory('{"no":"array"}'), undefined)
  })


  it('persists and reads a complete scoped browser-cache envelope', () => {
    const values = new Map<string, string>()
    const storage: EventHistoryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    }
    const events = [{ blockNumber: 1200n, transactionHash: '0xabc', logIndex: 0, args: { leaseId: 7n } }]
    const saved = advanceEventHistoryCheckpoint({ identity, throughBlock: 1200n, blockHash: hashB, complete: true })
    assert.equal(writeStoredEventHistory(storage, 'key', identity, saved, events), true)
    assert.deepEqual(readStoredEventHistory<typeof events[number]>(storage, 'key', identity), { checkpoint: saved, events })
  })

  it('rejects and removes a cache envelope belonging to another stream', () => {
    const values = new Map<string, string>()
    const storage: EventHistoryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    }
    const saved = advanceEventHistoryCheckpoint({ identity, throughBlock: 1200n, blockHash: hashB, complete: true })
    writeStoredEventHistory(storage, 'key', identity, saved, [])
    assert.equal(readStoredEventHistory(storage, 'key', { ...identity, scope: 'activity' }), undefined)
    assert.equal(values.has('key'), false)
  })


  it('reuses a verified checkpoint and scans only the overlap', async () => {
    const values = new Map<string, string>()
    const storage: EventHistoryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    }
    const original = [{ blockNumber: 1000n, transactionHash: '0xold', logIndex: 0 }]
    const saved = advanceEventHistoryCheckpoint({ identity, throughBlock: 1000n, blockHash: hashA, complete: true })
    writeStoredEventHistory(storage, eventHistoryCacheKey(identity), identity, saved, original)
    const scanned: Array<[bigint, bigint]> = []
    const result = await loadIncrementalEventHistory({
      identity,
      deploymentBlock: 100n,
      snapshotBlock: 1100n,
      storage,
      getBlockHash: async (block) => block === 1000n ? hashA : hashB,
      scan: async (from, to) => {
        scanned.push([from, to])
        return [{ blockNumber: 1090n, transactionHash: '0xnew', logIndex: 0 }]
      },
    })
    assert.equal(result.mode, 'incremental')
    assert.deepEqual(scanned, [[989n, 1100n]])
    assert.equal(result.events.length, 2)
  })

  it('rebuilds from deployment when the snapshot changes during scan', async () => {
    const values = new Map<string, string>()
    const storage: EventHistoryStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value) },
      removeItem: (key) => { values.delete(key) },
    }
    let snapshotReads = 0
    const scanned: Array<[bigint, bigint]> = []
    const result = await loadIncrementalEventHistory({
      identity,
      deploymentBlock: 100n,
      snapshotBlock: 200n,
      storage,
      getBlockHash: async (block) => {
        if (block !== 200n) return hashA
        snapshotReads += 1
        return snapshotReads === 2 ? hashB : hashA
      },
      scan: async (from, to) => {
        scanned.push([from, to])
        return [{ blockNumber: to, transactionHash: `0x${scanned.length}`, logIndex: 0 }]
      },
    })
    assert.equal(result.mode, 'rebuild')
    assert.deepEqual(scanned, [[100n, 200n], [100n, 200n]])
    assert.equal(snapshotReads, 4)
  })

  it('starts a first scan at deployment block', () => {
    assert.deepEqual(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 200n, identity }), { fromBlock: 100n, toBlock: 200n, mode: 'full' })
  })

  it('uses an overlap for a valid incremental scan', () => {
    assert.deepEqual(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 1100n, checkpoint, identity, observedCheckpointBlockHash: hashA, overlapBlocks: 12n }), { fromBlock: 989n, toBlock: 1100n, mode: 'incremental' })
  })

  it('rebuilds when the cached checkpoint is ahead of the current snapshot', () => {
    assert.deepEqual(
      planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 900n, checkpoint, identity, observedCheckpointBlockHash: hashA }),
      { fromBlock: 100n, toBlock: 900n, mode: 'rebuild' },
    )
  })

  it('isolates activity caches when the lease-id filter changes', () => {
    const first = { ...identity, scope: 'activity' as const, filterKey: 'lease-1,lease-2' }
    const second = { ...identity, scope: 'activity' as const, filterKey: 'lease-1,lease-3' }
    assert.notEqual(eventHistoryCacheKey(first), eventHistoryCacheKey(second))
    const firstCheckpoint = advanceEventHistoryCheckpoint({
      identity: first, throughBlock: 1000n, blockHash: hashA, complete: true,
    })
    assert.equal(
      planEventHistoryScan({
        deploymentBlock: 100n, snapshotBlock: 1100n, checkpoint: firstCheckpoint,
        identity: second, observedCheckpointBlockHash: hashA,
      }).mode,
      'rebuild',
    )
  })

  it('forces a full rebuild when the checkpoint block hash changes', () => {
    assert.deepEqual(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 1100n, checkpoint, identity, observedCheckpointBlockHash: hashB }), { fromBlock: 100n, toBlock: 1100n, mode: 'rebuild' })
  })

  it('forces a rebuild when wallet or chain identity changes', () => {
    assert.equal(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 1100n, checkpoint, identity: { ...identity, wallet: '0x999999' }, observedCheckpointBlockHash: hashA }).mode, 'rebuild')
  })

  it('deduplicates overlapping logs and sorts by block then log index', () => {
    const first = { blockNumber: 12n, transactionHash: '0xAA', logIndex: 2, label: 'second' }
    const second = { blockNumber: 11n, transactionHash: '0xBB', logIndex: 0, label: 'first' }
    const duplicate = { ...first, transactionHash: '0xaa', label: 'duplicate' }
    assert.deepEqual(mergeEventHistory([first, second], [duplicate]), [second, duplicate])
  })

  it('refuses events without a stable log identity', () => {
    assert.throws(() => mergeEventHistory([{ blockNumber: 1n, transactionHash: null, logIndex: 0 }]), /Cannot cache an event/)
  })

  it('does not advance a checkpoint after an incomplete scan', () => {
    assert.throws(() => advanceEventHistoryCheckpoint({ identity, throughBlock: 1200n, blockHash: hashB, complete: false }), /incomplete scan/)
  })

  it('creates a checkpoint only for a complete snapshot', () => {
    assert.deepEqual(advanceEventHistoryCheckpoint({ identity, throughBlock: 1200n, blockHash: hashB, complete: true }), {
      version: 1,
      chainId: 5042,
      contract: '0xabcdef',
      wallet: '0x123456',
      scope: 'owner-leases',
      throughBlock: '1200',
      blockHash: hashB,
    })
  })

  it('refuses checkpoint rollback for the same identity', () => {
    assert.throws(() => advanceEventHistoryCheckpoint({ previous: checkpoint, identity, throughBlock: 999n, blockHash: hashB, complete: true }), /cannot move backwards/)
  })
})
