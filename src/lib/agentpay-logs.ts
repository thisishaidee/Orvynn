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

/**
 * Only split requests when the provider explicitly signals a query/range limit.
 * Rate limits, timeouts and transport failures must fail fast so recursive
 * splitting does not amplify pressure on an already unhealthy RPC endpoint.
 */
function isRangeLimitError(error: unknown): boolean {
  const seen = new Set<unknown>()
  const parts: string[] = []
  const pending: unknown[] = [error]

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === null || current === undefined || seen.has(current)) continue
    if (typeof current === 'string') {
      parts.push(current)
      continue
    }
    if (typeof current !== 'object') continue
    seen.add(current)

    const value = current as Record<string, unknown>
    for (const key of ['message', 'shortMessage', 'details', 'code', 'status', 'statusCode']) {
      const item = value[key]
      if (typeof item === 'string' || typeof item === 'number') parts.push(String(item))
    }
    for (const key of ['cause', 'error', 'data']) {
      if (value[key] && typeof value[key] === 'object') pending.push(value[key])
    }
  }

  const detail = parts.join(' ').toLowerCase()
  return (
    /block range|range (is )?too (large|wide)|too many results|query returned more than|response size|result set too large|exceeds? (the )?(maximum|max) (block )?range|maximum block range/.test(detail)
    || /(?:^|\\s)413(?:\\s|$)/.test(detail)
    || /(?:^|\\s)-32005(?:\\s|$)/.test(detail)
  )
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
      const detail = error instanceof Error ? error.message : String(error)
      if (!isRangeLimitError(error)) {
        throw new Error(`Arc RPC failed while reading event history at blocks ${from}-${to}. ${detail}`)
      }
      if (to - from + 1n <= MIN_CHUNK) {
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
