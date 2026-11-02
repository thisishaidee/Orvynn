/**
 * Adaptive event-log retrieval starting at the contract's deployment block.
 * Arc's public RPC can reject large eth_getLogs ranges or bursts of requests.
 * Shrink rejected ranges and never return partial history as complete.
 */
import type { Address, PublicClient } from 'viem'
import { agentPayAbi } from '@/lib/agentpay-abi'

const INITIAL_CHUNK = 50_000n
const MIN_CHUNK = 1n
const MAX_CHUNKS = 10_000

export type LogQuery = {
  address: Address
  event?: (typeof agentPayAbi)[number]
  args?: Record<string, unknown>
  fromBlock: bigint
}

export async function getLogsChunked(client: PublicClient, params: LogQuery) {
  const { fromBlock: startBlock, ...query } = params
  const latest = await client.getBlockNumber()
  if (startBlock > latest) return []

  const logs: Awaited<ReturnType<typeof client.getLogs>> = []
  let from = startBlock
  let chunkSize = INITIAL_CHUNK
  let chunks = 0

  while (from <= latest && chunks < MAX_CHUNKS) {
    const to = from + chunkSize - 1n > latest ? latest : from + chunkSize - 1n
    try {
      const batch = await client.getLogs({ ...query, fromBlock: from, toBlock: to } as never)
      logs.push(...batch)
      chunks += 1
      if (to === latest) return logs
      from = to + 1n
      // Gradually restore the preferred range after a smaller request succeeds.
      if (chunkSize < INITIAL_CHUNK) chunkSize = chunkSize * 2n > INITIAL_CHUNK ? INITIAL_CHUNK : chunkSize * 2n
    } catch (error) {
      if (chunkSize === MIN_CHUNK) {
        const detail = error instanceof Error ? error.message : String(error)
        throw new Error(`Arc RPC could not return event history at block ${from}. ${detail}`)
      }
      chunkSize = chunkSize / 2n < MIN_CHUNK ? MIN_CHUNK : chunkSize / 2n
    }
  }

  throw new Error(
    `Incomplete event history: stopped after ${chunks} ranges before block ${latest}. Results were not treated as complete.`,
  )
}
