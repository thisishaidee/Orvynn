/**
 * Read-only AgentPay contract access.
 * Discovers leases from LeaseCreated events filtered by owner, then reads
 * current state. Does not invent addresses, records, or timestamps.
 */

import { useQuery } from '@tanstack/react-query'
import { parseEventLogs, type Address, type Hex, type PublicClient } from 'viem'
import { useAccount, usePublicClient, useReadContract } from 'wagmi'
import { isSupportedChain } from '@/config'
import { agentPayAbi } from '@/lib/agentpay-abi'
import { agentPayAddressEnvVar, getAgentPayAddress } from '@/lib/agentpay-address'
import type { ActivityItem, ActivityType, DataSource, Lease } from '@/lib/agentpay'
import { activityAgent, currentPeriodSpent } from '@/lib/agentpay-accounting'
import { getLogsChunked } from '@/lib/agentpay-logs'

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

async function blockTimestamps(client: PublicClient, blocks: bigint[]): Promise<Map<string, number>> {
  const unique = [...new Set(blocks.map((b) => b.toString()))]
  const map = new Map<string, number>()
  const concurrency = 12
  for (let i = 0; i < unique.length; i += concurrency) {
    const slice = unique.slice(i, i + concurrency)
    await Promise.all(
      slice.map(async (bn) => {
        try {
          const block = await client.getBlock({ blockNumber: BigInt(bn) })
          map.set(bn, Number(block.timestamp))
        } catch {
          // Timestamp unavailable for this block. Leave it out rather than invent one.
        }
      }),
    )
  }
  return map
}

type LeaseTuple = readonly [
  Address, Address, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean,
]

function toLease(id: bigint, row: LeaseTuple, remaining: bigint, allowed: Address[], nowSeconds: bigint): Lease {
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
    allowedRecipients: allowed,
    onChainRemaining: remaining,
  }
}

async function discoverLeases(client: PublicClient, contract: Address, filter: { owner?: Address; delegate?: Address }, fromBlock: bigint): Promise<Lease[]> {
  const created = await getLogsChunked(client, {
    address: contract,
    event: {
      type: 'event',
      name: 'LeaseCreated',
      inputs: agentPayAbi.find((x) => x.type === 'event' && x.name === 'LeaseCreated')!.inputs,
    } as never,
    args: filter,
    fromBlock,
  })

  const ids = [...new Set(created.map((log) => (log as unknown as { args: { leaseId?: bigint } }).args.leaseId).filter((id): id is bigint => id !== undefined))]
  if (ids.length === 0) return []

  const allowlistLogs = await getLogsChunked(client, {
    address: contract,
    event: {
      type: 'event',
      name: 'AllowlistUpdated',
      inputs: agentPayAbi.find((x) => x.type === 'event' && x.name === 'AllowlistUpdated')!.inputs,
    } as never,
    args: { leaseId: ids.length === 1 ? ids[0] : undefined },
    fromBlock,
  })

  const allowedByLease = new Map<string, Map<string, boolean>>()
  for (const log of allowlistLogs) {
    const args = (log as unknown as { args: { leaseId?: bigint; recipient?: Address; allowed?: boolean } }).args
    if (args.leaseId === undefined || !args.recipient) continue
    const key = args.leaseId.toString()
    const set = allowedByLease.get(key) ?? new Map<string, boolean>()
    set.set(args.recipient.toLowerCase(), Boolean(args.allowed))
    allowedByLease.set(key, set)
  }

  // Use the chain's latest block timestamp so the window-index calculation
  // matches the contract's remainingAllowance (which uses block.timestamp).
  // Client wall-clock time can be ahead or behind and would report the wrong period.
  const latest = await client.getBlock({ blockTag: 'latest' })
  const nowSeconds = latest.timestamp
  const blockNumber = latest.number
  if (blockNumber === null) {
    throw new Error('Latest block number is unavailable; cannot read a consistent lease snapshot.')
  }

  const leases = await Promise.all(
    ids.map(async (id) => {
      const [row, remaining] = await Promise.all([
        client.readContract({ address: contract, abi: agentPayAbi, functionName: 'leases', args: [id], blockNumber }) as Promise<LeaseTuple>,
        client.readContract({ address: contract, abi: agentPayAbi, functionName: 'remainingAllowance', args: [id], blockNumber }) as Promise<bigint>,
      ])
      const permissions = allowedByLease.get(id.toString())
      const allowed = permissions
        ? [...permissions.entries()].filter(([, on]) => on).map(([addr]) => addr as Address)
        : []
      return toLease(id, row, remaining, allowed, nowSeconds)
    }),
  )

  return leases.sort((a, b) => Number(b.id) - Number(a.id))
}

