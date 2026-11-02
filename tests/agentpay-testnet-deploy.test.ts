import { describe, expect, test } from 'bun:test'
import {
  ARC_TESTNET_CHAIN_ID,
  canStartTestnetDeployment,
  parseSavedTestnetDeployment,
  serializeSavedTestnetDeployment,
  type SavedTestnetDeployment,
} from '../src/lib/agentpay-testnet-deploy'

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

describe('verified Arc Testnet deployment persistence', () => {
  const saved: SavedTestnetDeployment = {
    v: 1,
    chainId: ARC_TESTNET_CHAIN_ID,
    txHash: `0x${'a'.repeat(64)}`,
    contractAddress: '0x1111111111111111111111111111111111111111',
    deployer: '0x2222222222222222222222222222222222222222',
    savedAt: 1794000000000,
  }

  test('round-trips only the public verified deployment receipt', () => {
    expect(parseSavedTestnetDeployment(serializeSavedTestnetDeployment(saved))).toEqual(saved)
  })

  test('rejects malformed, wrong-chain, and incomplete deployment records', () => {
    expect(parseSavedTestnetDeployment('{broken')).toBeUndefined()
    expect(parseSavedTestnetDeployment(JSON.stringify({ ...saved, chainId: 5042 }))).toBeUndefined()
    expect(parseSavedTestnetDeployment(JSON.stringify({ ...saved, txHash: '0x1234' }))).toBeUndefined()
    expect(parseSavedTestnetDeployment(JSON.stringify({ ...saved, contractAddress: 'bad' }))).toBeUndefined()
    expect(parseSavedTestnetDeployment(JSON.stringify({ ...saved, deployer: 'bad' }))).toBeUndefined()
  })
})
