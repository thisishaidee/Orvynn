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

function progressKey(baseKey: string, from: bigint, to: bigint): string {
  // Stable as the chain tip advances; cached ranges are hash-verified before reuse.
  return baseKey + ':progress:' + from.toString() + '-' + to.toString()
}

async function readProgress<T extends EventHistoryItem>(
  storage: EventHistoryStorage | undefined, key: string, toBlock: bigint,
  getBlockHash: (block: bigint) => Promise<string>,
): Promise<T[] | undefined> {
  if (!storage) return undefined
  let blockHash: string
  let events: T[]
  try {
    const raw = storage.getItem(key)
    if (!raw) return undefined
    if (raw.length > MAX_PROGRESS_CHARS) { storage.removeItem(key); return undefined }
    const envelope: unknown = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object') { storage.removeItem(key); return undefined }
    const value = envelope as { version?: unknown; throughBlock?: unknown; blockHash?: unknown; events?: unknown }
    if (value.version !== 1 || value.throughBlock !== toBlock.toString() ||
      typeof value.blockHash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(value.blockHash) ||
      typeof value.events !== 'string') { storage.removeItem(key); return undefined }
    const parsed = parseEventHistory<T>(value.events)
    if (!parsed) { storage.removeItem(key); return undefined }
    events = mergeEventHistory(parsed)
    blockHash = value.blockHash
  } catch {
    try { storage.removeItem(key) } catch { /* Storage may be unavailable. */ }
    return undefined
  }
  // A transient hash-read failure is not evidence of a reorg: retain the cache
  // so a later retry can validate and reuse it.
  let observedHash: string
  try { observedHash = await getBlockHash(toBlock) } catch { return undefined }
  if (observedHash.toLowerCase() !== blockHash.toLowerCase()) {
    try { storage.removeItem(key) } catch { /* Storage may be unavailable. */ }
    return undefined
  }
  return events
}

function writeProgress<T extends EventHistoryItem>(
  storage: EventHistoryStorage | undefined, key: string, toBlock: bigint, blockHash: string, events: readonly T[],
): void {
  if (!storage || !/^0x[0-9a-f]{64}$/i.test(blockHash)) return
  try {
    const serialized = JSON.stringify({ version: 1, throughBlock: toBlock.toString(),
      blockHash: blockHash.toLowerCase(), events: serializeEventHistory(events) })
    if (serialized.length <= MAX_PROGRESS_CHARS) storage.setItem(key, serialized)
  } catch { /* Progress persistence is best-effort. */ }
}

function removeProgress(storage: EventHistoryStorage | undefined, keys: readonly string[]): void {
  if (!storage) return
  for (const key of keys) {
    try { storage.removeItem(key) } catch { /* Storage may be unavailable. */ }
  }
}

/**
 * Loads one isolated event stream. Completed block ranges are persisted
 * independently against each range's canonical end-block hash. Completed ranges
 * can therefore survive a moving chain tip, while no partial scan is ever
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
      const rangeKey = progressKey(key, from, to)
      progressKeys.push(rangeKey)
      const cachedRange = await readProgress<T>(storage, rangeKey, to, input.getBlockHash)
      if (cachedRange) {
        fresh.push(...cachedRange)
      } else {
        const completedRange = await input.scan(from, to)
        // Validate before persisting. A malformed/incomplete response cannot
        // become resumable progress or a valid empty range.
        const validatedRange = mergeEventHistory(completedRange)
        const rangeHash = await input.getBlockHash(to)
        writeProgress(storage, rangeKey, to, rangeHash, validatedRange)
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
    const persisted = writeStoredEventHistory(storage, key, input.identity, checkpoint, events)
    // Only discard progress after this exact snapshot checkpoint was committed.
    // An older valid checkpoint may still exist if the new write hit quota.
    const verified = persisted && readStoredEventHistory<T>(storage, key, input.identity)
    if (
      verified &&
      verified.checkpoint.throughBlock === checkpoint.throughBlock &&
      verified.checkpoint.blockHash.toLowerCase() === checkpoint.blockHash.toLowerCase()
    ) {
      removeProgress(storage, progressKeys)
    }
    return { events, checkpoint, mode: plan.mode }
  }

  const result = await execute(false)
  if (result) return result

  // The observed chain changed during the scan. Rebuild once against a fresh
  // snapshot; each cached range is independently checked against its end hash.
  const retry = await execute(true)
  if (!retry) throw new Error('Chain snapshot changed during event-history rebuild. Please retry.')
  return retry
}