/** Leases where the connected wallet is the named delegate, for agent-side spending. */
export function useDelegateLeases(): DataSource<Lease> {
  const gate = useReadGate()
  const query = useQuery({
    queryKey: ['agentpay', 'delegate-leases', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none'],
    enabled: gate.ok,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => {
      if (!gate.ok) return []
      return discoverLeases(gate.client, gate.contract, { delegate: gate.address }, eventStartBlock(gate.chainId))
    },
  })

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading leases assigned to this agent wallet.' }
  if (query.isError) return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The delegate lease read failed.' }
  return { state: 'ready', items: query.data ?? [], reason: '' }
}

export function useNextLeaseId() {
  const gate = useReadGate()
  return useReadContract({
    address: gate.ok ? gate.contract : undefined,
    abi: agentPayAbi,
    functionName: 'nextLeaseId',
    query: { enabled: gate.ok },
  })
}

export function useLeaseRecord(id: bigint | undefined) {
  const gate = useReadGate()
  return useReadContract({
    address: gate.ok ? gate.contract : undefined,
    abi: agentPayAbi,
    functionName: 'leases',
    args: id !== undefined ? [id] : undefined,
    query: { enabled: gate.ok && id !== undefined },
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
    query: { enabled: gate.ok && id !== undefined && Boolean(recipient) },
  })
}

export function useOwnerLeases(): DataSource<Lease> {
  const gate = useReadGate()
  const query = useQuery({
    queryKey: ['agentpay', 'leases', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none'],
    enabled: gate.ok,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => {
      if (!gate.ok) return []
      return discoverLeases(gate.client, gate.contract, { owner: gate.address }, eventStartBlock(gate.chainId))
    },
  })

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading leases from the Orvynn contract.' }
  if (query.isError) {
    return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The lease read failed.' }
  }
  return { state: 'ready', items: query.data ?? [], reason: '' }
}

function eventAbi(name: string) {
  const found = agentPayAbi.find((item) => item.type === 'event' && item.name === name)
  if (!found || found.type !== 'event') throw new Error(`Missing event ${name}`)
  return found
}

async function discoverActivity(
  client: PublicClient,
  contract: Address,
  owner: Address,
  leases: Lease[],
  fromBlock: bigint,
): Promise<ActivityItem[]> {
  const leaseIds = leases.map((l) => BigInt(l.id))
  const byId = new Map(leases.map((l) => [l.id, l]))

  if (leaseIds.length === 0) return []

  // Read the contract's event stream once, then decode and filter locally.
  // Six separate historical eth_getLogs scans were serialised here, causing
  // Activity to wait on up to six complete passes over the same block range.
  // A single address-scoped scan returns all AgentPay events in each block chunk.
  const rawLogs = await getLogsChunked(client, { address: contract, fromBlock })
  const decoded = parseEventLogs({ abi: agentPayAbi, logs: rawLogs, strict: false })
  const owned = new Set(leaseIds.map((id) => id.toString()))
  const relevant = decoded.filter((log) => {
    const leaseId = (log.args as { leaseId?: bigint } | undefined)?.leaseId
    return leaseId !== undefined && owned.has(leaseId.toString())
  })
  const times = await blockTimestamps(client, relevant.map((log) => log.blockNumber).filter((n): n is bigint => n !== null))

  const items: ActivityItem[] = relevant.map((entry) => {
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
    const args = (log.args ?? {}) as {
      leaseId?: bigint
      owner?: Address
      delegate?: Address
      recipient?: Address
      amount?: bigint
      allowed?: boolean
    }
    const leaseId = args.leaseId?.toString() ?? '0'
    const lease = byId.get(leaseId)
    const type = (log.eventName ?? 'LeaseCreated') as ActivityType
    const timestamp = log.blockNumber !== null ? times.get(log.blockNumber.toString()) : undefined
    return {
      id: `${log.transactionHash}-${log.logIndex}`,
      type,
      leaseId,
      agent: activityAgent(type, args, lease?.delegate),
      recipient: args.recipient,
      amount: args.amount,
      timestamp,
      txHash: (log.transactionHash ?? '0x') as Hex,
      status: 'success',
    }
  })

  return items.sort((a, b) => {
    const ta = a.timestamp ?? 0
    const tb = b.timestamp ?? 0
    return tb - ta
  })
}

export function useOwnerActivity(leases: Lease[], leasesReady: boolean): DataSource<ActivityItem> {
  const gate = useReadGate()
  const query = useQuery({
    queryKey: ['agentpay', 'activity', gate.ok ? gate.chainId : 0, gate.ok ? gate.contract : 'none', gate.ok ? gate.address : 'none', leases.map((l) => l.id).join(',')],
    enabled: gate.ok && leasesReady,
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    queryFn: () => {
      if (!gate.ok) return []
      return discoverActivity(gate.client, gate.contract, gate.address, leases, eventStartBlock(gate.chainId))
    },
  })

  if (!gate.ok) return { state: gate.state, items: [], reason: gate.reason }
  if (!leasesReady) return { state: 'loading', items: [], reason: 'Waiting for lease discovery before reading activity.' }
  if (query.isPending) return { state: 'loading', items: [], reason: 'Reading activity from the Orvynn contract.' }
  if (query.isError) {
    return { state: 'error', items: [], reason: query.error instanceof Error ? query.error.message : 'The activity read failed.' }
  }
  return { state: 'ready', items: query.data ?? [], reason: '' }
}

/** Activity for the connected owner. Waits for lease discovery so lease IDs are known. */
export function useOwnerActivityQuery(): DataSource<ActivityItem> {
  const leases = useOwnerLeases()
  const ready = leases.state === 'ready'
  return useOwnerActivity(leases.items, ready)
}
