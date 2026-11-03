/**
 * Read-only AgentPay contract access.
 * Discovers leases from LeaseCreated events filtered by owner, then reads
 * current state. Does not invent addresses, records, or timestamps.
 */

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { type Address, type Hex, type PublicClient } from 'viem'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { isSupportedChain } from '@/config'
import { agentPayAbi } from '@/lib/agentpay-abi'
import { agentPayAddressEnvVar, getAgentPayAddress } from '@/lib/agentpay-address'
import type { ActivityItem, ActivityType, DataSource, Lease } from '@/lib/agentpay'
import { activityAgent, currentPeriodSpent } from '@/lib/agentpay-accounting'
import { getActivityLogsChunked, getLogsChunked } from '@/lib/agentpay-logs'
import { getAgentPayEventStartBlock } from '@/lib/agentpay-deployment'
import { getBlockTimestamps } from '@/lib/block-timestamps'
import { loadIncrementalEventHistory } from '@/lib/incremental-event-history'


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
  chainId: number,
  filter: { owner?: Address; delegate?: Address },
  fromBlock: bigint,
  includeAllowlistHistory = true,
): Promise<Lease[]> {
  // Use one block for lease events, allowlist history and current contract state.
  const snapshot = await client.getBlockNumber()
  const latest = await client.getBlock({ blockNumber: snapshot })
  const getBlockHash = async (block: bigint): Promise<Hex> => {
    const result = await client.getBlock({ blockNumber: block })
    if (!result.hash) throw new Error(`Arc RPC did not return a hash for block ${block}.`)
    return result.hash
  }

  // Owner history is incrementally cached. Delegate discovery remains on its
  // existing path until its independent stream is integrated and verified.
  const created = filter.owner
    ? (await loadIncrementalEventHistory({
        identity: {
          chainId,
          contract,
          wallet: filter.owner,
          scope: 'owner-lease-created',
        },
        deploymentBlock: fromBlock,
        snapshotBlock: snapshot,
        getBlockHash,
        scan: (from, to) => getLogsChunked(client, {
          address: contract,
          event: eventAbi('LeaseCreated') as never,
          args: filter,
          fromBlock: from,
          toBlock: to,
        }),
      })).events
    : await getLogsChunked(client, {
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
  )].sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
  if (ids.length === 0) return []

  // Fetch only permission changes for leases belonging to this wallet.
  const allowlistLogs = includeAllowlistHistory
    ? filter.owner
      ? (await loadIncrementalEventHistory({
          identity: {
            chainId,
            contract,
            wallet: filter.owner,
            scope: 'owner-allowlist',
            // Permission history is only reusable for the exact lease set.
            filterKey: ids.map((id) => id.toString()).join(','),
          },
          deploymentBlock: fromBlock,
          snapshotBlock: snapshot,
          getBlockHash,
          scan: (from, to) => getLogsChunked(client, {
            address: contract,
            event: eventAbi('AllowlistUpdated') as never,
            args: { leaseId: ids },
            fromBlock: from,
            toBlock: to,
          }),
        })).events
      : await getLogsChunked(client, {
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

const DELEGATE_LEASE_CACHE_VERSION = 1

function leaseCacheKey(role: 'owner' | 'delegate', chainId: number, contract: Address, wallet: Address): string {
  return `orvynn:${role}-leases:v${DELEGATE_LEASE_CACHE_VERSION}:${chainId}:${contract.toLowerCase()}:${wallet.toLowerCase()}`
}

/**
 * A local snapshot is only a rendering shortcut. The payment path always
 * re-reads the lease from Arc and simulates the exact spend before signing.
 */
function readDelegateLeaseCache(key: string): Lease[] | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return undefined
    const parsed: unknown = JSON.parse(raw, (_key, value) => {
      if (value && typeof value === 'object' && typeof value.__orvynnBigInt === 'string') {
        return BigInt(value.__orvynnBigInt)
      }
      return value
    })
    if (!Array.isArray(parsed)) return undefined
    const valid = parsed.every((lease) =>
      lease && typeof lease === 'object' &&
      typeof lease.id === 'string' &&
      typeof lease.owner === 'string' &&
      typeof lease.delegate === 'string' &&
      typeof lease.cap === 'bigint' &&
      typeof lease.expiry === 'number' &&
      typeof lease.balance === 'bigint' &&
      typeof lease.spentThisPeriod === 'bigint' &&
      typeof lease.revoked === 'boolean'
    )
    return valid ? parsed as Lease[] : undefined
  } catch {
    return undefined
  }
}

function writeDelegateLeaseCache(key: string, leases: Lease[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(key, JSON.stringify(leases, (_key, value) =>
      typeof value === 'bigint' ? { __orvynnBigInt: value.toString() } : value
    ))
  } catch {
    // Storage may be disabled or full; on-chain reads remain authoritative.
  }
}

/** Leases where the connected wallet is the named delegate, for agent-side spending. */
export function useDelegateLeases(): DataSource<Lease> {
  const gate = useReadGate()
  const cacheKey = gate.ok ? leaseCacheKey('delegate', gate.chainId, gate.contract, gate.address) : undefined
  const query = useQuery({
    queryKey: ['agentpay', 'delegate-leases', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none'],
    enabled: gate.ok,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    initialData: () => cacheKey ? readDelegateLeaseCache(cacheKey) : undefined,
    // Cached snapshots render immediately but are always revalidated on Arc.
    initialDataUpdatedAt: Date.now(),
    queryFn: () => {
      if (!gate.ok) return []
      return discoverLeases(gate.client, gate.contract, gate.chainId, { delegate: gate.address }, getAgentPayEventStartBlock(gate.chainId), false)
    },
  })

  useEffect(() => {
    if (cacheKey && query.data) writeDelegateLeaseCache(cacheKey, query.data)
  }, [cacheKey, query.data])

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason, refetch: () => void query.refetch() }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading leases assigned to this agent wallet.', refetch: () => void query.refetch() }
  if (query.isError && !query.data) return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The delegate lease read failed.', refetch: () => void query.refetch() }
  return {
    state: 'ready',
    items: query.data ?? [],
    reason: '',
    refreshing: query.isFetching,
    refreshError: query.isError ? (query.error instanceof Error ? query.error.message : 'The live lease refresh failed.') : undefined,
    refetch: () => void query.refetch(),
  }
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
  const cacheKey = gate.ok ? leaseCacheKey('owner', gate.chainId, gate.contract, gate.address) : undefined
  const query = useQuery({
    queryKey: ['agentpay', 'leases', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none'],
    enabled: gate.ok,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
    // Render the last known lease snapshot immediately; it is never used to authorise a transaction.
    initialData: () => cacheKey ? readDelegateLeaseCache(cacheKey) : undefined,
    initialDataUpdatedAt: Date.now(),
    queryFn: () => {
      if (!gate.ok) return []
      return discoverLeases(gate.client, gate.contract, gate.chainId, { owner: gate.address }, getAgentPayEventStartBlock(gate.chainId))
    },
  })

  useEffect(() => {
    if (cacheKey && query.data) writeDelegateLeaseCache(cacheKey, query.data)
  }, [cacheKey, query.data])

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason, refetch: () => void query.refetch() }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading leases from the Orvynn contract.', refetch: () => void query.refetch() }
  if (query.isError && !query.data) {
    return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The lease read failed.', refetch: () => void query.refetch() }
  }
  return {
    state: 'ready',
    items: query.data ?? [],
    reason: '',
    refreshing: query.isFetching,
    refreshError: query.isError ? (query.error instanceof Error ? query.error.message : 'The live lease refresh failed.') : undefined,
    refetch: () => void query.refetch(),
  }
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

  // All six events index leaseId as their first indexed field. Query the
  // event-signature OR list and lease-ID OR list together so one RPC filter
  // retrieves the complete relevant history for this snapshot.
  const snapshot = await client.getBlockNumber()
  const eventNames = ['LeaseCreated', 'Deposited', 'Withdrawn', 'Spent', 'Revoked', 'AllowlistUpdated'] as const
  const logs = await getActivityLogsChunked(client, {
    address: contract,
    events: eventNames.map((name) => eventAbi(name)),
    leaseIds,
    fromBlock,
    toBlock: snapshot,
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
      return discoverActivity(gate.client, gate.contract, leases, getAgentPayEventStartBlock(gate.chainId))
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
