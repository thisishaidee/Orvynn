import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getLeaseReadFailure } from './agentpay-reads'

describe('getLeaseReadFailure', () => {
  it('surfaces a failed refresh even when cached initial data exists', () => {
    const cachedQuery = {
      isError: true,
      error: new Error('RPC request timed out'),
      data: [],
    }

    assert.equal(getLeaseReadFailure(cachedQuery, 'The lease read failed.'), 'RPC request timed out')
  })

  it('uses the fallback message when the failed query has no Error object', () => {
    assert.equal(
      getLeaseReadFailure(
        { isError: true, error: { code: 'UPSTREAM_ERROR' } },
        'The delegate lease read failed.',
      ),
      'The delegate lease read failed.',
    )
  })

  it('does not report a failure for a successful query', () => {
    assert.equal(
      getLeaseReadFailure({ isError: false, error: undefined }, 'The lease read failed.'),
      undefined,
    )
  })
})
