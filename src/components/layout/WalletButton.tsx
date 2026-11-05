import { Wallet } from 'lucide-react'
import { useAccount } from 'wagmi'
import { Button } from '@/components/ui/Button'
import { useWalletModal } from '@/components/wallet/WalletModalProvider'
import { shortAddress } from '@/lib/agentpay'

/**
 * Wallet entry point for the header. It opens the shared connect window and shows only what wagmi reports,
 * so it always matches the Wallet page. Nothing is simulated and no transaction is requested.
 */
export function WalletButton({ tone = 'light' }: { tone?: 'dark' | 'light' }) {
  const { address, isConnected, isConnecting, isReconnecting } = useAccount()
  const { open } = useWalletModal()

  return (
    <Button
      className="max-w-[8.5rem] px-2 sm:max-w-none sm:px-4"
      variant={tone === 'dark' ? 'inverse' : 'secondary'}
      onClick={open}
      loading={isConnecting || isReconnecting}
      iconLeft={<Wallet className="size-4" aria-hidden />}
      aria-label={isConnected ? 'Wallet connected. Open account' : 'Connect wallet'}
    >
      {isConnected && address ? (
        <span className="num max-w-[6rem] truncate sm:max-w-[9rem]">{shortAddress(address)}</span>
      ) : (
        <>
          <span className="sm:hidden">Connect</span>
          <span className="hidden sm:inline">Connect wallet</span>
        </>
      )}
    </Button>
  )
}
