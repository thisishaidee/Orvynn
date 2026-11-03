/**
 * Bounded, adaptive event-log retrieval.
 *
 * Arc RPC may reject large eth_getLogs ranges or bursts of requests. Fetch
 * independent ranges with bounded concurrency, split rejected ranges, and
 * return results only when the complete requested history has been retrieved.
 * A failed sub-range is never silently treated as an empty result.
 */
import {
  decodeEventLog,
  encodeAbiParameters,
  toEventSelector,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { agentPayAbi } from '@/lib/agentpay-abi'

const INITIAL_CHUNK = 5_000n
const MIN_CHUNK = 1n
const MAX_RPC_REQUESTS = 10_000
const CONCURRENCY = 1
const MAX_RATE_LIMIT_RETRIES = 4
const RATE_LIMIT_RETRY_BASE_MS = 750
const MAX_LEASE_IDS_PER_QUERY = 100

type AgentPayEvent = Extract<(typeof agentPayAbi)[number], { type: 'event' }>

export type LogQuery = {
  address: Address
  event: (typeof agentPayAbi)[number]
  args?: Record<string, unknown>
  fromBlock: bigint
  /** Pin related reads to the same chain snapshot when supplied. */
  toBlock?: bigint
}

export type ActivityLogQuery = {
  address: Address
  events: readonly AgentPayEvent[]
  leaseIds: readonly bigint[]
  fromBlock: bigint
  toBlock: bigint
}

type DecodedActivityLog = {
  args: Record<string, unknown>
  eventName: string
  blockNumber: bigint | null
  transactionHash: Hex | null
  logIndex: number | null
}

type RawRpcLog = {
  data: Hex
  topics: Hex[]
  blockNumber?: Hex | null
  transactionHash?: Hex | null
  logIndex?: Hex | null
}

/**
 * Split requests only for explicit query/range limits. Rate limits receive a
 * small bounded exponential-backoff retry on the same range; timeouts and
 * transport failures fail fast rather than multiplying RPC traffic.
 */
export function isRangeLimitError(error: unknown): boolean {
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
  // Providers reuse JSON-RPC -32005 for throttling as well as query limits.
  // Never recursively split a rate-limited request: that multiplies traffic.
  if (/rate limit|too many requests|429|throttl/.test(detail)) return false
  return (
    /block range|range (is )?too (large|wide)|too many results|query returned more than|response size|result set too large|exceeds? (the )?(maximum|max) (block )?range|maximum block range/.test(detail)
    || /(?:^|\s)413(?:\s|$)/.test(detail)
  )
}

/** Detect provider throttling separately from query-range limits. */
export function isRateLimitError(error: unknown): boolean {
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

  return /rate limit|too many requests|429|throttl/.test(parts.join(' ').toLowerCase())
}

/** Fetch complete block ranges with one shared safety budget and stable ordering. */
async function fetchChunkedRanges<T>(
  startBlock: bigint,
  latest: bigint,
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
): Promise<T[]> {
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
  const fetchAdaptive = async (from: bigint, to: bigint, retry = 0): Promise<T[]> => {
    if (requests >= MAX_RPC_REQUESTS) {
      throw new Error('Incomplete event history: exceeded the maximum number of RPC requests.')
    }
    requests += 1

    try {
      return await fetchRange(from, to)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      if (isRateLimitError(error) && retry < MAX_RATE_LIMIT_RETRIES) {
        // Retry the identical bounded query with exponential backoff. Do not
        // split a throttled query: doing so creates more requests and worsens
        // provider pressure.
        const delayMs = RATE_LIMIT_RETRY_BASE_MS * (2 ** retry)
        await new Promise((resolve) => setTimeout(resolve, delayMs))
        return fetchAdaptive(from, to, retry + 1)
      }
      if (!isRangeLimitError(error)) {
        throw new Error(`Arc RPC failed while reading event history at blocks ${from}-${to}. ${detail}`)
      }
      if (to - from + 1n <= MIN_CHUNK) {
        throw new Error(`Arc RPC could not return event history at block ${from}. ${detail}`)
      }

      const midpoint = from + (to - from) / 2n
      // Retry rejected ranges sequentially to avoid increasing pressure on an
      // RPC endpoint that has already rejected the larger request.
      const left = await fetchAdaptive(from, midpoint)
      const right = await fetchAdaptive(midpoint + 1n, to)
      return [...left, ...right]
    }
  }

  const results: T[][] = []
  for (let offset = 0; offset < ranges.length; offset += CONCURRENCY) {
    const batch = ranges.slice(offset, offset + CONCURRENCY)
    const fetched = await Promise.all(batch.map(({ from, to }) => fetchAdaptive(from, to)))
    results.push(...fetched)
  }
  return results.flat()
}

export async function getLogsChunked(client: PublicClient, params: LogQuery) {
  const { fromBlock: startBlock, toBlock, ...query } = params
  const latest = toBlock ?? await client.getBlockNumber()
  const logs = await fetchChunkedRanges(
    startBlock,
    latest,
    async (from, to) => client.getLogs({ ...query, fromBlock: from, toBlock: to } as never),
  )

  return logs.sort((a, b) => {
    const blockOrder = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })
}

/**
 * Read all AgentPay activity event types in one eth_getLogs filter.
 * Every AgentPay event indexes leaseId in topic position 1, so JSON-RPC's
 * topic-OR filters can combine event signatures and lease IDs without
 * downloading events belonging to other leases.
 */
export async function getActivityLogsChunked(
  client: PublicClient,
  params: ActivityLogQuery,
): Promise<DecodedActivityLog[]> {
  const { address, events, leaseIds, fromBlock, toBlock } = params
  if (leaseIds.length === 0 || events.length === 0 || fromBlock > toBlock) return []

  const eventByTopic = new Map(
    events.map((event) => [toEventSelector(event).toLowerCase(), event] as const),
  )
  const eventTopics = [...eventByTopic.keys()] as Hex[]
  const decoded: DecodedActivityLog[] = []

  // Bound topic-list size for providers with conservative eth_getLogs limits.
  for (let offset = 0; offset < leaseIds.length; offset += MAX_LEASE_IDS_PER_QUERY) {
    const leaseIdTopics = leaseIds
      .slice(offset, offset + MAX_LEASE_IDS_PER_QUERY)
      .map((id) => encodeAbiParameters([{ type: 'uint256' }], [id]))

    const batch = await fetchChunkedRanges(
      fromBlock,
      toBlock,
      async (from, to) => {
        const rawLogs = await client.request({
          method: 'eth_getLogs',
          params: [{
            address,
            fromBlock: toHex(from),
            toBlock: toHex(to),
            topics: [eventTopics, leaseIdTopics],
          }],
        } as never) as RawRpcLog[]

        return rawLogs.map((raw) => {
          const topic0 = raw.topics[0]?.toLowerCase()
          const event = topic0 ? eventByTopic.get(topic0) : undefined
          if (!event) throw new Error('Arc RPC returned an unknown AgentPay event signature.')

          const result = decodeEventLog({
            abi: [event],
            data: raw.data,
            topics: raw.topics,
            strict: true,
          } as never) as { eventName: string; args: Record<string, unknown> }

          return {
            args: result.args,
            eventName: result.eventName,
            blockNumber: raw.blockNumber ? BigInt(raw.blockNumber) : null,
            transactionHash: raw.transactionHash ?? null,
            logIndex: raw.logIndex != null ? Number(BigInt(raw.logIndex)) : null,
          }
        })
      },
    )
    decoded.push(...batch)
  }

  return decoded.sort((a, b) => {
    const blockOrder = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
    return (a.logIndex ?? 0) - (b.logIndex ?? 0)
  })
}
