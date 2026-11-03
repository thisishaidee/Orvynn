/**
 * Pure primitives for safe incremental AgentPay event-history caching.
 *
 * These helpers deliberately do not perform RPC or storage operations. Callers
 * must persist a checkpoint only after every range in the requested snapshot
 * has completed successfully.
 */

export type EventHistoryIdentity = {
  chainId: number
  contract: string
  wallet: string
  scope: 'owner-lease-created' | 'owner-allowlist' | 'delegate-lease-created' | 'activity'
  filterKey?: string
}

export type EventHistoryCheckpoint = {
  version: 1
  chainId: number
  contract: string
  wallet: string
  scope: 'owner-lease-created' | 'owner-allowlist' | 'delegate-lease-created' | 'activity'
  filterKey?: string
  throughBlock: string
  blockHash: string
}

export type EventHistoryItem = {
  blockNumber: bigint | null
  transactionHash: string | null
  logIndex: number | null
  [key: string]: unknown
}

export type EventHistoryScanPlan = {
  fromBlock: bigint
  toBlock: bigint
  mode: 'full' | 'incremental' | 'rebuild'
}

const DEFAULT_OVERLAP_BLOCKS = 12n

function normalizeAddress(value: string): string {
  return value.toLowerCase()
}

export function eventHistoryCacheKey(identity: EventHistoryIdentity): string {
  return [
    'orvynn:event-history:v1',
    identity.chainId,
    normalizeAddress(identity.contract),
    normalizeAddress(identity.wallet),
    identity.scope,
    identity.filterKey ?? '',
  ].join(':')
}

/**
 * Re-read a small overlap to tolerate delayed indexing and shallow chain
 * reorganizations. A changed checkpoint block hash forces a full rebuild.
 */
export function planEventHistoryScan(input: {
  deploymentBlock: bigint
  snapshotBlock: bigint
  checkpoint?: EventHistoryCheckpoint
  identity: EventHistoryIdentity
  observedCheckpointBlockHash?: string
  overlapBlocks?: bigint
}): EventHistoryScanPlan {
  const { deploymentBlock, snapshotBlock, checkpoint, identity } = input
  if (deploymentBlock < 0n || snapshotBlock < 0n) {
    throw new Error('Block numbers must be non-negative.')
  }
  if (deploymentBlock > snapshotBlock) {
    return { fromBlock: deploymentBlock, toBlock: snapshotBlock, mode: 'full' }
  }
  if (!checkpoint) {
    return { fromBlock: deploymentBlock, toBlock: snapshotBlock, mode: 'full' }
  }

  const sameIdentity =
    checkpoint.version === 1 &&
    checkpoint.chainId === identity.chainId &&
    normalizeAddress(checkpoint.contract) === normalizeAddress(identity.contract) &&
    normalizeAddress(checkpoint.wallet) === normalizeAddress(identity.wallet) &&
    checkpoint.scope === identity.scope &&
    (checkpoint.filterKey ?? '') === (identity.filterKey ?? '')

  if (!sameIdentity) {
    return { fromBlock: deploymentBlock, toBlock: snapshotBlock, mode: 'rebuild' }
  }

  if (
    !input.observedCheckpointBlockHash ||
    input.observedCheckpointBlockHash.toLowerCase() !== checkpoint.blockHash.toLowerCase()
  ) {
    return { fromBlock: deploymentBlock, toBlock: snapshotBlock, mode: 'rebuild' }
  }

  const overlap = input.overlapBlocks ?? DEFAULT_OVERLAP_BLOCKS
  if (overlap < 0n) throw new Error('Overlap must be non-negative.')
  const previousThrough = BigInt(checkpoint.throughBlock)
  const fromBlock = previousThrough + 1n > overlap
    ? previousThrough - overlap + 1n
    : deploymentBlock
  return {
    fromBlock: fromBlock < deploymentBlock ? deploymentBlock : fromBlock,
    toBlock: snapshotBlock,
    mode: 'incremental',
  }
}

/** Merge by canonical log identity and return stable chain order. */
export function mergeEventHistory<T extends EventHistoryItem>(...batches: readonly T[][]): T[] {
  const unique = new Map<string, T>()
  for (const batch of batches) {
    for (const item of batch) {
      if (!item.transactionHash || item.logIndex === null || item.logIndex === undefined) {
        throw new Error('Cannot cache an event without transaction hash and log index.')
      }
      const key = `${item.transactionHash.toLowerCase()}:${item.logIndex}`
      unique.set(key, item)
    }
  }
  return [...unique.values()].sort((a, b) => {
    const blockA = a.blockNumber ?? 0n
    const blockB = b.blockNumber ?? 0n
    if (blockA !== blockB) return blockA < blockB ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })
}

/** Construct a checkpoint only after the entire snapshot scan succeeded. */
export function advanceEventHistoryCheckpoint(input: {
  previous?: EventHistoryCheckpoint
  identity: EventHistoryIdentity
  throughBlock: bigint
  blockHash: string
  complete: boolean
}): EventHistoryCheckpoint {
  if (!input.complete) {
    throw new Error('Cannot advance event-history checkpoint after an incomplete scan.')
  }
  if (input.throughBlock < 0n || !/^0x[0-9a-f]{64}$/i.test(input.blockHash)) {
    throw new Error('A valid snapshot block and block hash are required.')
  }
  if (
    input.previous &&
    input.previous.chainId === input.identity.chainId &&
    normalizeAddress(input.previous.contract) === normalizeAddress(input.identity.contract) &&
    normalizeAddress(input.previous.wallet) === normalizeAddress(input.identity.wallet) &&
    input.previous.scope === input.identity.scope &&
    (input.previous.filterKey ?? '') === (input.identity.filterKey ?? '') &&
    input.throughBlock < BigInt(input.previous.throughBlock)
  ) {
    throw new Error('Event-history checkpoint cannot move backwards.')
  }
  return {
    version: 1,
    chainId: input.identity.chainId,
    contract: normalizeAddress(input.identity.contract),
    wallet: normalizeAddress(input.identity.wallet),
    scope: input.identity.scope,
    ...(input.identity.filterKey ? { filterKey: input.identity.filterKey } : {}),
    throughBlock: input.throughBlock.toString(),
    blockHash: input.blockHash.toLowerCase(),
  }
}

/** Serialize cached viem logs without losing bigint fields. */
export function serializeEventHistory<T>(events: readonly T[]): string {
  return JSON.stringify(events, (_key, value) =>
    typeof value === 'bigint' ? { __orvynnBigInt: value.toString() } : value,
  )
}

/** Parse cached logs and reject malformed or non-array payloads. */
export function parseEventHistory<T>(raw: string): T[] | undefined {
  try {
    const parsed: unknown = JSON.parse(raw, (_key, value) => {
      if (
        value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        typeof value.__orvynnBigInt === 'string' &&
        /^-?\d+$/.test(value.__orvynnBigInt)
      ) {
        return BigInt(value.__orvynnBigInt)
      }
      return value
    })
    return Array.isArray(parsed) ? parsed as T[] : undefined
  } catch {
    return undefined
  }
}
