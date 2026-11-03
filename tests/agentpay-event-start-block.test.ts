import { describe, expect, test } from 'bun:test'
import { getAgentPayEventStartBlock } from '../src/lib/agentpay-reads'

describe('AgentPay event scan start blocks', () => {
  test('starts Arc Mainnet scans at the verified deployment block', () => {
    expect(getAgentPayEventStartBlock(5042)).toBe(28_888_842n)
  })

  test('starts Arc Testnet scans at the verified deployment block', () => {
    expect(getAgentPayEventStartBlock(5042002)).toBe(70_433_685n)
  })

  test('keeps an explicit genesis fallback for unknown chains', () => {
    expect(getAgentPayEventStartBlock(1)).toBe(0n)
  })
})
