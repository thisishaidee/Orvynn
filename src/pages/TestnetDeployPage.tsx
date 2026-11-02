import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ExternalLink, FileCheck, Rocket, ShieldAlert } from 'lucide-react'
import { arcTestnet } from 'viem/chains'
import { createPublicClient, erc20Abi, formatUnits, http, keccak256 } from 'viem'
import { deployContract } from 'viem/actions'
import { useAccount, useConnectorClient, useSwitchChain } from 'wagmi'
import { toast } from 'sonner'
import { Badge, Button, Card, CardHeader, Notice, PageHeader } from '@/components/ui'
import { InfoList, InfoRow } from '@/components/agentpay/Notices'
import artifact from '@/lib/agentpay-artifact.generated.json'
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC,
  ARC_TESTNET_USDC,
  canStartTestnetDeployment,
  type TestnetDeployPhase,
} from '@/lib/agentpay-testnet-deploy'

const client = createPublicClient({ chain: arcTestnet, transport: http(ARC_TESTNET_RPC) })
const ABI = artifact.abi as never[]
const BYTECODE = artifact.bytecode as `0x${string}`
const EXPLORER = 'https://testnet.arcscan.app'
const PENDING_TX_KEY = 'orvynn.arc-testnet-deployment.pending.v1'

function readPendingHash(): `0x${string}` | undefined {
  try {
    const value = window.localStorage.getItem(PENDING_TX_KEY)
    return value && /^0x[0-9a-fA-F]{64}$/.test(value) ? value as `0x${string}` : undefined
  } catch {
    return undefined
  }
}

