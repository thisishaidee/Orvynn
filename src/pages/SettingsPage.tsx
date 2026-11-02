import type { ReactNode } from 'react'
import { Check, X, Wallet, Network, SlidersHorizontal, ShieldCheck } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useAccount } from 'wagmi'
import { arc, arcTestnet } from 'viem/chains'
import { Badge, Card, CardHeader, PageHeader } from '@/components/ui'
import { InfoList, InfoRow } from '@/components/agentpay/Notices'
import { shortAddress } from '@/lib/agentpay'
import { useNetworkInfo } from '@/lib/wallet'
import { getAgentPayAddress } from '@/lib/agentpay-address'

function Section({ title, description, icon: Icon, children }: { title: string; description?: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-mist text-brand-blue"><Icon className="size-5" /></span>
        <div className="min-w-0 flex-1"><CardHeader title={title} description={description} className="mb-0" /></div>
      </div>
      {children}
    </Card>
  )
}

function Fact({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3 py-3">
      <span
        className={ok ? 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success-soft text-success' : 'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand-mist text-ink-soft'}
        aria-hidden
      >
        {ok ? <Check className="size-3.5" /> : <X className="size-3.5" />}
      </span>
      <span className="min-w-0 text-body text-ink">
        <span className="sr-only">{ok ? 'True: ' : 'Not yet: '}</span>
        {children}
      </span>
    </li>
  )
}

export function SettingsPage() {
  const { address, isConnected, connector } = useAccount()
  const network = useNetworkInfo()
  const contractAddress = getAgentPayAddress(network.chainId)
  const contractConfigured = network.chainId !== undefined
    ? Boolean(contractAddress)
    : Boolean(getAgentPayAddress(arc.id) || getAgentPayAddress(arcTestnet.id))

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader eyebrow="Settings" title="Settings" description="Your wallet, network and how the app works. Nothing here changes your funds." />

      <Card tone="featured" className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-10 -top-16 size-56 rounded-full border-[28px] border-white/5" />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-white/10"><ShieldCheck className="size-5" /></span>
          <div><p className="text-overline uppercase text-brand-pale">Control centre</p><h2 className="mt-1 text-section text-white">Your account and security at a glance.</h2><p className="mt-1 text-support text-brand-pale">Review your active wallet, network and contract configuration.</p></div>
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="Connected wallet" icon={Wallet}>
          <InfoList>
            <InfoRow label="Status">
              <Badge tone={isConnected ? 'success' : 'neutral'}>{isConnected ? 'Connected' : 'Not connected'}</Badge>
            </InfoRow>
            <InfoRow label="Wallet app">{isConnected ? connector?.name ?? 'Unknown wallet' : 'None'}</InfoRow>
            <InfoRow label="Address">
              {address ? <span className="num font-mono text-support" title={address}>{shortAddress(address)}</span> : <span className="text-ink-mute">Not available</span>}
            </InfoRow>
          </InfoList>
        </Section>

        <Section title="Selected network" icon={Network}>
          <InfoList>
            <InfoRow label="Wallet network">
              {network.label}
            </InfoRow>
            <InfoRow label="Supported by this app">
              {isConnected ? <Badge tone={network.supported ? 'success' : 'warning'}>{network.supported ? 'Yes' : 'No'}</Badge> : <span className="text-ink-mute">Not applicable</span>}
            </InfoRow>
            <InfoRow label="Networks this app can use" hint="Arc Mainnet and Arc Testnet only.">
              Arc Mainnet, Arc Testnet
            </InfoRow>
          </InfoList>
        </Section>

        <Section title="Application preferences" description="Current display defaults for this workspace." icon={SlidersHorizontal}>
          <InfoList>
            <InfoRow label="Theme">Light</InfoRow>
            <InfoRow label="Currency display">USDC, 6 decimal places</InfoRow>
            <InfoRow label="Language">English</InfoRow>
          </InfoList>
        </Section>

        <Section title="Security information" icon={ShieldCheck}>
          <ul className="divide-y divide-line">
            <Fact ok>This app never asks for your private key or recovery phrase. Your wallet signs every action.</Fact>
            <Fact ok>Spending rules are enforced by the Orvynn contract, not by this website.</Fact>
            <Fact ok>The contract has no administrator, pause switch or upgrade path. Each lease is controlled by the wallet that created it.</Fact>
            <Fact ok={false}>Not audited: an independent security audit of the contract has not been completed.</Fact>
            <Fact ok={contractConfigured}> {network.chainId === undefined
              ? contractConfigured
                ? 'A contract deployment is configured for a supported Arc network. Connect a wallet to resolve the active network and enable contract reads and wallet-signed actions.'
                : 'No Orvynn contract address is configured for Arc Mainnet or Arc Testnet; contract reads and transactions remain unavailable.'
              : contractAddress
                ? 'A contract address is configured for the selected Arc network. Contract reads and wallet-signed actions are available when connected.'
                : 'No Orvynn contract address is configured for the selected Arc network; contract reads and transactions remain unavailable.'}</Fact>
          </ul>
        </Section>
      </div>

    </div>
  )
}
