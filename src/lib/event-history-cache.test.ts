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

const identity = {
  chainId: 5042,
  contract: '0xABCDEF',
  wallet: '0x123456',
  scope: 'owner-leases' as const,
}
const hashA = `0x${'a'.repeat(64)}`
const hashB = `0x${'b'.repeat(64)}`
const checkpoint: EventHistoryCheckpoint = {
  version: 1,
  chainId: 5042,
  contract: '0xabcdef',
  wallet: '0x123456',
  scope: 'owner-leases',
  throughBlock: '1000',
  blockHash: hashA,
}

describe('event history cache primitives', () => {
  it('scopes cache keys by chain, contract and wallet, case-insensitively', () => {
    assert.equal(eventHistoryCacheKey(identity), eventHistoryCacheKey({ ...identity, contract: '0xabcdef', wallet: '0x123456' }))
    assert.notEqual(eventHistoryCacheKey(identity), eventHistoryCacheKey({ ...identity, chainId: 5042002 }))
    assert.notEqual(eventHistoryCacheKey(identity), eventHistoryCacheKey({ ...identity, scope: 'delegate-leases' }))
  })

  it('keeps owner, delegate and activity checkpoints separate', () => {
    assert.equal(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 1100n, checkpoint, identity: { ...identity, scope: 'activity' }, observedCheckpointBlockHash: hashA }).mode, 'rebuild')
  })

  it('round-trips bigint log fields and rejects malformed cache data', () => {
    const events = [{ blockNumber: 12n, args: { leaseId: 9n, amount: 2500000n } }]
    assert.deepEqual(parseEventHistory<typeof events[number]>(serializeEventHistory(events)), events)
    assert.equal(parseEventHistory('not-json'), undefined)
    assert.equal(parseEventHistory('\\u007b\\u0022no\\u0022\\u003a\\u0022array\\u0022\\u007d'), undefined)
  })

  it('starts a first scan at deployment block', () => {
    assert.deepEqual(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 200n, identity }), { fromBlock: 100n, toBlock: 200n, mode: 'full' })
  })

  it('uses an overlap for a valid incremental scan', () => {
    assert.deepEqual(planEventHistoryScan({ deploymentBlock: 100n, snapshotBlock: 1100n, checkpoint, identity, observedCheckpointBlockHash: hashA, overlapBlocks: 12n }), { fromBlock: 989n, toBlock: 1100n, mode: 'incremental' })
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
