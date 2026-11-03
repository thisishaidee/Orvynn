import { describe, expect, it } from 'bun:test'
import {
  advanceEventHistoryCheckpoint,
  eventHistoryCacheKey,
  mergeEventHistory,
  planEventHistoryScan,
  type EventHistoryCheckpoint,
} from './event-history-cache'

const identity = {
  chainId: 5042,
  contract: '0xABCDEF',
  wallet: '0x123456',
}
const hashA = `0x${'a'.repeat(64)}`
const hashB = `0x${'b'.repeat(64)}`
const checkpoint: EventHistoryCheckpoint = {
  version: 1,
  chainId: 5042,
  contract: '0xabcdef',
  wallet: '0x123456',
  throughBlock: '1000',
  blockHash: hashA,
}

describe('event history cache primitives', () => {
  it('scopes cache keys by chain, contract and wallet, case-insensitively', () => {
    expect(eventHistoryCacheKey(identity)).toBe(
      eventHistoryCacheKey({ ...identity, contract: '0xabcdef', wallet: '0x123456' }),
    )
    expect(eventHistoryCacheKey(identity)).not.toBe(
      eventHistoryCacheKey({ ...identity, chainId: 5042002 }),
    )
  })

  it('starts a first scan at deployment block', () => {
    expect(planEventHistoryScan({
      deploymentBlock: 100n,
      snapshotBlock: 200n,
      identity,
    })).toEqual({ fromBlock: 100n, toBlock: 200n, mode: 'full' })
  })

  it('uses an overlap for a valid incremental scan', () => {
    expect(planEventHistoryScan({
      deploymentBlock: 100n,
      snapshotBlock: 1100n,
      checkpoint,
      identity,
      observedCheckpointBlockHash: hashA,
      overlapBlocks: 12n,
    })).toEqual({ fromBlock: 989n, toBlock: 1100n, mode: 'incremental' })
  })

  it('forces a full rebuild when the checkpoint block hash changes', () => {
    expect(planEventHistoryScan({
      deploymentBlock: 100n,
      snapshotBlock: 1100n,
      checkpoint,
      identity,
      observedCheckpointBlockHash: hashB,
    })).toEqual({ fromBlock: 100n, toBlock: 1100n, mode: 'rebuild' })
  })

  it('forces a rebuild when wallet or chain identity changes', () => {
    expect(planEventHistoryScan({
      deploymentBlock: 100n,
      snapshotBlock: 1100n,
      checkpoint,
      identity: { ...identity, wallet: '0x999999' },
      observedCheckpointBlockHash: hashA,
    }).mode).toBe('rebuild')
  })

  it('deduplicates overlapping logs and sorts by block then log index', () => {
    const first = { blockNumber: 12n, transactionHash: '0xAA', logIndex: 2, label: 'second' }
    const second = { blockNumber: 11n, transactionHash: '0xBB', logIndex: 0, label: 'first' }
    const duplicate = { ...first, transactionHash: '0xaa', label: 'duplicate' }
    expect(mergeEventHistory([first, second], [duplicate])).toEqual([second, duplicate])
  })

  it('refuses events without a stable log identity', () => {
    expect(() => mergeEventHistory([{
      blockNumber: 1n, transactionHash: null, logIndex: 0,
    }])).toThrow('Cannot cache an event')
  })

  it('does not advance a checkpoint after an incomplete scan', () => {
    expect(() => advanceEventHistoryCheckpoint({
      identity, throughBlock: 1200n, blockHash: hashB, complete: false,
    })).toThrow('incomplete scan')
  })

  it('creates a checkpoint only for a complete snapshot', () => {
    expect(advanceEventHistoryCheckpoint({
      identity, throughBlock: 1200n, blockHash: hashB, complete: true,
    })).toEqual({
      version: 1,
      chainId: 5042,
      contract: '0xabcdef',
      wallet: '0x123456',
      throughBlock: '1200',
      blockHash: hashB,
    })
  })

  it('refuses checkpoint rollback for the same identity', () => {
    expect(() => advanceEventHistoryCheckpoint({
      previous: checkpoint,
      identity,
      throughBlock: 999n,
      blockHash: hashB,
      complete: true,
    })).toThrow('cannot move backwards')
  })
})
