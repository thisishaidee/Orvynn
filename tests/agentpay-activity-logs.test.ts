import { describe, expect, test } from 'bun:test'
import {
  encodeAbiParameters,
  toEventSelector,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { agentPayAbi } from '../src/lib/agentpay-abi'
import { getActivityLogsChunked } from '../src/lib/agentpay-logs'

const LEASE_ID = 7n
const ADDRESS = '0x1111111111111111111111111111111111111111' as Address

function sampleValue(type: string): bigint | Address | boolean {
  if (type === 'uint256') return LEASE_ID
  if (type === 'address') return ADDRESS
  if (type === 'bool') return true
  throw new Error(`Unexpected fixture ABI type: ${type}`)
}

describe('combined AgentPay activity decoding', () => {
  test('decodes every supported event type from the combined indexed filter', async () => {
    const events = agentPayAbi.filter(
      (item): item is Extract<(typeof agentPayAbi)[number], { type: 'event' }> => item.type === 'event',
    )
    const requests: Array<Record<string, unknown>> = []
    const txHash = `0x${'ab'.repeat(32)}` as Hex

    const rawLogs = events.map((event, index) => {
      const indexed = event.inputs.filter((input) => input.indexed)
      const nonIndexed = event.inputs.filter((input) => !input.indexed)
      const topics = [
        toEventSelector(event),
        ...indexed.map((input) =>
          encodeAbiParameters([{ type: input.type }], [sampleValue(input.type)] as never),
        ),
      ]
      const data = nonIndexed.length > 0
        ? encodeAbiParameters(
            nonIndexed.map((input) => ({ type: input.type })),
            nonIndexed.map((input) => sampleValue(input.type)) as never,
          )
        : '0x'

      return {
        data,
        topics,
        blockNumber: '0xa',
        transactionHash: txHash,
        logIndex: `0x${index.toString(16)}`,
      }
    })

    const client = {
      request: async (request: Record<string, unknown>) => {
        requests.push(request)
        return rawLogs
      },
    } as unknown as PublicClient

    const result = await getActivityLogsChunked(client, {
      address: '0x0000000000000000000000000000000000000001' as Address,
      events,
      leaseIds: [LEASE_ID],
      fromBlock: 10n,
      toBlock: 20n,
    })

    expect(requests).toHaveLength(1)
    const filter = (requests[0].params as Array<Record<string, unknown>>)[0]
    const topics = filter.topics as Hex[][]
    expect(topics[0]).toHaveLength(6)
    expect(topics[1]).toHaveLength(1)
    expect(result.map((log) => log.eventName).sort()).toEqual(
      events.map((event) => event.name).sort(),
    )
    expect(result.every((log) => log.args.leaseId === LEASE_ID)).toBe(true)
    expect(result.map((log) => log.logIndex)).toEqual([0, 1, 2, 3, 4, 5])
  })
})
