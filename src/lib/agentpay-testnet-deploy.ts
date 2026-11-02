export const ARC_TESTNET_CHAIN_ID = 5042002
export const ARC_TESTNET_RPC = 'https://rpc.testnet.arc.io'
export const ARC_TESTNET_USDC = '0x3600000000000000000000000000000000000000' as const
export const TESTNET_DEPLOYMENT_STORAGE_KEY = 'orvynn.arc-testnet-deployment.verified.v1'

export type TestnetDeployPhase = 'review' | 'signing' | 'pending' | 'deployed' | 'failed'
export type SavedTestnetDeployment = {
  v: 1
  chainId: typeof ARC_TESTNET_CHAIN_ID
  txHash: `0x${string}`
  contractAddress: `0x${string}`
  deployer: `0x${string}`
  savedAt: number
}

const HASH = /^0x[0-9a-fA-F]{64}$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/

/** Strictly parse the public deployment receipt saved by this browser. */
export function parseSavedTestnetDeployment(raw: string | null | undefined): SavedTestnetDeployment | undefined {
  if (!raw) return undefined
  let value: unknown
  try { value = JSON.parse(raw) } catch { return undefined }
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  if (item.v !== 1 || item.chainId !== ARC_TESTNET_CHAIN_ID) return undefined
  if (typeof item.txHash !== 'string' || !HASH.test(item.txHash)) return undefined
  if (typeof item.contractAddress !== 'string' || !ADDRESS.test(item.contractAddress)) return undefined
  if (typeof item.deployer !== 'string' || !ADDRESS.test(item.deployer)) return undefined
  if (typeof item.savedAt !== 'number' || !Number.isFinite(item.savedAt)) return undefined
  return {
    v: 1,
    chainId: ARC_TESTNET_CHAIN_ID,
    txHash: item.txHash as `0x${string}`,
    contractAddress: item.contractAddress as `0x${string}`,
    deployer: item.deployer as `0x${string}`,
    savedAt: item.savedAt,
  }
}

/** Explicit allow-list prevents accidental persistence of wallet or secret data. */
export function serializeSavedTestnetDeployment(value: SavedTestnetDeployment): string {
  return JSON.stringify({
    v: 1,
    chainId: ARC_TESTNET_CHAIN_ID,
    txHash: value.txHash,
    contractAddress: value.contractAddress,
    deployer: value.deployer,
    savedAt: value.savedAt,
  })
}

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
