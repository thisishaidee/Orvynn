/** Verified AgentPay deployment blocks for supported Arc networks. */
const MAINNET_DEPLOYMENT_BLOCK = 28_888_842n
const TESTNET_DEPLOYMENT_BLOCK = 70_433_685n

export function getAgentPayEventStartBlock(chainId: number): bigint {
  if (chainId === 5042) return MAINNET_DEPLOYMENT_BLOCK
  if (chainId === 5042002) return TESTNET_DEPLOYMENT_BLOCK
  throw new Error(`No verified AgentPay event start block is configured for chain ${chainId}. Refusing to scan from genesis.`)
}
