import { describe, expect, test } from 'bun:test'
import { getLeaseReadFailure } from './agentpay-reads'

describe('getLeaseReadFailure', () => {
  test('surfaces a failed refresh even when cached initial data exists', () => {
    const cachedQuery = {
      isError: true,
      error: new Error('RPC request timed out'),
      data: [],
    }

    expect(getLeaseReadFailure(cachedQuery, 'The lease read failed.')).toBe('RPC request timed out')
  })

  test('uses the fallback message when the failed query has no Error object', () => {
    expect(getLeaseReadFailure(
      { isError: true, error: { code: 'UPSTREAM_ERROR' } },
      'The delegate lease read failed.',
    )).toBe('The delegate lease read failed.')
  })

  test('does not report a failure for a successful query', () => {
    expect(getLeaseReadFailure(
      { isError: false, error: undefined },
      'The lease read failed.',
    )).toBeUndefined()
  })
})
