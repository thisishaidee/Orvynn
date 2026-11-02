/**
 * Read-only AgentPay contract access.
 * Discovers leases from LeaseCreated events filtered by owner, then reads
 * current state. Does not invent addresses, records, or timestamps.
 */

import { useQuery } from '@tanstack/react-query'
import { type Address, type Hex, type PublicClient } from 'viem'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { isSupportedChain } from '@/config'
import { agentPayAbi } from '@/lib/agentpay-abi'
import { agentPayAddressEnvVar, getAgentPayAddress } from '@/lib/agentpay-address'
import type { ActivityItem, ActivityType, DataSource, Lease } from '@/lib/agentpay'
import { activityAgent, currentPeriodSpent } from '@/lib/agentpay-accounting'
import { getLogsChunked } from '@/lib/agentpay-logs'
import { getBlockTimestamps } from '@/lib/block-timestamps'

// Verified Arc Mainnet deployment block for the live AgentPay contract.
// Testnet deployments, if configured later, must supply their own start block.
const MAINNET_DEPLOYMENT_BLOCK = 28_888_842n
const eventStartBlock = (chainId: number) => chainId === 5042 ? MAINNET_DEPLOYMENT_BLOCK : 0n

export type ReadGate =
  | { ok: false; state: 'disconnected' | 'unsupported-network' | 'missing-address'; reason: string }
  | { ok: true; address: Address; chainId: number; contract: Address; client: PublicClient }

export function useReadGate(): ReadGate {
  const { address, isConnected, chainId } = useAccount()
  const client = usePublicClient({ chainId })
  const contract = getAgentPayAddress(chainId)

  if (!isConnected || !address) {
    return { ok: false, state: 'disconnected', reason: 'Connect a wallet to read Orvynn.' }
  }
  if (!isSupportedChain(chainId)) {
    return { ok: false, state: 'unsupported-network', reason: 'Switch to Arc Mainnet or Arc Testnet to read Orvynn.' }
  }
  if (!contract) {
    const env = agentPayAddressEnvVar(chainId)
    return {
      ok: false,
      state: 'missing-address',
      reason: env
        ? `No Orvynn contract address is configured for this network. Set ${env} after a real deployment.`
        : 'No Orvynn contract address is configured for this network.',
    }
  }
  if (!client) {
    return { ok: false, state: 'disconnected', reason: 'The network client is not ready yet.' }
  }
  return { ok: true, address, chainId, contract, client }
}

type LeaseTuple = readonly [
  Address, Address, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean,
]

function toLease(id: bigint, row: LeaseTuple, remaining: bigint, allowed: Address[] | undefined, nowSeconds: bigint): Lease {
  return {
    id: id.toString(),
    owner: row[0],
    delegate: row[1],
    cap: row[2],
    periodSeconds: Number(row[3]),
    expiry: Number(row[4]),
    spentThisPeriod: currentPeriodSpent({
      nowSeconds,
      windowStart: row[5],
      periodSeconds: row[3],
      lastWindowIndex: row[6],
      spentThisWindow: row[7],
    }),
    balance: row[8],
    allowlistEnabled: row[9],
    revoked: row[10],
    ...(allowed !== undefined ? { allowedRecipients: allowed } : {}),
    onChainRemaining: remaining,
  }
}

