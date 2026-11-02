import { describe, expect, test } from 'bun:test'
import { ARC_TESTNET_CHAIN_ID, canStartTestnetDeployment } from '../src/lib/agentpay-testnet-deploy'

const base = {
  phase: 'review' as const,
  account: '0x1111111111111111111111111111111111111111',
  chainId: ARC_TESTNET_CHAIN_ID,
  usdcVerified: true,
  gasEstimate: 1_000_000n,
}

describe('Arc Testnet deployment gate', () => {
  test('allows deployment only after testnet checks pass', () => {
    expect(canStartTestnetDeployment(base)).toBe(true)
  })
  test('rejects mainnet and all other chains', () => {
    expect(canStartTestnetDeployment({ ...base, chainId: 5042 })).toBe(false)
    expect(canStartTestnetDeployment({ ...base, chainId: 1 })).toBe(false)
  })
  test('rejects missing wallet, USDC check, or gas estimate', () => {
    expect(canStartTestnetDeployment({ ...base, account: undefined })).toBe(false)
    expect(canStartTestnetDeployment({ ...base, usdcVerified: false })).toBe(false)
    expect(canStartTestnetDeployment({ ...base, gasEstimate: undefined })).toBe(false)
    expect(canStartTestnetDeployment({ ...base, gasEstimate: 0n })).toBe(false)
    expect(canStartTestnetDeployment({ ...base, gasEstimate: 2_500_001n })).toBe(false)
  })
  test('prevents duplicate submission after signing begins', () => {
    expect(canStartTestnetDeployment({ ...base, phase: 'signing' })).toBe(false)
    expect(canStartTestnetDeployment({ ...base, phase: 'pending' })).toBe(false)
    expect(canStartTestnetDeployment({ ...base, phase: 'deployed' })).toBe(false)
  })
})
