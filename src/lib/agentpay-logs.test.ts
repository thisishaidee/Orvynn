import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeAbiParameters,
  encodeEventTopics,
  toEventSelector,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { agentPayAbi } from './agentpay-abi'
import { getActivityLogsChunked } from './agentpay-logs'

const address = '0x1111111111111111111111111111111111111111' as Address
const recipient = '0x2222222222222222222222222222222222222222' as Address
const spentEvent = agentPayAbi.find((item) => item.type === 'event' && item.name === 'Spent')!
const revokedEvent = agentPayAbi.find((item) => item.type === 'event' && item.name === 'Revoked')!

function topicForLease(id: bigint): Hex {
  return encodeAbiParameters([{ type: 'uint256' }], [id])
}

function mockClient(handler: (args: Record<string, unknown>) => Promise<unknown>) {
  const requests: Record<string, unknown>[] = []
  const client = {
    request: async ({ params }: { params: unknown[] }) => {
      const filter = params[0] as Record<string, unknown>
      requests.push(filter)
      return handler(filter)
    },
  } as unknown as PublicClient
  return { client, requests }
}

describe('getActivityLogsChunked', () => {
  it('combines event signatures and lease IDs into topic-OR filters and decodes logs', async () => {
    const spentTopics = encodeEventTopics({
      abi: [spentEvent],
      eventName: 'Spent',
      args: { leaseId: 7n, recipient },
    })
    const revokedTopics = encodeEventTopics({
      abi: [revokedEvent],
      eventName: 'Revoked',
      args: { leaseId: 8n },
    })
    const { client, requests } = mockClient(async () => [
      {
        data: encodeAbiParameters([{ type: 'uint256' }], [500n]),
        topics: spentTopics,
        blockNumber: '0x20',
        transactionHash: `0x${'a'.repeat(64)}`,
        logIndex: '0x2',
      },
      {
        data: '0x',
        topics: revokedTopics,
        blockNumber: '0x1f',
        transactionHash: `0x${'b'.repeat(64)}`,
        logIndex: '0x0',
      },
    ])

    const result = await getActivityLogsChunked(client, {
      address,
      events: [spentEvent, revokedEvent],
      leaseIds: [7n, 8n],
      fromBlock: 10n,
      toBlock: 40n,
    })

    assert.equal(requests.length, 1)
    assert.equal(requests[0].address, address)
    assert.equal(requests[0].fromBlock, '0xa')
    assert.equal(requests[0].toBlock, '0x28')

    const topics = requests[0].topics as Hex[][]
    assert.deepEqual(topics[0], [
      toEventSelector(spentEvent).toLowerCase(),
      toEventSelector(revokedEvent).toLowerCase(),
    ])
    assert.deepEqual(topics[1], [topicForLease(7n), topicForLease(8n)])

    assert.deepEqual(result.map((item) => item.eventName), ['Revoked', 'Spent'])
    assert.equal(result[0].args.leaseId, 8n)
    assert.equal(result[1].args.leaseId, 7n)
    assert.equal(result[1].args.recipient, recipient)
    assert.equal(result[1].args.amount, 500n)
    assert.equal(result[1].blockNumber, 32n)
    assert.equal(result[1].logIndex, 2)
  })

  it('splits lease IDs into bounded batches of at most 100 topics', async () => {
    const { client, requests } = mockClient(async () => [])
    const leaseIds = Array.from({ length: 101 }, (_, index) => BigInt(index + 1))

    const result = await getActivityLogsChunked(client, {
      address,
      events: [revokedEvent],
      leaseIds,
      fromBlock: 10n,
      toBlock: 10n,
    })

    assert.deepEqual(result, [])
    assert.equal(requests.length, 2)
    const firstTopics = requests[0].topics as Hex[][]
    const secondTopics = requests[1].topics as Hex[][]
    assert.equal(firstTopics[1].length, 100)
    assert.equal(secondTopics[1].length, 1)
    assert.deepEqual(secondTopics[1], [topicForLease(101n)])
  })

  it('returns an empty result without making RPC calls for empty filters', async () => {
    const { client, requests } = mockClient(async () => {
      throw new Error('RPC should not be called')
    })

    assert.deepEqual(await getActivityLogsChunked(client, {
      address,
      events: [revokedEvent],
      leaseIds: [],
      fromBlock: 10n,
      toBlock: 20n,
    }), [])
    assert.equal(requests.length, 0)
  })

  it('rejects an unknown event signature instead of silently dropping it', async () => {
    const { client } = mockClient(async () => [{
      data: '0x',
      topics: [`0x${'ff'.repeat(32)}` as Hex, topicForLease(7n)],
      blockNumber: '0x10',
      transactionHash: `0x${'c'.repeat(64)}`,
      logIndex: '0x0',
    }])

    await assert.rejects(getActivityLogsChunked(client, {
      address,
      events: [revokedEvent],
      leaseIds: [7n],
      fromBlock: 10n,
      toBlock: 20n,
    }), /unknown AgentPay event signature/)
  })
})