async function discoverLeases(
  client: PublicClient,
  contract: Address,
  filter: { owner?: Address; delegate?: Address },
  fromBlock: bigint,
  includeAllowlistHistory = true,
): Promise<Lease[]> {
  // Use one block for lease events, allowlist history and current contract state.
  const snapshot = await client.getBlockNumber()
  const latest = await client.getBlock({ blockNumber: snapshot })
  const created = await getLogsChunked(client, {
    address: contract,
    event: eventAbi('LeaseCreated') as never,
    args: filter,
    fromBlock,
    toBlock: snapshot,
  })

  const ids = [...new Set(
    created
      .map((log) => (log as unknown as { args: { leaseId?: bigint } }).args.leaseId)
      .filter((id): id is bigint => id !== undefined),
  )]
  if (ids.length === 0) return []

  // Fetch only permission changes for leases belonging to this wallet.
  const allowlistLogs = includeAllowlistHistory
    ? await getLogsChunked(client, {
        address: contract,
        event: eventAbi('AllowlistUpdated') as never,
        args: { leaseId: ids },
        fromBlock,
        toBlock: snapshot,
      })
    : []

  const allowedByLease = new Map<string, Map<string, boolean>>()
  for (const log of allowlistLogs) {
    const args = (log as unknown as { args: { leaseId?: bigint; recipient?: Address; allowed?: boolean } }).args
    if (args.leaseId === undefined || !args.recipient) continue
    const key = args.leaseId.toString()
    const permissions = allowedByLease.get(key) ?? new Map<string, boolean>()
    permissions.set(args.recipient.toLowerCase(), Boolean(args.allowed))
    allowedByLease.set(key, permissions)
  }

  const leases: Lease[] = []
  const batchSize = 25
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const batch = ids.slice(offset, offset + batchSize)
    const contracts = batch.flatMap((id) => [
      { address: contract, abi: agentPayAbi, functionName: 'leases' as const, args: [id] as const },
      { address: contract, abi: agentPayAbi, functionName: 'remainingAllowance' as const, args: [id] as const },
    ])

    let results: unknown[]
    try {
      // One bounded multicall replaces two independent RPC requests per lease.
      results = await client.multicall({
        contracts: contracts as never,
        blockNumber: snapshot,
        allowFailure: false,
      }) as unknown[]
    } catch {
      // Some RPC/network configurations may not expose Multicall3. Fall back
      // to bounded direct reads at the same snapshot rather than failing the
      // whole dashboard solely because batching is unavailable.
      const fallbackRows = await Promise.all(batch.map(async (id) => {
        const [row, remaining] = await Promise.all([
          client.readContract({
            address: contract, abi: agentPayAbi, functionName: 'leases', args: [id], blockNumber: snapshot,
          }) as Promise<LeaseTuple>,
          client.readContract({
            address: contract, abi: agentPayAbi, functionName: 'remainingAllowance', args: [id], blockNumber: snapshot,
          }) as Promise<bigint>,
        ])
        return { id, row, remaining }
      }))
      for (const { id, row, remaining } of fallbackRows) {
        const permissions = allowedByLease.get(id.toString())
        const allowed = includeAllowlistHistory
          ? permissions
            ? [...permissions.entries()].filter(([, enabled]) => enabled).map(([address]) => address as Address)
            : []
          : undefined
        leases.push(toLease(id, row, remaining, allowed, latest.timestamp))
      }
      continue
    }

    for (let index = 0; index < batch.length; index += 1) {
      const id = batch[index]
      const row = results[index * 2] as LeaseTuple
      const remaining = results[index * 2 + 1] as bigint
      const permissions = allowedByLease.get(id.toString())
      const allowed = includeAllowlistHistory
        ? permissions
          ? [...permissions.entries()].filter(([, enabled]) => enabled).map(([address]) => address as Address)
          : []
        : undefined
      leases.push(toLease(id, row, remaining, allowed, latest.timestamp))
    }
  }

  return leases.sort((a, b) => Number(b.id) - Number(a.id))
}

/** Leases where the connected wallet is the named delegate, for agent-side spending. */
export function useDelegateLeases(): DataSource<Lease> {
  const gate = useReadGate()
  const query = useQuery({
    queryKey: ['agentpay', 'delegate-leases', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none'],
    enabled: gate.ok,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
    queryFn: () => {
      if (!gate.ok) return []
      return discoverLeases(gate.client, gate.contract, { delegate: gate.address }, eventStartBlock(gate.chainId), false)
    },
  })

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason, refetch: () => void query.refetch() }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading leases assigned to this agent wallet.', refetch: () => void query.refetch() }
  if (query.isError) return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The delegate lease read failed.', refetch: () => void query.refetch() }
  return { state: 'ready', items: query.data ?? [], reason: '', refetch: () => void query.refetch() }
}

export function useNextLeaseId() {
  const gate = useReadGate()
  return useReadContract({
    address: gate.ok ? gate.contract : undefined,
    abi: agentPayAbi,
    functionName: 'nextLeaseId',
    query: { enabled: gate.ok, staleTime: 15_000, gcTime: 5 * 60_000, retry: 1 },
  })
}

export function useLeaseRecord(id: bigint | undefined) {
  const gate = useReadGate()
  return useReadContract({
    address: gate.ok ? gate.contract : undefined,
    abi: agentPayAbi,
    functionName: 'leases',
    args: id !== undefined ? [id] : undefined,
    query: { enabled: gate.ok && id !== undefined, staleTime: 15_000, gcTime: 5 * 60_000, retry: 1 },
  })
}

export function useRemainingAllowance(id: bigint | undefined) {
  const gate = useReadGate()
  return useReadContract({
    address: gate.ok ? gate.contract : undefined,
    abi: agentPayAbi,
    functionName: 'remainingAllowance',
    args: id !== undefined ? [id] : undefined,
    query: { enabled: gate.ok && id !== undefined },
  })
}

export function useAllowedRecipient(id: bigint | undefined, recipient: Address | undefined) {
  const gate = useReadGate()
  return useReadContract({
    address: gate.ok ? gate.contract : undefined,
    abi: agentPayAbi,
    functionName: 'allowedRecipients',
    args: id !== undefined && recipient ? [id, recipient] : undefined,
    query: { enabled: gate.ok && id !== undefined && Boolean(recipient), staleTime: 15_000, gcTime: 5 * 60_000, retry: 1 },
  })
}

export function useOwnerLeases(): DataSource<Lease> {
  const gate = useReadGate()
  const query = useQuery({
    queryKey: ['agentpay', 'leases', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none'],
    enabled: gate.ok,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
    queryFn: () => {
      if (!gate.ok) return []
      return discoverLeases(gate.client, gate.contract, { owner: gate.address }, eventStartBlock(gate.chainId))
    },
  })

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason, refetch: () => void query.refetch() }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading leases from the Orvynn contract.', refetch: () => void query.refetch() }
  if (query.isError) {
    return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The lease read failed.', refetch: () => void query.refetch() }
  }
  return { state: 'ready', items: query.data ?? [], reason: '', refetch: () => void query.refetch() }
}

