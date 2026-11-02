/**
 * Bounded, adaptive event-log retrieval.
 *
 * Arc RPC can reject large eth_getLogs ranges. Fetch ranges concurrently,
 * split rejected ranges, and return results only when the complete snapshot
 * has been retrieved. A failed sub-range never becomes a partial success.
 */
import type { Address, PublicClient } from 'viem'
import { agentPayAbi } from '@/lib/agentpay-abi'

const INITIAL_CHUNK = 10_000n
const MIN_CHUNK = 1n
const MAX_RANGES = 10_000
const CONCURRENCY = 4

export type LogQuery = {
  address: Address
  event: (typeof agentPayAbi)[number]
  args?: Record<string, unknown>
  fromBlock: bigint
  /** Pin related event queries to one consistent chain snapshot. */
  toBlock?: bigint
}

export async function getLogsChunked(client: PublicClient, params: LogQuery) {
  const { fromBlock: startBlock, toBlock, ...query } = params
  const latest = toBlock ?? await client.getBlockNumber()
  if (startBlock > latest) return []

  const ranges: Array<{ from: bigint; to: bigint }> = []
  for (let from = startBlock; from <= latest;) {
    const to = from + INITIAL_CHUNK - 1n > latest ? latest : from + INITIAL_CHUNK - 1n
    ranges.push({ from, to })
    from = to + 1n
  }
  if (ranges.length > MAX_RANGES) {
    throw new Error(`Event history requires ${ranges.length} ranges, exceeding the safety limit of ${MAX_RANGES}.`)
  }

  let completedRanges = 0
  const fetchRange = async (from: bigint, to: bigint): Promise<Awaited<ReturnType<typeof client.getLogs>>> => {
    if (completedRanges >= MAX_RANGES) {
      throw new Error('Event history exceeded the maximum number of RPC ranges.')
    }
    try {
      const logs = await client.getLogs({ ...query, fromBlock: from, toBlock: to } as never)
      completedRanges += 1
      return logs
    } catch (error) {
      if (to - from + 1n <= MIN_CHUNK) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Arc RPC could not return event history at block ${from}. ${detail}`)
      }
      const midpoint = from + (to - from) / 2n
      // Keep fallback splits sequential so a struggling RPC is not flooded
      // with an unbounded tree of smaller requests.
      const left = await fetchRange(from, midpoint)
      const right = await fetchRange(midpoint + 1n, to)
      return [...left, ...right]
    }
  }

  const results: Awaited<ReturnType<typeof client.getLogs>>[] = []
  for (let i = 0; i < ranges.length; i += CONCURRENCY) {
    const batch = ranges.slice(i, i + CONCURRENCY)
    const fetched = await Promise.all(batch.map(({ from, to }) => fetchRange(from, to)))
    results.push(...fetched)
  }

  return results.flat().sort((a, b) => {
    const blockOrder = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })
}
