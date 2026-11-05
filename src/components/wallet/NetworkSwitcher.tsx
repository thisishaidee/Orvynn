import { useEffect } from 'react'
import { ExternalLink } from 'lucide-react'
import { useSwitchChain, useAccount } from 'wagmi'
import { arc, arcTestnet } from 'viem/chains'
import { Button } from '@/components/ui'
import { isSupportedChain } from '@/config'
import { useNetworkInfo } from '@/lib/wallet'

const ARC_TESTNET_FAUCET_URL = 'https://faucet.circle.com'

function describeSwitchError(error: Error): string {
  const text = error.message.toLowerCase()
  if (/reject|denied|user rejected|user denied/.test(text)) {
    return 'Network switch was rejected by the wallet. Nothing changed.'
  }
  if (text.includes('already pending') || text.includes('already processing')) {
    return 'Your wallet already has a network request open. Open the wallet and approve or dismiss it, then try again.'
  }
  if (text.includes('4902') || text.includes('unrecognized chain') || text.includes('not added')) {
    return 'This network is not in your wallet yet. Approve the add-network prompt, then try again if it does not switch automatically.'
  }
  return 'The network could not be switched. Try again from your wallet.'
}

/**
 * User-initiated network switch between Arc Mainnet and Arc Testnet.
 * Does not switch silently. The underlying connector prompts the wallet to add the chain
 * when it is not yet configured (EIP-3085 / error 4902).
 */
export function NetworkSwitcher() {
  const { isConnected, chainId } = useAccount()
  const network = useNetworkInfo()
  const { switchChain, isPending, error, reset } = useSwitchChain()

  // Drop a rejected or failed switch when the wallet disconnects, so reconnecting starts clean.
  useEffect(() => {
    if (!isConnected) reset()
  }, [isConnected, reset])

  if (!isConnected) return null

  const handleSwitch = (targetId: number) => {
    if (targetId === chainId) return
    reset()
    switchChain({ chainId: targetId })
  }

  const errorMessage = error ? describeSwitchError(error) : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-support">
        <span className="text-ink-soft">Switch network</span>
        {!isSupportedChain(chainId) && (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs text-warning">Unsupported</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={chainId === arc.id ? 'primary' : 'secondary'}
          disabled={isPending || chainId === arc.id}
          onClick={() => handleSwitch(arc.id)}
        >
          Arc Mainnet
        </Button>
        <Button
          size="sm"
          variant={chainId === arcTestnet.id ? 'primary' : 'secondary'}
          disabled={isPending || chainId === arcTestnet.id}
          onClick={() => handleSwitch(arcTestnet.id)}
        >
          Arc Testnet
        </Button>
      </div>
      {chainId === arcTestnet.id && (
        <div className="rounded-control border border-line bg-surface-subtle p-3">
          <p className="text-support font-medium text-ink">Need test USDC?</p>
          <p className="mt-1 text-support text-ink-soft">
            Get 20 testnet USDC from Circle's faucet. The faucet limit is one request every 2 hours per address and network.
          </p>
          <a
            href={ARC_TESTNET_FAUCET_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-support font-semibold text-brand-blue underline-offset-4 hover:underline"
          >
            Get test USDC <ExternalLink className="size-4" aria-hidden />
          </a>
        </div>
      )}
      {isPending && <p className="text-support text-ink-soft">Switching network… confirm in your wallet. If the network is new, approve adding it.</p>}
      {errorMessage && <p className="text-support text-danger">{errorMessage}</p>}
      {!isSupportedChain(chainId) && (
        <p className="text-support text-warning">
          You are on {network.label}. Switch to Arc Mainnet or Arc Testnet to use Orvynn.
        </p>
      )}
    </div>
  )
}