function eventAbi(name: string) {
  const found = agentPayAbi.find((item) => item.type === 'event' && item.name === name)
  if (!found || found.type !== 'event') throw new Error(`Missing event ${name}`)
  return found
}

async function discoverActivity(
  client: PublicClient,
  contract: Address,
  leases: Lease[],
  fromBlock: bigint,
): Promise<ActivityItem[]> {
  const leaseIds = leases.map((lease) => BigInt(lease.id))
  const byId = new Map(leases.map((lease) => [lease.id, lease]))
  if (leaseIds.length === 0) return []

  // Each event type needs its own indexed filter. Keep the scans on one
  // snapshot, but limit how many historical scans compete for the RPC at once.
  // This reduces request bursts on mobile or rate-limited providers.
  const snapshot = await client.getBlockNumber()
  const eventNames = ['LeaseCreated', 'Deposited', 'Withdrawn', 'Spent', 'Revoked', 'AllowlistUpdated'] as const
  const eventLogs: Awaited<ReturnType<typeof getLogsChunked>>[] = []
  const scanConcurrency = 2
  for (let offset = 0; offset < eventNames.length; offset += scanConcurrency) {
    const batch = eventNames.slice(offset, offset + scanConcurrency)
    const results = await Promise.all(batch.map((name) =>
      getLogsChunked(client, {
        address: contract,
        event: eventAbi(name) as never,
        args: { leaseId: leaseIds },
        fromBlock,
        toBlock: snapshot,
      }),
    ))
    eventLogs.push(...results)
  }
  const [created, deposited, withdrawn, spent, revoked, allowlist] = eventLogs
  const logs = [...created, ...deposited, ...withdrawn, ...spent, ...revoked, ...allowlist]
    .sort((a, b) => {
      const blockOrder = (a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)
      if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1
      return (a.logIndex ?? 0) - (b.logIndex ?? 0)
    })

  const times = await getBlockTimestamps(
    client,
    logs.map((log) => log.blockNumber).filter((number): number is bigint => number !== null),
  )

  const items: ActivityItem[] = logs.flatMap((entry) => {
    const log = entry as {
      args?: {
        leaseId?: bigint
        owner?: Address
        delegate?: Address
        recipient?: Address
        amount?: bigint
        allowed?: boolean
      }
      eventName?: string
      blockNumber: bigint | null
      transactionHash: Hex | null
      logIndex: number | null
    }
    const args = log.args ?? {}
    if (args.leaseId === undefined) return []
    const leaseId = args.leaseId.toString()
    const lease = byId.get(leaseId)
    if (!lease) return []

    const type = (log.eventName ?? 'LeaseCreated') as ActivityType
    return [{
      id: `${log.transactionHash}-${log.logIndex}`,
      type,
      leaseId,
      agent: activityAgent(type, args, lease.delegate),
      recipient: args.recipient,
      amount: args.amount,
      timestamp: log.blockNumber !== null ? times.get(log.blockNumber.toString()) : undefined,
      txHash: (log.transactionHash ?? '0x') as Hex,
      status: 'success',
    }]
  })

  return items.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
}

export function useOwnerActivity(leases: Lease[], leasesReady: boolean): DataSource<ActivityItem> {
  const gate = useReadGate()
  const query = useQuery({
    queryKey: ['agentpay', 'activity', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none', leases.map((l) => l.id).join(',')],
    enabled: gate.ok && leasesReady,
    staleTime: 15_000,
    gcTime: 5 * 60_000,
    retry: 1,
    queryFn: () => {
      if (!gate.ok) return []
      return discoverActivity(gate.client, gate.contract, leases, eventStartBlock(gate.chainId))
    },
  })

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason, refetch: () => void query.refetch() }
  if (!leasesReady) return { state: 'loading', items: [], reason: 'Waiting for lease discovery before reading activity.', refetch: () => void query.refetch() }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading activity from the Orvynn contract.', refetch: () => void query.refetch() }
  if (query.isError) {
    return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The activity read failed.', refetch: () => void query.refetch() }
  }
  return { state: 'ready', items: query.data ?? [], reason: '', refetch: () => void query.refetch() }
}

/** Activity for the connected owner. Waits for lease discovery so lease IDs are known. */
export function useOwnerActivityQuery(): DataSource<ActivityItem> {
  const leases = useOwnerLeases()
  const ready = leases.state === 'ready'
  const activity = useOwnerActivity(leases.items, ready)

  // Activity depends on the owner lease IDs. Retrying this panel must retry
  // lease discovery first when that prerequisite has not completed.
  if (leases.state === 'error') {
    return { state: 'error', items: [], reason: leases.reason, refetch: leases.refetch }
  }
  if (leases.state === 'loading') {
    return { state: 'loading', items: [], reason: 'Finding your leases before loading activity.', refetch: leases.refetch }
  }
  return activity
}
