import { erc20Abi, formatUnits } from 'viem'
import { arc, arcTestnet } from 'viem/chains'
import { useAccount, useChains, useReadContract } from 'wagmi'
import { isSupportedChain } from '@/config'

/** USDC ERC-20 interface on Arc (6 decimals). Source: https://docs.arc.io/arc/references/contract-addresses.md */
export const ARC_USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const

export interface NetworkInfo {
  /** Chain ID the wallet reports, when connected. */
  chainId?: number
  label: string
  /** True when this app is configured to talk to the chain. */
  supported: boolean
}

/** The network the connected wallet is on, described honestly. Reads wallet state only. */
export function useNetworkInfo(): NetworkInfo {
  const { isConnected, chainId } = useAccount()
  const configured = useChains()

  if (!isConnected || chainId === undefined) return { label: 'No wallet connected', supported: false }
  if (chainId === arc.id) return { chainId, label: 'Arc Mainnet', supported: true }
  if (chainId === arcTestnet.id) return { chainId, label: 'Arc Testnet', supported: true }
  const match = configured.find((c) => c.id === chainId)
  if (match) return { chainId, label: match.name, supported: false }
  return { chainId, label: `Chain ${chainId} (not supported by this app)`, supported: false }
}

export type BalanceState = 'disconnected' | 'unsupported-network' | 'loading' | 'error' | 'ready'

/**
 * Real USDC balance via an on-chain `balanceOf` call to the USDC contract on the connected Arc network.
 * Returns a state, never a placeholder number.
 */
export function useUsdcBalance(): { state: BalanceState; formatted?: string; refetch: () => void } {
  const { address, chainId, isConnected } = useAccount()
  const onArc = isSupportedChain(chainId)
  const enabled = Boolean(address) && onArc

  const { data, isPending, isError, refetch } = useReadContract({
    address: ARC_USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: onArc ? chainId : arcTestnet.id,
    query: { enabled, staleTime: 15_000, gcTime: 5 * 60_000, retry: 1 },
  })

  if (!isConnected || !address) return { state: 'disconnected', refetch: () => void refetch() }
  if (!onArc) return { state: 'unsupported-network', refetch: () => void refetch() }
  if (isError) return { state: 'error', refetch: () => void refetch() }
  if (isPending || data === undefined) return { state: 'loading', refetch: () => void refetch() }
  const [whole, fraction = ''] = formatUnits(data, 6).split('.')
  return { state: 'ready', formatted: `${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`, refetch: () => void refetch() }
}
