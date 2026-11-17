import {
  advanceEventHistoryCheckpoint,
  eventHistoryCacheKey,
  mergeEventHistory,
  planEventHistoryScan,
  type EventHistoryCheckpoint,
  type EventHistoryIdentity,
  type EventHistoryItem,
} from './event-history-cache'
import {
  getBrowserEventHistoryStorage,
  readStoredEventHistory,
  writeStoredEventHistory,
  type EventHistoryStorage,
} from './event-history-storage'

export type IncrementalHistoryResult<T> = {
  events: T[]
  checkpoint: EventHistoryCheckpoint
  mode: 'full' | 'incremental' | 'rebuild'
}

/**
 * Loads one isolated event stream. The caller's scan must reject incomplete RPC
 * results. A checkpoint is committed only after the snapshot hash is unchanged
 * across the scan; a changed hash triggers one clean full-scan retry.
 */
export async function loadIncrementalEventHistory<T extends EventHistoryItem>(input: {
  identity: EventHistoryIdentity
  deploymentBlock: bigint
  snapshotBlock: bigint
  getBlockHash: (block: bigint) => Promise<string>
  scan: (fromBlock: bigint, toBlock: bigint) => Promise<T[]>
  storage?: EventHistoryStorage
}): Promise<IncrementalHistoryResult<T>> {
  const storage = input.storage ?? getBrowserEventHistoryStorage()
  const key = eventHistoryCacheKey(input.identity)
  const stored = readStoredEventHistory<T>(storage, key, input.identity)

  const execute = async (forceRebuild: boolean) => {
    const snapshotHashBefore = await input.getBlockHash(input.snapshotBlock)
    const checkpointBlock = stored ? BigInt(stored.checkpoint.throughBlock) : undefined
    // A checkpoint ahead of this snapshot cannot be queried at the current
    // chain height. Let the planner select a full rebuild instead.
    const observedCheckpointHash = stored && !forceRebuild &&
      checkpointBlock !== undefined && checkpointBlock <= input.snapshotBlock
      ? await input.getBlockHash(checkpointBlock)
      : undefined
    const plan = forceRebuild
      ? { fromBlock: input.deploymentBlock, toBlock: input.snapshotBlock, mode: 'rebuild' as const }
      : planEventHistoryScan({
          deploymentBlock: input.deploymentBlock,
          snapshotBlock: input.snapshotBlock,
          checkpoint: stored?.checkpoint,
          identity: input.identity,
          observedCheckpointBlockHash: observedCheckpointHash,
        })

    const fresh = await input.scan(plan.fromBlock, plan.toBlock)
    const events = plan.mode === 'incremental' && stored
      ? mergeEventHistory(stored.events, fresh)
      : mergeEventHistory(fresh)

    const snapshotHashAfter = await input.getBlockHash(input.snapshotBlock)
    if (snapshotHashBefore.toLowerCase() !== snapshotHashAfter.toLowerCase()) {
      return undefined
    }

    const checkpoint = advanceEventHistoryCheckpoint({
      previous: plan.mode === 'incremental' ? stored?.checkpoint : undefined,
      identity: input.identity,
      throughBlock: input.snapshotBlock,
      blockHash: snapshotHashAfter,
      complete: true,
    })
    writeStoredEventHistory(storage, key, input.identity, checkpoint, events)
    return { events, checkpoint, mode: plan.mode }
  }

  const result = await execute(false)
  if (result) return result

  // The observed chain changed during the scan. Discard the partial result and
  // rebuild once from deployment; never checkpoint a mixed-fork history.
  const retry = await execute(true)
  if (!retry) throw new Error('Chain snapshot changed during event-history rebuild. Please retry.')
  return retry
}
