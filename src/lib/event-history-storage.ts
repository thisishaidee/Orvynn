import {
  parseEventHistory,
  serializeEventHistory,
  type EventHistoryCheckpoint,
  type EventHistoryIdentity,
} from './event-history-cache'

export interface EventHistoryStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type StoredEventHistory<T> = {
  checkpoint: EventHistoryCheckpoint
  events: T[]
}

type CacheEnvelope = {
  version: 1
  identity: EventHistoryIdentity
  checkpoint: EventHistoryCheckpoint
  events: string
}

function sameIdentity(a: EventHistoryIdentity, b: EventHistoryIdentity): boolean {
  return a.chainId === b.chainId &&
    a.contract.toLowerCase() === b.contract.toLowerCase() &&
    a.wallet.toLowerCase() === b.wallet.toLowerCase() &&
    a.scope === b.scope
}

function isCheckpoint(value: unknown): value is EventHistoryCheckpoint {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<EventHistoryCheckpoint>
  return item.version === 1 &&
    Number.isSafeInteger(item.chainId) &&
    typeof item.contract === 'string' &&
    typeof item.wallet === 'string' &&
    (item.scope === 'owner-leases' || item.scope === 'delegate-leases' || item.scope === 'activity') &&
    typeof item.throughBlock === 'string' && /^\d+$/.test(item.throughBlock) &&
    typeof item.blockHash === 'string' && /^0x[0-9a-f]{64}$/i.test(item.blockHash)
}

/** Browser localStorage adapter; unavailable in SSR or restricted contexts. */
export function getBrowserEventHistoryStorage(): EventHistoryStorage | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const storage = window.localStorage
    const probe = '__orvynn_event_history_probe__'
    storage.setItem(probe, '1')
    storage.removeItem(probe)
    return storage
  } catch {
    return undefined
  }
}

/** Read only a complete, correctly scoped cache envelope. Invalid data is discarded. */
export function readStoredEventHistory<T>(
  storage: EventHistoryStorage | undefined,
  key: string,
  identity: EventHistoryIdentity,
): StoredEventHistory<T> | undefined {
  if (!storage) return undefined
  try {
    const raw = storage.getItem(key)
    if (!raw) return undefined
    const envelope: unknown = JSON.parse(raw)
    if (!envelope || typeof envelope !== 'object') return undefined
    const value = envelope as Partial<CacheEnvelope>
    if (
      value.version !== 1 ||
      !value.identity ||
      !sameIdentity(value.identity, identity) ||
      !isCheckpoint(value.checkpoint) ||
      !sameIdentity(value.checkpoint, identity) ||
      typeof value.events !== 'string'
    ) {
      storage.removeItem(key)
      return undefined
    }
    const events = parseEventHistory<T>(value.events)
    if (!events) {
      storage.removeItem(key)
      return undefined
    }
    return { checkpoint: value.checkpoint, events }
  } catch {
    return undefined
  }
}

/** Persist events and checkpoint together; callers must supply a completed snapshot. */
export function writeStoredEventHistory<T>(
  storage: EventHistoryStorage | undefined,
  key: string,
  identity: EventHistoryIdentity,
  checkpoint: EventHistoryCheckpoint,
  events: readonly T[],
): boolean {
  if (!storage || !isCheckpoint(checkpoint) || !sameIdentity(checkpoint, identity)) return false
  try {
    const envelope: CacheEnvelope = {
      version: 1,
      identity,
      checkpoint,
      events: serializeEventHistory(events),
    }
    storage.setItem(key, JSON.stringify(envelope))
    return true
  } catch {
    // Quota/security failures must never break the authoritative RPC read.
    return false
  }
}
