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
import { getActivityLogsChunked, getLogsChunked, isRateLimitError } from '@/lib/agentpay-logs'
import { getAgentPayEventStartBlock } from '@/lib/agentpay-deployment'
import { getBlockTimestamps } from '@/lib/block-timestamps'


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

function toLease(id: bigint, row: LeaseTuple, remaining: bigint, allowed: Address[] | undefined, everFunded: boolean | null, nowSeconds: bigint): Lease {
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
    everFunded,
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
  // Lease IDs are sequential and the contract exposes nextLeaseId. Enumerate
  // current storage directly instead of scanning every historical LeaseCreated log.
  const snapshot = await client.getBlockNumber()
  const [latest, nextLeaseId] = await Promise.all([
    client.getBlock({ blockNumber: snapshot }),
    client.readContract({
      address: contract,
      abi: agentPayAbi,
      functionName: 'nextLeaseId',
      blockNumber: snapshot,
    }),
  ])
  const matching: Array<{ id: bigint; row: LeaseTuple; remaining: bigint }> = []
  const batchSize = 5

  for (let first = 1n; first < nextLeaseId; first += BigInt(batchSize)) {
    const ids = Array.from(
      { length: Number(nextLeaseId - first > BigInt(batchSize) ? BigInt(batchSize) : nextLeaseId - first) },
      (_, index) => first + BigInt(index),
    )
    const contracts = ids.flatMap((id) => [
      { address: contract, abi: agentPayAbi, functionName: 'leases' as const, args: [id] as const },
      { address: contract, abi: agentPayAbi, functionName: 'remainingAllowance' as const, args: [id] as const },
    ])

    let values: unknown[]
    try {
      values = await client.multicall({
        contracts: contracts as never,
        blockNumber: snapshot,
        allowFailure: false,
      }) as unknown[]
    } catch (error) {
      // A true throttle must not trigger fallback calls; let the query retry
      // after backoff rather than multiplying traffic against a rate-limited RPC.
      if (isRateLimitError(error)) throw error
      // Some Arc RPC configurations may not expose Multicall3. Keep the
      // fallback bounded and read against the same block snapshot.
      // Do not fan out a failed Multicall into dozens of simultaneous RPC
      // calls. Keep the fallback sequential by lease, with only the two
      // independent reads for one lease running together.
      const rows: Array<{ id: bigint; row: LeaseTuple; remaining: bigint }> = []
      for (const id of ids) {
        const [row, remaining] = await Promise.all([
          client.readContract({
            address: contract, abi: agentPayAbi, functionName: 'leases', args: [id], blockNumber: snapshot,
          }) as Promise<LeaseTuple>,
          client.readContract({
            address: contract, abi: agentPayAbi, functionName: 'remainingAllowance', args: [id], blockNumber: snapshot,
          }) as Promise<bigint>,
        ])
        rows.push({ id, row, remaining })
      }
      for (const item of rows) {
        const matches = filter.owner
          ? item.row[0].toLowerCase() === filter.owner.toLowerCase()
          : filter.delegate
            ? item.row[1].toLowerCase() === filter.delegate.toLowerCase()
            : false
        if (matches && item.row[0] !== '0x0000000000000000000000000000000000000000') matching.push(item)
      }
      continue
    }

    ids.forEach((id, index) => {
      const row = values[index * 2] as LeaseTuple
      const remaining = values[index * 2 + 1] as bigint
      const matches = filter.owner
        ? row[0].toLowerCase() === filter.owner.toLowerCase()
        : filter.delegate
          ? row[1].toLowerCase() === filter.delegate.toLowerCase()
          : false
      if (matches && row[0] !== '0x0000000000000000000000000000000000000000') {
        matching.push({ id, row, remaining })
      }
    })
  }

  if (matching.length === 0) return []

  // A zero balance alone cannot tell us whether a lease was never funded,
  // fully spent, or withdrawn. Verify deposit history only for zero-balance
  // leases; a positive current balance is already conclusive.
  const zeroBalanceIds = matching.filter(({ row }) => row[8] === 0n).map(({ id }) => id)
  const fundedLeaseIds = new Set<string>()
  let fundingHistoryAvailable = true
  if (zeroBalanceIds.length > 0) {
    try {
      const deposits = await getLogsChunked(client, {
        address: contract,
        event: eventAbi('Deposited') as never,
        args: { leaseId: zeroBalanceIds },
        fromBlock,
        toBlock: snapshot,
      })
      for (const log of deposits) {
        const leaseId = (log as unknown as { args: { leaseId?: bigint } }).args.leaseId
        if (leaseId !== undefined) fundedLeaseIds.add(leaseId.toString())
      }
    } catch {
      fundingHistoryAvailable = false
    }
  }

  const ids = matching.map(({ id, row }) => row[9] ? id : undefined).filter((id): id is bigint => id !== undefined)
  const allowedByLease = new Map<string, Map<string, boolean>>()
  // Recipient history is supplemental display data. A failure to retrieve
  // old AllowlistUpdated logs must never hide valid leases read from storage.
  let allowlistHistoryAvailable = true
  if (includeAllowlistHistory && ids.length > 0) {
    try {
      const allowlistLogs = await getLogsChunked(client, {
        address: contract,
        event: eventAbi('AllowlistUpdated') as never,
        args: { leaseId: ids },
        fromBlock,
        toBlock: snapshot,
      })
      for (const log of allowlistLogs) {
        const args = (log as unknown as { args: { leaseId?: bigint; recipient?: Address; allowed?: boolean } }).args
        if (args.leaseId === undefined || !args.recipient) continue
        const key = args.leaseId.toString()
        const permissions = allowedByLease.get(key) ?? new Map<string, boolean>()
        permissions.set(args.recipient.toLowerCase(), Boolean(args.allowed))
        allowedByLease.set(key, permissions)
      }
    } catch {
      allowlistHistoryAvailable = false
    }
  }

  return matching.map(({ id, row, remaining }) => {
    const permissions = allowedByLease.get(id.toString())
    const allowed = includeAllowlistHistory && allowlistHistoryAvailable
      ? permissions
        ? [...permissions.entries()].filter(([, enabled]) => enabled).map(([address]) => address as Address)
        : []
      : undefined
    const everFunded = row[8] > 0n || fundedLeaseIds.has(id.toString())
      ? true
      : fundingHistoryAvailable ? false : null
    return toLease(id, row, remaining, allowed, everFunded, latest.timestamp)
  }).sort((a, b) => Number(b.id) - Number(a.id))
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
      return discoverLeases(gate.client, gate.contract, { delegate: gate.address }, getAgentPayEventStartBlock(gate.chainId), false)
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
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: 1,
    // Render the last known lease snapshot immediately; it is never used to authorise a transaction.
    initialData: () => cacheKey ? readDelegateLeaseCache(cacheKey) : undefined,
    initialDataUpdatedAt: 0,
    queryFn: () => {
      if (!gate.ok) return []
      return discoverLeases(gate.client, gate.contract, { owner: gate.address }, getAgentPayEventStartBlock(gate.chainId))
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
    staleTime: 60_000,
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
