/**
 * Explicit wallet-signed AgentPay transactions.
 *
 * This module never signs silently and never chains approval into a contract
 * action. The caller must wait for approveUsdc() to succeed, then ask the user
 * to confirm the separate AgentPay action.
 */
import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  erc20Abi,
  formatUnits,
  type Address,
  type Hash,
} from 'viem'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { ARC_USDC_ADDRESS } from '@/lib/wallet'
import { useReadGate } from '@/lib/agentpay-reads'
import { agentPayAbi as agentPayReadAbi } from '@/lib/agentpay-abi'
import { validatePaymentInput } from '../../agent/src/payment-validation'
import { assertLeasePaymentAllowed } from '../../agent/src/lease-payment-guards'
import { agentPayWriteAbi } from '@/lib/agentpay-write-abi'

export type TransactionResult = {
  hash: Hash
  blockNumber: bigint
}

export type TransactionState =
  | 'disconnected'
  | 'unsupported-network'
  | 'missing-address'
  | 'wallet-unavailable'
  | 'ready'

export function useAgentPayTransactions() {
  const gate = useReadGate()
  const { address: connectedAddress, chainId: walletChainId, isConnected } = useAccount()
  const { data: walletClient } = useWalletClient({ chainId: gate.ok ? gate.chainId : undefined })
  const publicClient = usePublicClient({ chainId: gate.ok ? gate.chainId : undefined })
  const queryClient = useQueryClient()

  let state: TransactionState
  if (!isConnected || !connectedAddress) state = 'disconnected'
  else if (!gate.ok) state = gate.state
  else if (!walletClient || !publicClient) state = 'wallet-unavailable'
  else if (walletChainId !== gate.chainId || walletClient.account?.address.toLowerCase() !== connectedAddress.toLowerCase()) state = 'wallet-unavailable'
  else state = 'ready'

  const assertReady = useCallback(() => {
    if (!gate.ok) throw new Error(gate.reason)
    if (!walletClient || !publicClient || !connectedAddress || walletChainId !== gate.chainId) {
      throw new Error('Connect your wallet on the selected Arc network before submitting a transaction.')
    }
    if (walletClient.account?.address.toLowerCase() !== connectedAddress.toLowerCase()) {
      throw new Error('The active wallet account changed. Reconnect before submitting.')
    }
    return { contract: gate.contract, chainId: gate.chainId, account: connectedAddress }
  }, [gate, walletClient, publicClient, connectedAddress, walletChainId])

  const waitForSuccess = useCallback(async (hash: Hash): Promise<TransactionResult> => {
    if (!publicClient) throw new Error('The Arc network client is unavailable.')
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') {
      throw new Error(`Transaction ${hash} was mined but reverted.`)
    }
    // The receipt is the confirmation boundary. Refresh dashboard data in the
    // background so the wallet flow does not remain blocked by follow-up reads.
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['agentpay', 'leases'] }),
      queryClient.invalidateQueries({ queryKey: ['agentpay', 'activity'] }),
    ]).catch(() => undefined)
    return { hash, blockNumber: receipt.blockNumber }
  }, [publicClient, queryClient])

  /** Read the exact USDC allowance granted to this AgentPay contract. */
  const getUsdcAllowance = useCallback(async (): Promise<bigint> => {
    const { contract, account } = assertReady()
    if (!publicClient) throw new Error('The Arc network client is unavailable.')
    return publicClient.readContract({
      address: ARC_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'allowance',
      args: [account, contract],
    })
  }, [assertReady, publicClient])

  /** Submit an exact-amount USDC approval. This does not submit the next action. */
  const approveUsdc = useCallback(async (amount: bigint): Promise<TransactionResult> => {
    if (amount <= 0n) throw new Error('Approval amount must be greater than zero.')
    const { contract, account } = assertReady()
    if (!walletClient) throw new Error('The wallet client is unavailable.')
    const hash = await walletClient.writeContract({
      address: ARC_USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [contract, amount],
      account,
    })
    return waitForSuccess(hash)
  }, [assertReady, walletClient, waitForSuccess])

  const createLease = useCallback(async (args: {
    delegate: Address
    cap: bigint
    periodSeconds: bigint
    expiry: bigint
    allowlistEnabled: boolean
    initialDeposit: bigint
  }): Promise<TransactionResult> => {
    if (args.cap <= 0n || args.periodSeconds <= 0n || args.expiry <= 0n || args.initialDeposit < 0n) {
      throw new Error('Lease values are invalid.')
    }
    const { contract, account } = assertReady()
    if (args.initialDeposit > 0n) {
      const allowance = await getUsdcAllowance()
      if (allowance < args.initialDeposit) throw new Error('USDC approval is insufficient. Approve the exact initial deposit first, wait for confirmation, then submit lease creation.')
    }
    if (!walletClient) throw new Error('The wallet client is unavailable.')
    const hash = await walletClient.writeContract({
      address: contract,
      abi: agentPayWriteAbi,
      functionName: 'createLease',
      args: [args.delegate, args.cap, args.periodSeconds, args.expiry, args.allowlistEnabled, args.initialDeposit],
      account,
    })
    return waitForSuccess(hash)
  }, [assertReady, getUsdcAllowance, walletClient, waitForSuccess])

  const deposit = useCallback(async (leaseId: bigint, amount: bigint): Promise<TransactionResult> => {
    if (leaseId < 0n || amount <= 0n) throw new Error('Lease ID and deposit amount are invalid.')
    const { contract, account } = assertReady()
    const allowance = await getUsdcAllowance()
    if (allowance < amount) throw new Error('USDC approval is insufficient. Approve the exact deposit amount first, wait for confirmation, then submit the deposit.')
    if (!walletClient) throw new Error('The wallet client is unavailable.')
    const hash = await walletClient.writeContract({
      address: contract,
      abi: agentPayWriteAbi,
      functionName: 'deposit',
      args: [leaseId, amount],
      account,
    })
    return waitForSuccess(hash)
  }, [assertReady, getUsdcAllowance, walletClient, waitForSuccess])

  const setAllowlist = useCallback(async (leaseId: bigint, recipient: Address, allowed: boolean): Promise<TransactionResult> => {
    if (leaseId < 0n) throw new Error('Lease ID is invalid.')
    const { contract, account } = assertReady()
    if (!walletClient) throw new Error('The wallet client is unavailable.')
    const hash = await walletClient.writeContract({
      address: contract,
      abi: agentPayWriteAbi,
      functionName: 'setAllowlist',
      args: [leaseId, recipient, allowed],
      account,
    })
    return waitForSuccess(hash)
  }, [assertReady, walletClient, connectedAddress, waitForSuccess])

  const revoke = useCallback(async (leaseId: bigint): Promise<TransactionResult> => {
    if (leaseId < 0n) throw new Error('Lease ID is invalid.')
    const { contract, account } = assertReady()
    if (!walletClient) throw new Error('The wallet client is unavailable.')
    const hash = await walletClient.writeContract({
      address: contract,
      abi: agentPayWriteAbi,
      functionName: 'revoke',
      args: [leaseId],
      account,
    })
    return waitForSuccess(hash)
  }, [assertReady, walletClient, connectedAddress, waitForSuccess])

  const withdraw = useCallback(async (leaseId: bigint): Promise<TransactionResult> => {
    if (leaseId < 0n) throw new Error('Lease ID is invalid.')
    const { contract, account } = assertReady()
    if (!walletClient) throw new Error('The wallet client is unavailable.')
    const hash = await walletClient.writeContract({
      address: contract,
      abi: agentPayWriteAbi,
      functionName: 'withdraw',
      args: [leaseId],
      account,
    })
    return waitForSuccess(hash)
  }, [assertReady, walletClient, connectedAddress, waitForSuccess])

  const spend = useCallback(async (leaseId: bigint, recipient: Address, amount: bigint): Promise<TransactionResult> => {
    const { contract, account } = assertReady()
    if (!walletClient || !publicClient) throw new Error('The wallet and Arc network clients are unavailable.')
    if (walletClient.account?.address.toLowerCase() !== account.toLowerCase()) {
      throw new Error('The active signer does not match the connected delegate wallet.')
    }
    const input = validatePaymentInput({
      leaseId,
      delegate: account,
      recipient,
      amountUsdc: formatUnits(amount, 6),
    })
    recipient = input.recipient
    amount = input.amount

    // Prepare against live contract state before opening the wallet confirmation.
    const [lease, allowance, latestBlock] = await Promise.all([
      publicClient.readContract({
        address: contract,
        abi: agentPayReadAbi,
        functionName: 'leases',
        args: [leaseId],
      }),
      publicClient.readContract({
        address: contract,
        abi: agentPayReadAbi,
        functionName: 'remainingAllowance',
        args: [leaseId],
      }),
      publicClient.getBlock({ blockTag: 'latest' }),
    ])
    const [owner, registeredDelegate, , , expiry, , , , balance, allowlistEnabled, revoked] = lease

    const recipientAllowed = allowlistEnabled
      ? await publicClient.readContract({
          address: contract,
          abi: agentPayReadAbi,
          functionName: 'allowedRecipients',
          args: [leaseId, recipient],
        })
      : false

    assertLeasePaymentAllowed({
      lease: {
        owner,
        delegate: registeredDelegate,
        expiry,
        revoked,
        balance,
        remainingAllowance: allowance,
        allowlistEnabled,
        recipientAllowed,
      },
      suppliedDelegate: account,
      amount,
      nowSeconds: latestBlock.timestamp,
    })

    // Simulate the exact spend call. This is read-only; walletClient still
    // requires the delegate to approve the actual transaction.
    const simulation = await publicClient.simulateContract({
      account,
      address: contract,
      abi: agentPayWriteAbi,
      functionName: 'spend',
      args: [leaseId, recipient, amount],
    })
    const hash = await walletClient.writeContract({
      ...simulation.request,
      account,
    })
    return waitForSuccess(hash)
  }, [assertReady, walletClient, publicClient, waitForSuccess])

  return {
    state,
    reason: state === 'ready' ? '' : gate.ok ? 'Wallet client is not ready on the connected Arc network.' : gate.reason,
    getUsdcAllowance,
    approveUsdc,
    createLease,
    deposit,
    setAllowlist,
    revoke,
    withdraw,
    spend,
  }
}
