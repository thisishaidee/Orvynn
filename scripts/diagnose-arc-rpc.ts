import { createPublicClient, http, defineChain } from 'viem'
import { agentPayAbi } from '../src/lib/agentpay-abi'

const contract = '0xA549B60313A86288d46323e5723AAa4c0fAA6363'
const leaseId = 12n

const networks = [
  {
    name: 'Arc Testnet',
    chain: defineChain({
      id: 5042002,
      name: 'Arc Testnet',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.testnet.arc.io'] } },
    }),
    endpoints: [
      'https://rpc.testnet.arc.io',
      'https://rpc.blockdaemon.testnet.arc.io',
      'https://rpc.drpc.testnet.arc.io',
      'https://rpc.quicknode.testnet.arc.io',
      'https://arc-testnet.drpc.org',
    ],
  },
  {
    name: 'Arc Mainnet',
    chain: defineChain({
      id: 5042,
      name: 'Arc',
      nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
      rpcUrls: { default: { http: ['https://rpc.arc-scan.org'] } },
    }),
    endpoints: ['https://rpc.arc-scan.org', 'https://rpc.mainnet.arc.io'],
  },
]

for (const network of networks) {
  for (const endpoint of network.endpoints) {
    const client = createPublicClient({
      chain: network.chain,
      transport: http(endpoint, { timeout: 15000, retryCount: 0 }),
    })
    try {
      const chainId = await client.getChainId()
      if (chainId !== network.chain.id) {
        console.log(JSON.stringify({ network: network.name, endpoint, ok: false, chainId, expectedChainId: network.chain.id, error: 'Wrong chain ID' }))
        continue
      }
      const blockNumber = await client.getBlockNumber()
      const nextLeaseId = await client.readContract({
        address: contract,
        abi: agentPayAbi,
        functionName: 'nextLeaseId',
        blockNumber,
      })
      const result: Record<string, unknown> = {
        network: network.name,
        endpoint,
        ok: true,
        chainId,
        blockNumber: blockNumber.toString(),
        nextLeaseId: nextLeaseId.toString(),
      }
      if (nextLeaseId > leaseId) {
        const [lease, remaining] = await Promise.all([
          client.readContract({ address: contract, abi: agentPayAbi, functionName: 'leases', args: [leaseId], blockNumber }),
          client.readContract({ address: contract, abi: agentPayAbi, functionName: 'remainingAllowance', args: [leaseId], blockNumber }),
        ])
        result.lease12 = {
          owner: lease[0],
          delegate: lease[1],
          cap: lease[2].toString(),
          periodSeconds: lease[3].toString(),
          expiry: lease[4].toString(),
          windowStart: lease[5].toString(),
          lastWindowIndex: lease[6].toString(),
          spentThisWindow: lease[7].toString(),
          balance: lease[8].toString(),
          allowlistEnabled: lease[9],
          revoked: lease[10],
          remainingAllowance: remaining.toString(),
          ownerMatchesReportedWallet: lease[0].toLowerCase() === '0x02a954017a71615af0c202406bede d250901ad8ba'.replaceAll(' ', ''),
        }
      }
      console.log(JSON.stringify(result))
    } catch (error) {
      console.log(JSON.stringify({
        network: network.name,
        endpoint,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }
}
