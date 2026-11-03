import {
  createPublicClient,
  erc20Abi,
  fallback,
  http,
  type Address,
} from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { agentPayAbi } from '../src/lib/agentpay-abi'
import { getActivityLogsChunked } from '../src/lib/agentpay-logs'

const MAINNET_AGENTPAY = '0xA549B60313A86288d46323e5723AAa4c0fAA6363' as Address
const ARC_USDC = '0x3600000000000000000000000000000000000000' as Address

async function verifyMainnetActivityRead() {
  const client = createPublicClient({
    chain: arc,
    transport: fallback([
      http('https://rpc.arc-scan.org'),
      http(arc.rpcUrls.default.http[0]),
    ]),
  })

  const chainId = await client.getChainId()
  if (chainId !== 5042) throw new Error(`Arc mainnet RPC returned chain ID ${chainId}, expected 5042.`)

  const code = await client.getBytecode({ address: MAINNET_AGENTPAY })
  if (!code || code === '0x') throw new Error('Configured AgentPay mainnet address has no contract bytecode.')

  const latest = await client.getBlockNumber()
  const fromBlock = latest > 10_000n ? latest - 10_000n : 0n
  const events = agentPayAbi.filter(
    (item): item is Extract<(typeof agentPayAbi)[number], { type: 'event' }> => item.type === 'event',
  )

  // Read-only integration smoke test of the exact combined topic-OR query used
  // by Activity. A small recent window avoids imposing an archive-wide scan on CI.
  const logs = await getActivityLogsChunked(client, {
    address: MAINNET_AGENTPAY,
    events,
    leaseIds: [1n, 2n, 3n],
    fromBlock,
    toBlock: latest,
  })

  console.log(
    `Arc mainnet read-only check passed: chain=${chainId}, contract bytecode present, ${logs.length} matching Activity logs in blocks ${fromBlock}-${latest}.`,
  )
}

async function verifyTestnetUsdcRead() {
  const client = createPublicClient({
    chain: arcTestnet,
    transport: fallback(arcTestnet.rpcUrls.default.http.map((url) => http(url))),
  })

  const chainId = await client.getChainId()
  if (chainId !== 5042002) throw new Error(`Arc testnet RPC returned chain ID ${chainId}, expected 5042002.`)

  const [code, decimals] = await Promise.all([
    client.getBytecode({ address: ARC_USDC }),
    client.readContract({ address: ARC_USDC, abi: erc20Abi, functionName: 'decimals' }),
  ])
  if (!code || code === '0x') throw new Error('Arc testnet USDC contract bytecode is missing.')
  if (decimals !== 6) throw new Error(`Arc testnet USDC decimals are ${decimals}, expected 6.`)

  console.log(
    `Arc testnet read-only check passed: chain=${chainId}, USDC bytecode present, ERC-20 decimals=${decimals}. AgentPay testnet deployment is checked separately.`,
  )
}

await verifyMainnetActivityRead()
await verifyTestnetUsdcRead()