export function TestnetDeployPage() {
  const { address, isConnected, chainId } = useAccount()
  const { data: walletClient } = useConnectorClient()
  const { switchChain } = useSwitchChain()
  const [initialHash] = useState(readPendingHash)
  const [phase, setPhase] = useState<TestnetDeployPhase>(() => initialHash ? 'pending' : 'review')
  const [checking, setChecking] = useState(false)
  const [usdcVerified, setUsdcVerified] = useState(false)
  const [usdcDetail, setUsdcDetail] = useState('Not checked')
  const [gasEstimate, setGasEstimate] = useState<bigint>()
  const [gasPrice, setGasPrice] = useState<bigint>()
  const [txHash, setTxHash] = useState<`0x${string}`>(initialHash)
  const [contractAddress, setContractAddress] = useState<`0x${string}`>()
  const [problem, setProblem] = useState<string>()
  const bytecodeHash = useMemo(() => keccak256(BYTECODE), [])
  const onTestnet = chainId === ARC_TESTNET_CHAIN_ID

  const runChecks = useCallback(async () => {
    if (!address || !onTestnet) return
    setChecking(true)
    setUsdcVerified(false)
    setGasEstimate(undefined)
    setGasPrice(undefined)
    setProblem(undefined)
    setUsdcDetail('Checking Arc Testnet RPC...')
    try {
      const rpcChainId = await client.getChainId()
      if (rpcChainId !== ARC_TESTNET_CHAIN_ID) throw new Error(`Testnet RPC returned chain ID ${rpcChainId}; expected ${ARC_TESTNET_CHAIN_ID}.`)
      const [code, decimals] = await Promise.all([
        client.getBytecode({ address: ARC_TESTNET_USDC }),
        client.readContract({ address: ARC_TESTNET_USDC, abi: erc20Abi, functionName: 'decimals' }),
      ])
      if (!code || code === '0x') throw new Error('Arc Testnet USDC has no contract bytecode.')
      if (decimals !== 6) throw new Error(`Arc Testnet USDC reports ${decimals} decimals; expected 6.`)
      setUsdcVerified(true)
      setUsdcDetail(`${ARC_TESTNET_USDC} — code present, 6 decimals`)
      const gas = await client.estimateGas({ account: address, data: BYTECODE })
      if (gas <= 0n || gas > 2_500_000n) throw new Error(`Gas estimate ${gas} is outside the allowed deployment range.`)
      setGasEstimate(gas)
      try {
        const price = await client.getGasPrice()
        if (price > 0n) setGasPrice(price)
      } catch {
        // Fee estimate is informational; wallet presents the final fee.
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Arc Testnet safety checks failed.'
      setProblem(message)
      setUsdcDetail(message)
      setUsdcVerified(false)
    } finally {
      setChecking(false)
    }
  }, [address, onTestnet])

  const verifyReceipt = useCallback(async (hash: `0x${string}`, expectedSender: string) => {
    const rpcChainId = await client.getChainId()
    if (rpcChainId !== ARC_TESTNET_CHAIN_ID) throw new Error('Receipt verification stopped: RPC is not Arc Testnet.')
    const receipt = await client.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') {
      setPhase('failed')
      try { window.localStorage.removeItem(PENDING_TX_KEY) } catch { /* storage may be unavailable */ }
      throw new Error('Deployment transaction reverted. No contract was created.')
    }
    if (!receipt.contractAddress) throw new Error('Receipt succeeded but did not contain a contract address.')
    const tx = await client.getTransaction({ hash })
    if (tx.to !== null) throw new Error('The submitted transaction was not contract creation.')
    if (tx.from.toLowerCase() !== expectedSender.toLowerCase()) throw new Error('Deployment sender does not match the connected wallet.')
    if (tx.input.toLowerCase() !== BYTECODE.toLowerCase()) throw new Error('Deployment bytecode does not match the reviewed Orvynn artifact.')
    const code = await client.getBytecode({ address: receipt.contractAddress })
    if (!code || code === '0x') throw new Error('The resulting contract address has no bytecode.')
    const [usdc, nextLeaseId] = await Promise.all([
      client.readContract({ address: receipt.contractAddress, abi: ABI, functionName: 'USDC' }),
      client.readContract({ address: receipt.contractAddress, abi: ABI, functionName: 'nextLeaseId' }),
    ])
    if (String(usdc).toLowerCase() !== ARC_TESTNET_USDC.toLowerCase()) throw new Error('The deployed contract points to an unexpected USDC address.')
    if (nextLeaseId !== 1n) throw new Error('The deployed contract has an unexpected initial lease ID.')
    setContractAddress(receipt.contractAddress)
    setPhase('deployed')
    try { window.localStorage.removeItem(PENDING_TX_KEY) } catch { /* storage may be unavailable */ }
    return receipt.contractAddress
  }, [])

  const retryVerification = useCallback(async () => {
    if (!txHash) return
    setProblem(undefined)
    try {
      const tx = await client.getTransaction({ hash: txHash })
      await verifyReceipt(txHash, tx.from)
      toast.success('Orvynn testnet contract verified.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Receipt or contract verification is still pending.'
      setProblem(message)
      toast.error(message)
    }
  }, [txHash, verifyReceipt])

  useEffect(() => {
    if (initialHash) void retryVerification()
  }, [initialHash, retryVerification])

  const deploy = useCallback(async () => {
    if (!walletClient || !address || !canStartTestnetDeployment({ phase, account: address, chainId, usdcVerified, gasEstimate })) return
    if (walletClient.chain?.id !== ARC_TESTNET_CHAIN_ID) {
      toast.error('Wallet client is not on Arc Testnet. Reconnect or switch networks, then rerun checks.')
      return
    }
    setPhase('signing')
    setProblem(undefined)
    try {
      const gas = (gasEstimate! * 120n + 99n) / 100n
      const hash = await deployContract(walletClient, { abi: ABI, bytecode: BYTECODE, chain: arcTestnet, gas })
      setTxHash(hash)
      try { window.localStorage.setItem(PENDING_TX_KEY, hash) } catch { /* keep in-memory tracking if storage is unavailable */ }
      setPhase('pending')
      toast.info('Testnet deployment submitted. Waiting for confirmation and verification.')
      try {
        await verifyReceipt(hash, address)
        toast.success('Orvynn testnet contract deployed and verified.')
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Post-deployment verification failed.'
        setProblem(message)
        toast.error(message)
      }
    } catch (error) {
      // No hash was returned, so no submitted transaction is being tracked.
      setPhase('review')
      const message = error instanceof Error ? error.message : 'Wallet deployment request failed.'
      setProblem(message)
      toast.error(message)
    }
  }, [walletClient, address, phase, chainId, usdcVerified, gasEstimate, verifyReceipt])

  const canDeploy = canStartTestnetDeployment({ phase, account: address, chainId, usdcVerified, gasEstimate })

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader eyebrow="Testnet deployment" title="Deploy Orvynn to Arc Testnet" description="A separate testnet deployment flow. Your connected wallet signs the transaction; this page never asks for a private key or recovery phrase." />
      <Notice tone="warning" title="Testnet only">
        This page targets Arc Testnet (chain ID 5042002), not Arc Mainnet. Testnet tokens have no intended real-world value. Do not use this flow for mainnet deployment.
      </Notice>
      <Card>
        <CardHeader title="1. Wallet and network" description="Connect the wallet you want to use as the testnet contract owner." />
        {!isConnected ? <Notice tone="info">Connect a wallet to continue.</Notice> : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone={onTestnet ? 'success' : 'warning'}>{onTestnet ? 'Arc Testnet' : 'Wrong network'}</Badge>
            </div>
            <InfoList>
              <InfoRow label="Connected deployer">{address}</InfoRow>
              <InfoRow label="Expected chain ID">{ARC_TESTNET_CHAIN_ID}</InfoRow>
            </InfoList>
            {!onTestnet && <Button onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}>Switch to Arc Testnet</Button>}
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="2. Read-only safety checks" description="Verifies the Arc Testnet RPC, USDC bytecode and six decimals, and estimates deployment gas. No transaction is sent." />
        <Button variant="secondary" onClick={runChecks} disabled={!isConnected || !onTestnet || checking}>
          <FileCheck className="size-4" /> {checking ? 'Checking...' : 'Run testnet checks'}
        </Button>
        <div className="mt-4">
          <InfoList>
            <InfoRow label="USDC">{usdcDetail}</InfoRow>
            <InfoRow label="Gas estimate">{gasEstimate ? `${gasEstimate.toString()} gas` : 'Not checked'}</InfoRow>
            <InfoRow label="Estimated fee">{gasEstimate && gasPrice ? `${formatUnits(gasEstimate * gasPrice, 18)} native gas token (estimate only)` : 'Wallet will show the final fee.'}</InfoRow>
            <InfoRow label="Creation bytecode">{BYTECODE.length / 2 - 1} bytes · keccak {bytecodeHash.slice(0, 14)}…</InfoRow>
          </InfoList>
        </div>
        {problem && <Notice tone="danger" title="Deployment check">{problem}</Notice>}
      </Card>
      <Card>
        <CardHeader title="3. Review and confirm" description="One contract-creation transaction. Nothing is sent until you approve it in your connected wallet." />
        {phase === 'deployed' && contractAddress ? (
          <div className="space-y-3">
            <Notice tone="success"><CheckCircle2 className="size-4" /> Contract creation and post-deployment checks passed.</Notice>
            <InfoList>
              <InfoRow label="Contract address"><span className="break-all font-mono text-sm">{contractAddress}</span></InfoRow>
              <InfoRow label="Transaction">{txHash ? <a className="underline" href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer">{txHash.slice(0, 16)}… <ExternalLink className="inline size-3" /></a> : '—'}</InfoRow>
            </InfoList>
            <a className="underline" href={`${EXPLORER}/address/${contractAddress}`} target="_blank" rel="noreferrer">View contract on testnet explorer</a>
          </div>
        ) : (
          <div className="space-y-3">
            {phase === 'signing' && <Notice tone="info">Waiting for wallet confirmation. Review the network and gas fee in your wallet.</Notice>}
            {phase === 'pending' && <div className="space-y-2"><Notice tone="warning" title="Transaction submitted">Do not submit another deployment. This page is tracking the transaction. Transaction: {txHash}</Notice><Button variant="secondary" onClick={retryVerification}>Retry receipt and contract verification</Button></div>}
            {phase === 'failed' && <Notice tone="danger">The deployment transaction reverted. Review the failure before trying again.</Notice>}
            <Button onClick={deploy} disabled={!canDeploy || checking || phase === 'signing'}>
              <Rocket className="size-4" /> Deploy to Arc Testnet
            </Button>
            {!canDeploy && phase === 'review' && <Notice tone="warning"><ShieldAlert className="inline size-4" /> Run successful checks with a connected wallet on Arc Testnet before deploying.</Notice>}
          </div>
        )}
      </Card>
      <Card>
        <CardHeader title="Safety guarantees" description="What this flow checks before reporting success." />
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Never requests or stores a private key or recovery phrase.</li>
          <li>Refuses to deploy unless both wallet and RPC identify Arc Testnet (5042002).</li>
          <li>Verifies USDC bytecode and six decimals before enabling deployment.</li>
          <li>Checks the submitted transaction sender and exact creation bytecode.</li>
          <li>Verifies deployed bytecode, USDC(), and nextLeaseId() before reporting success.</li>
        </ul>
      </Card>
    </div>
  )
}
