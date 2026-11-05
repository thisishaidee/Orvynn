/**
 * Short-lived, client-scoped block timestamp cache.
 *
 * Activity refetches often revisit the same blocks. Reuse recent timestamps
 * and deduplicate concurrent reads without persisting data across chains or
 * treating failed block reads as valid timestamps.
 */
import type { PublicClient } from 'viem'

const CACHE_TTL_MS = 60 * 60 * 1_000
const MAX_CACHE_ENTRIES = 5_000
const caches = new WeakMap<PublicClient, Map<string, { timestamp: number; expiresAt: number }>>()
const inFlight = new WeakMap<PublicClient, Map<string, Promise<number | undefined>>>()

function cacheFor(client: PublicClient) {
  let cache = caches.get(client)
  if (!cache) {
    cache = new Map()
    caches.set(client, cache)
  }
  return cache
}

function pendingFor(client: PublicClient) {
  let pending = inFlight.get(client)
  if (!pending) {
    pending = new Map()
    inFlight.set(client, pending)
  }
  return pending
}

async function readTimestamp(client: PublicClient, blockNumber: string): Promise<number | undefined> {
  const cache = cacheFor(client)
  const cached = cache.get(blockNumber)
  if (cached && cached.expiresAt > Date.now()) return cached.timestamp
  if (cached) cache.delete(blockNumber)

  const pending = pendingFor(client)
  const existing = pending.get(blockNumber)
  if (existing) return existing

  const request = client.getBlock({ blockNumber: BigInt(blockNumber) })
    .then((block) => {
      const timestamp = Number(block.timestamp)
      cache.set(blockNumber, { timestamp, expiresAt: Date.now() + CACHE_TTL_MS })
      while (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest === undefined) break
        cache.delete(oldest)
      }
      return timestamp
    })
    .catch(() => undefined)
    .finally(() => pending.delete(blockNumber))

  pending.set(blockNumber, request)
  return request
}

/** Returns only timestamps successfully read from the RPC. */
export async function getBlockTimestamps(
  client: PublicClient,
  blocks: bigint[],
): Promise<Map<string, number>> {
  const unique = [...new Set(blocks.map((block) => block.toString()))]
  const result = new Map<string, number>()
  const concurrency = 12

  for (let offset = 0; offset < unique.length; offset += concurrency) {
    const batch = unique.slice(offset, offset + concurrency)
    const timestamps = await Promise.all(batch.map((blockNumber) => readTimestamp(client, blockNumber)))
    batch.forEach((blockNumber, index) => {
      const timestamp = timestamps[index]
      if (timestamp !== undefined) result.set(blockNumber, timestamp)
    })
  }

  return result
}
