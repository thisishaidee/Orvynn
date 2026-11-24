import {
  advanceEventHistoryCheckpoint,
  eventHistoryCacheKey,
  mergeEventHistory,
  planEventHistoryScan,
  parseEventHistory,
  serializeEventHistory,
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

const PROGRESS_RANGE_SIZE = 10_000n
const MAX_PROGRESS_CHARS = 1_500_000

function progressKey(baseKey: string, snapshot: bigint, hash: string, from: bigint, to: bigint): string {
  return `${baseKey}:progress:${snapshot}:${hash.toLowerCase()}:${from}-${to}`
}

function readProgress<T extends EventHistoryItem>(
  storage: EventHistoryStorage | undefined,
  key: string,
): T[] | undefined {
  if (!storage) return undefined
  try {
    const raw = storage.getItem(key)
    if (!raw) return undefined
    if (raw.length > MAX_PROGRESS_CHARS) {
      storage.removeItem(key)
      return undefined
    }
    const events = parseEventHistory<T>(raw)
    if (!events) {
      storage.removeItem(key)
      return undefined
    }
    // Validate every cached event before allowing it to satisfy a scan range.
    return mergeEventHistory(events)
  } catch {
    try { storage.removeItem(key) } catch { /* Storage may be unavailable. */ }
    return undefined
  }
}

function writeProgress<T extends EventHistoryItem>(
  storage: EventHistoryStorage | undefined,
  key: string,
  events: readonly T[],
): void {
  if (!storage) return
  try {
    const serialized = serializeEventHistory(events)
    if (serialized.length <= MAX_PROGRESS_CHARS) storage.setItem(key, serialized)
  } catch {
    // Progress persistence is best-effort; it must never turn a successful RPC read into failure.
  }
}

function removeProgress(storage: EventHistoryStorage | undefined, keys: readonly string[]): void {
  if (!storage) return
  for (const key of keys) {
    try { storage.removeItem(key) } catch { /* Storage may be unavailable. */ }
  }
}

/**
 * Loads one isolated event stream. Completed block ranges are persisted
 * independently against a pinned snapshot hash. A failed range can therefore
 * be retried without rescanning earlier ranges, while no partial scan is ever
 * promoted to a complete event-history checkpoint.
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

    const progressKeys: string[] = []
    const fresh: T[] = []
    for (let from = plan.fromBlock; from <= plan.toBlock;) {
      const to = from + PROGRESS_RANGE_SIZE - 1n > plan.toBlock
        ? plan.toBlock
        : from + PROGRESS_RANGE_SIZE - 1n
      const rangeKey = progressKey(key, input.snapshotBlock, snapshotHashBefore, from, to)
      progressKeys.push(rangeKey)
      const cachedRange = readProgress<T>(storage, rangeKey)
      if (cachedRange) {
        fresh.push(...cachedRange)
      } else {
        const completedRange = await input.scan(from, to)
        // Validate before persisting. A malformed/incomplete response cannot
        // become resumable progress or a valid empty range.
        const validatedRange = mergeEventHistory(completedRange)
        writeProgress(storage, rangeKey, validatedRange)
        fresh.push(...validatedRange)
      }
      from = to + 1n
    }

    const events = plan.mode === 'incremental' && stored
      ? mergeEventHistory(stored.events, fresh)
      : mergeEventHistory(fresh)

    const snapshotHashAfter = await input.getBlockHash(input.snapshotBlock)
    if (snapshotHashBefore.toLowerCase() !== snapshotHashAfter.toLowerCase()) {
      removeProgress(storage, progressKeys)
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
    // Only discard progress after the complete snapshot and checkpoint have
    // been validated and committed. If storage rejects the final cache write,
    // the progress ranges remain available for the next attempt.
    if (readStoredEventHistory<T>(storage, key, input.identity)) {
      removeProgress(storage, progressKeys)
    }
    return { events, checkpoint, mode: plan.mode }
  }

  const result = await execute(false)
  if (result) return result

  // The observed chain changed during the scan. Rebuild once against a fresh,
  // pinned snapshot; progress from the old hash is never reused.
  const retry = await execute(true)
  if (!retry) throw new Error('Chain snapshot changed during event-history rebuild. Please retry.')
  return retry
}
