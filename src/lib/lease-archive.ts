export type ArchiveStorage = Pick<Storage, 'getItem' | 'setItem'>

export function leaseArchiveStorageKey(chainId?: number, address?: string): string | null {
  return chainId && address
    ? `orvynn:archived-leases:${chainId}:${address.toLowerCase()}`
    : null
}

/** Read the browser-local archive preference without silently masking storage errors. */
export function readArchivedLeaseIds(storage: Pick<ArchiveStorage, 'getItem'>, key: string): Set<string> {
  const stored: unknown = JSON.parse(storage.getItem(key) ?? '[]')
  return new Set(
    Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === 'string')
      : [],
  )
}

/** Persist a de-duplicated set of lease IDs for the active wallet and chain. */
export function writeArchivedLeaseIds(
  storage: Pick<ArchiveStorage, 'setItem'>,
  key: string,
  ids: Iterable<string>,
): void {
  storage.setItem(key, JSON.stringify([...new Set(ids)]))
}
