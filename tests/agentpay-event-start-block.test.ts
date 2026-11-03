import { describe, expect, test } from 'bun:test'
import { getAgentPayEventStartBlock } from '../src/lib/agentpay-deployment'
import { isRangeLimitError, isRateLimitError } from '../src/lib/agentpay-logs'

describe('AgentPay event scan start blocks', () => {
  test('starts Arc Mainnet scans at the verified deployment block', () => {
    expect(getAgentPayEventStartBlock(5042)).toBe(28_888_842n)
  })

  test('starts Arc Testnet scans at the verified deployment block', () => {
    expect(getAgentPayEventStartBlock(5042002)).toBe(70_433_685n)
  })

  test('refuses to scan from genesis on unknown chains', () => {
    expect(() => getAgentPayEventStartBlock(1)).toThrow('Refusing to scan from genesis')
  })

  test('does not split requests rejected by rate limiting', () => {
    expect(isRangeLimitError(new Error('Request exceeds defined limit. Details: rate limit exceeded'))).toBe(false)
  })

  test('recognizes provider throttling for bounded backoff retries', () => {
    expect(isRateLimitError(new Error('rate limit exceeded'))).toBe(true)
    expect(isRateLimitError(new Error('HTTP 429 too many requests'))).toBe(true)
    expect(isRateLimitError(new Error('block range is too wide'))).toBe(false)
  })

  test('still splits explicit block-range limit errors', () => {
    expect(isRangeLimitError(new Error('block range is too wide'))).toBe(true)
  })
})
