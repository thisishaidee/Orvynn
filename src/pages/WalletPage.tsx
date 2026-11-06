import { Copy, ExternalLink, Wallet, ShieldCheck, Network, Coins } from 'lucide-react'
import { arc, arcTestnet } from 'viem/chains'
import { useAccount, useDisconnect } from 'wagmi'
import { toast } from 'sonner'
import { Badge, Button, Card, CardHeader, Notice, PageHeader, StatCard } from '@/components/ui'
import { InfoList, InfoRow } from '@/components/agentpay/Notices'
import { useWalletModal } from '@/components/wallet/WalletModalProvider'
import { NetworkSwitcher } from '@/components/wallet/NetworkSwitcher'
import { WALLETCONNECT_ENV_VAR, useWalletOptions } from '@/lib/wallets'
import { useNetworkInfo, useUsdcBalance, type BalanceState } from '@/lib/wallet'

const BALANCE_HINT: Record<BalanceState, string> = {
  disconnected: 'Connect a wallet to read its USDC balance.',
  'unsupported-network': 'Switch your wallet to Arc Mainnet or Arc Testnet to read the USDC balance.',
  loading: 'Reading the balance from the USDC contract.',
  error: 'The balance could not be read. Check your connection and try again.',
  ready: 'Read from the USDC contract on the connected Arc network.',
}

export function WalletPage() {
  const { address, isConnected, isConnecting, isReconnecting, connector } = useAccount()
  const { disconnect } = useDisconnect()
  const { open } = useWalletModal()
  const wallets = useWalletOptions()
  const network = useNetworkInfo()
  const balance = useUsdcBalance()
  const busy = isConnecting || isReconnecting

  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Address copied')
    } catch {
      toast.error('Could not copy. Select the address and copy it manually.')
    }
  }

  const explorerBase = network.chainId === arc.id
    ? arc.blockExplorers.default.url
    : network.chainId === arcTestnet.id
      ? arcTestnet.blockExplorers.default.url
      : undefined
  const explorerUrl = address && explorerBase ? `${explorerBase}/address/${address}` : undefined

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        eyebrow="Wallet"
        title="Wallet"
        description="The wallet you connect owns your leases and signs every action. Orvynn never sees your keys."
        actions={
          isConnected ? (
            <Button variant="secondary" onClick={() => disconnect()}>
              Disconnect
            </Button>
          ) : (
            <Button onClick={open} loading={busy} iconLeft={<Wallet className="size-4" aria-hidden />}>
              Connect wallet
            </Button>
          )
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card tone="soft" className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-surface text-brand-blue"><ShieldCheck className="size-5" /></span><div><p className="text-label text-ink">Self-custody</p><p className="text-support text-ink-soft">You control the keys</p></div></Card>
        <Card tone="soft" className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-surface text-brand-blue"><Network className="size-5" /></span><div><p className="text-label text-ink">Arc network</p><p className="text-support text-ink-soft">Mainnet and testnet</p></div></Card>
        <Card tone="soft" className="flex items-center gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-surface text-brand-blue"><Coins className="size-5" /></span><div><p className="text-label text-ink">USDC</p><p className="text-support text-ink-soft">Six-decimal precision</p></div></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Connection"
              action={
                <Badge tone={isConnected ? 'success' : busy ? 'warning' : 'neutral'}>
                  {isConnected ? 'Connected' : busy ? 'Connecting' : 'Not connected'}
                </Badge>
              }
            />
            <InfoList>
              <InfoRow label="Wallet app">{isConnected ? connector?.name ?? 'Unknown wallet' : 'None'}</InfoRow>
              <InfoRow label="Address">
                {address ? (
                  <span className="flex flex-col gap-2 md:items-end">
                    <span className="num break-all font-mono text-support">{address}</span>
                    <span className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void copyAddress()} iconLeft={<Copy className="size-4" aria-hidden />}>
                        Copy
                      </Button>
                      {explorerUrl && (
                        <a
                          href={explorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex h-9 items-center gap-1.5 rounded-control border border-line-strong bg-surface px-3 text-support font-medium text-ink hover:bg-brand-mist"
                        >
                          Explorer <ExternalLink className="size-4" aria-hidden />
                        </a>
                      )}
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-mute">Not available</span>
                )}
              </InfoRow>
              <InfoRow label="Network">
                <span className="inline-flex flex-wrap items-center gap-2 md:justify-end">
                  {network.label}
                  {isConnected && <Badge tone={network.supported ? 'success' : 'warning'}>{network.supported ? 'Supported' : 'Not supported'}</Badge>}
                </span>
              </InfoRow>
              {isConnected && (
                <InfoRow label="Change network">
                  <NetworkSwitcher />
                </InfoRow>
              )}
            </InfoList>
          </Card>
        </div>

        <StatCard
          tone="featured"
          label="USDC balance"
          icon={<Wallet className="size-5" />}
          value={balance.formatted ?? '0.00'}
          unit="USDC"
          hint={BALANCE_HINT[balance.state]}
        />
      </div>

      {balance.state === 'error' && (
        <Notice tone="danger" title="Balance unavailable">
          <Button size="sm" variant="secondary" onClick={balance.refetch} className="mt-2">
            Try again
          </Button>
        </Notice>
      )}

      <Notice tone="info" title={isConnected ? 'Wallet connection active' : 'Connection options'}>
        {isConnected
          ? `Connected with ${connector?.name ?? 'your wallet'}. Browser wallet detection is separate and does not affect this active connection.`
          : <>
              {wallets.detected.length > 0
                ? `Detected in this browser: ${wallets.detected.map((w) => w.name).join(', ')}. `
                : 'No browser wallet was detected here. '}
              Coinbase Wallet is available too.{' '}
              {wallets.walletConnectConfigured
                ? 'WalletConnect is enabled for mobile wallets.'
                : <>WalletConnect for mobile wallets is not enabled yet: it needs <code className="font-mono">{WALLETCONNECT_ENV_VAR}</code>.</>}
            </>}
      </Notice>
    </div>
  )
}
