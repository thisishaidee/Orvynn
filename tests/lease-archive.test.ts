import { describe, expect, test } from 'bun:test'
import {
  leaseArchiveStorageKey,
  readArchivedLeaseIds,
  writeArchivedLeaseIds,
} from '../src/lib/lease-archive'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    value: (key: string) => values.get(key),
  }
}

describe('lease archive persistence', () => {
  test('scopes archive data to chain and normalized wallet address', () => {
    expect(leaseArchiveStorageKey(5042, '0xAbCd')).toBe('orvynn:archived-leases:5042:0xabcd')
    expect(leaseArchiveStorageKey(5042002, '0xAbCd')).not.toBe(leaseArchiveStorageKey(5042, '0xAbCd'))
    expect(leaseArchiveStorageKey(5042, undefined)).toBeNull()
  })

  test('restores archived lease IDs from persistent storage', () => {
    const key = 'orvynn:archived-leases:5042:0xabcd'
    const storage = memoryStorage({ [key]: JSON.stringify(['1', '3']) })
    expect(readArchivedLeaseIds(storage, key)).toEqual(new Set(['1', '3']))
  })

  test('writes and reads archive changes across a fresh page-state instance', () => {
    const key = 'orvynn:archived-leases:5042:0xabcd'
    const storage = memoryStorage()
    writeArchivedLeaseIds(storage, key, ['1', '2', '2'])
    expect(readArchivedLeaseIds(storage, key)).toEqual(new Set(['1', '2']))
    writeArchivedLeaseIds(storage, key, ['2'])
    expect(readArchivedLeaseIds(storage, key)).toEqual(new Set(['2']))
  })

  test('does not silently accept corrupted archive data', () => {
    const key = 'orvynn:archived-leases:5042:0xabcd'
    const storage = memoryStorage({ [key]: '{broken' })
    expect(() => readArchivedLeaseIds(storage, key)).toThrow()
  })
})
