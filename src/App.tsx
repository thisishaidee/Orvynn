import { Activity, Bot, BookOpen, Droplets, ExternalLink, KeyRound, LayoutDashboard, Settings, Wallet } from 'lucide-react'
import { arcTestnet } from 'viem/chains'
import { AppShell, type NavItem } from '@/components/layout/AppShell'
import { WalletButton } from '@/components/layout/WalletButton'
import { Notice } from '@/components/ui'
import { useAccount } from 'wagmi'
import { isExpectedDeployer } from '@/lib/agentpay-deploy'
import { WalletEvents } from '@/components/wallet/WalletEvents'
import { WalletModalProvider } from '@/components/wallet/WalletModalProvider'
import { DesignPreview } from '@/design-system/DesignPreview'
import { useRoute, type PageId } from '@/lib/route'
import { ActivityPage } from '@/pages/ActivityPage'
import { AgentsPage } from '@/pages/AgentsPage'
import { LeasesPage } from '@/pages/LeasesPage'
import { DeployPage } from '@/pages/DeployPage'
import { LandingPage } from '@/pages/LandingPage'
import { DocsPage } from '@/pages/DocsPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WalletPage } from '@/pages/WalletPage'

const ARC_TESTNET_FAUCET_URL = 'https://faucet.circle.com'

/** User-facing navigation. The design-system preview is internal: open it with ?page=design. */
const NAV: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'leases', label: 'Leases', icon: KeyRound },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'settings', label: 'Settings', icon: Settings },
]

function renderPage(page: PageId, navigate: (page: PageId) => void, canAccessDeploy: boolean) {
  switch (page) {
    case 'landing':
      return <LandingPage onLaunch={() => navigate('overview')} />
    case 'docs':
      return <DocsPage onLaunch={() => navigate('overview')} />
    case 'agents':
      return <AgentsPage />
    case 'leases':
      return <LeasesPage />
    case 'activity':
      return <ActivityPage />
    case 'wallet':
      return <WalletPage />
    case 'deploy':
      return canAccessDeploy ? <DeployPage /> : (
        <div className="space-y-6">
          <Notice tone="warning" title="Restricted page">
            Connect the designated deployment wallet to access this page.
          </Notice>
        </div>
      )
    case 'settings':
      return <SettingsPage />
    case 'design':
      return <DesignPreview />
    default:
      return <OverviewPage onNavigate={navigate} />
  }
}

export default function App() {
  const [page, navigate] = useRoute()
  const { address, isConnected, chainId } = useAccount()
  const canAccessDeploy = isConnected && isExpectedDeployer(address)

  if (page === 'landing') return <LandingPage onLaunch={() => navigate('overview')} />
  if (page === 'docs') return <DocsPage onLaunch={() => navigate('overview')} />

  const sidebarFooter = (
    <div className="space-y-3">
      <div className="rounded-card border border-white/10 bg-white/[0.06] p-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <Droplets className="size-4 text-[#A9CCFF]" aria-hidden />
          Testnet faucet
        </div>
        <p className="mt-1.5 text-xs leading-5 text-white/65">
          Get test USDC to try Orvynn without using real funds.
        </p>
        <a
          href={ARC_TESTNET_FAUCET_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-control bg-white px-3 text-sm font-semibold text-brand-navy transition-colors hover:bg-[#EAF2FC]"
        >
          Get test USDC <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <p className="mt-2 text-[11px] leading-4 text-white/50">
          {chainId === arcTestnet.id ? 'Arc Testnet selected.' : 'Switch to Arc Testnet before requesting test USDC.'}
        </p>
      </div>
      <button type="button" onClick={() => navigate('docs')} className="inline-flex items-center gap-1.5 px-1 text-xs text-white/60 transition-colors hover:text-white">
        <BookOpen className="size-3.5" aria-hidden /> Documentation &amp; help
      </button>
    </div>
  )

  return (
    <WalletModalProvider>
      <WalletEvents />
      <AppShell
        nav={NAV}
        activeId={page}
        onNavigate={(id) => navigate(id as PageId)}
        sidebarFooter={sidebarFooter}
        topBarActions={(tone) => <WalletButton tone={tone} />}
      >
        {renderPage(page, navigate, canAccessDeploy)}
      </AppShell>
    </WalletModalProvider>
  )
}
