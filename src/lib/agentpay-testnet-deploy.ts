export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.io'
export const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000' as const

export type TestnetDeployPhase = 'review' | 'signing' | 'pending' | 'deployed' | 'failed'

export function canStartTestnetDeployment(input: {
  phase: TestnetDeployPhase
  account?: string
  chainId?: number
  usdcVerified: boolean
  gasEstimate?: bigint
}): boolean {
  return input.phase === 'review'
    && Boolean(input.account)
    && input.chainId === ARC_TESTNET_CHAIN_ID
    && input.usdcVerified
    && input.gasEstimate !== undefined
    && input.gasEstimate > 0n
    && input.gasEstimate <= 2_500_000n
}
