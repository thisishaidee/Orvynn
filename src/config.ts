/**
 * wagmi configuration for Orvynn
 * Supported networks: Arc Mainnet (5042) and Arc Testnet (5042002)
 * Built with Arc Studio — https://studio.arc.io
 */

import { fallback, http } from 'viem'
import { createConfig } from 'wagmi'
import { arc, arcTestnet } from 'viem/chains'
import { coinbaseWallet, injected, walletConnect } from 'wagmi/connectors'
import { registerChain } from './tracing'
import { BRAND } from './lib/brand'

registerChain(arc.id, arc.rpcUrls.default.http[0])
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])

const arcMainnetTransport = fallback([
  http('https://rpc.arc-scan.org'),
  http(arc.rpcUrls.default.http[0]),
])

// Arc Testnet's public endpoint can reject even narrow eth_getLogs filters.
// Fail over across independently operated Arc-compatible endpoints instead
// of repeatedly asking the same RPC for a block it has already rejected.
const arcTestnetTransport = fallback([
  http('https://rpc.testnet.arc.io'),
  http('https://rpc.blockdaemon.testnet.arc.io'),
  http('https://rpc.drpc.testnet.arc.io'),
  http('https://rpc.quicknode.testnet.arc.io'),
])

const walletConnectProjectId = (import.meta.env as Record<string, string | undefined>).VITE_WALLETCONNECT_PROJECT_ID?.trim()

export const walletConnectEnabled = Boolean(walletConnectProjectId)

function getWalletMetadata() {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://orvynn.pages.dev'
  return {
    name: BRAND.name,
    description: BRAND.tagline,
    url: origin,
    // WalletConnect metadata should identify the real app icon, not publish an empty icon list.
    icons: [`${origin}/favicon.svg`],
  }
}

export const config = createConfig({
  multiInjectedProviderDiscovery: true,
  // Arc's RPC has rejected automatic Multicall aggregation for unrelated reads
  // (including nextLeaseId). Keep hook reads as direct eth_call requests; the
  // lease discovery path uses its own explicitly bounded multicall batches.
  batch: {
    [arc.id]: { multicall: false },
    [arcTestnet.id]: { multicall: false },
  },
  chains: [arc, arcTestnet],
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({
      appName: BRAND.name,
      preference: 'all',
    }),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: false,
            metadata: getWalletMetadata(),
          }),
        ]
      : []),
  ],
  transports: {
    [arc.id]: arcMainnetTransport,
    [arcTestnet.id]: arcTestnetTransport,
  },
  ssr: false,
})

export const SUPPORTED_CHAIN_IDS = [arc.id, arcTestnet.id] as const
export type SupportedChainId = (typeof SUPPORTED_CHAIN_IDS)[number]

export function isSupportedChain(chainId: number | undefined): chainId is SupportedChainId {
  return chainId !== undefined && SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId)
}
