/**
 * Bounded, adaptive event-log retrieval.
 *
 * Arc RPC may reject large eth_getLogs ranges or bursts of requests. Fetch
 * independent ranges with bounded concurrency, split rejected ranges, and
 * return results only when the complete requested history has been retrieved.
 * A failed sub-range is never silently treated as an empty result.
 */
import type { Address, PublicClient } from 'viem'
import { agentPayAbi } from '@/lib/agentpay-abi'

const INITIAL_CHUNK = 50_000n
const MIN_CHUNK = 1n
const MAX_RPC_REQUESTS = 10_000
const CONCURRENCY = 4

export type LogQuery = {
  address: Address
  event: (typeof agentPayAbi)[number]
  args?: Record<string, unknown>
  fromBlock: bigint
  /** Pin related reads to the same chain snapshot when supplied. */
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
  if (ranges.length > MAX_RPC_REQUESTS) {
    throw new Error(
      `Incomplete event history: requires ${ranges.length} ranges, exceeding the safety limit of ${MAX_RPC_REQUESTS}.`,
    )
  }

  let requests = 0
  const fetchRange = async (from: bigint, to: bigint): Promise<Awaited<ReturnType<typeof client.getLogs>>> => {
    if (requests >= MAX_RPC_REQUESTS) {
      throw new Error('Incomplete event history: exceeded the maximum number of RPC requests.')
    }
    requests += 1

    try {
      return await client.getLogs({ ...query, fromBlock: from, toBlock: to } as never)
    } catch (error) {
      if (to - from + 1n <= MIN_CHUNK) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Arc RPC could not return event history at block ${from}. ${detail}`)
      }

      const midpoint = from + (to - from) / 2n
      // Retry rejected ranges sequentially to avoid increasing pressure on an
      // RPC endpoint that has already rejected the larger request.
      const left = await fetchRange(from, midpoint)
      const right = await fetchRange(midpoint + 1n, to)
      return [...left, ...right]
    }
  }

  const results: Awaited<ReturnType<typeof client.getLogs>>[] = []
  for (let offset = 0; offset < ranges.length; offset += CONCURRENCY) {
    const batch = ranges.slice(offset, offset + CONCURRENCY)
    const fetched = await Promise.all(batch.map(({ from, to }) => fetchRange(from, to)))
    results.push(...fetched)
  }

  return results.flat().sort((a, b) => {
    const blockOrder = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })
}
