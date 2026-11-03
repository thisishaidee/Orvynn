import { Activity, Bot, KeyRound, LayoutDashboard, Settings, Wallet } from 'lucide-react'
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
import { TestnetDeployPage } from '@/pages/TestnetDeployPage'
import { LandingPage } from '@/pages/LandingPage'
import { OverviewPage } from '@/pages/OverviewPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WalletPage } from '@/pages/WalletPage'

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
    case 'agents':
      return <AgentsPage />
    case 'leases':
      return <LeasesPage />
    case 'activity':
      return <ActivityPage />
    case 'wallet':
      return <WalletPage />
    case 'deploy-testnet':
      return <TestnetDeployPage />
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
  const { address, isConnected } = useAccount()
  const canAccessDeploy = isConnected && isExpectedDeployer(address)

  if (page === 'landing') return <LandingPage onLaunch={() => navigate('overview')} />

  return (
    <WalletModalProvider>
      <WalletEvents />
      <AppShell
        nav={NAV}
        activeId={page}
        onNavigate={(id) => navigate(id as PageId)}
        topBarActions={(tone) => <WalletButton tone={tone} />}
      >
        {renderPage(page, navigate, canAccessDeploy)}
      </AppShell>
    </WalletModalProvider>
  )
}
