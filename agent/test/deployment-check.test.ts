import test from "node:test";
import assert from "node:assert/strict";
import type { Address } from "viem";
import { agentPayAddress, usdcAddress } from "../src/chain.js";
import { verifyArcDeployment, type ArcDeploymentReader } from "../src/deployment-check.js";

function mockReader(overrides: Partial<{
  chainId: number;
  agentPayCode: `0x${string}` | undefined;
  usdcCode: `0x${string}` | undefined;
  decimals: unknown;
  configuredUsdc: unknown;
}> = {}): ArcDeploymentReader {
  const values = {
    chainId: 5042,
    agentPayCode: "0x6001" as `0x${string}`,
    usdcCode: "0x6002" as `0x${string}`,
    decimals: 6,
    configuredUsdc: usdcAddress,
    ...overrides
  };
  return {
    getChainId: async () => values.chainId,
    getCode: async ({ address }: { address: Address }) =>
      address.toLowerCase() === agentPayAddress.toLowerCase() ? values.agentPayCode : values.usdcCode,
    readContract: async ({ functionName }: { functionName: "USDC" | "decimals" }) =>
      functionName === "decimals" ? values.decimals : values.configuredUsdc
  };
}

test("accepts the expected Arc Mainnet AgentPay and USDC deployment", async () => {
  await assert.doesNotReject(() => verifyArcDeployment(mockReader()));
});

test("rejects an RPC connected to a different chain", async () => {
  await assert.rejects(() => verifyArcDeployment(mockReader({ chainId: 1 })), /expected Arc Mainnet/);
});

test("rejects a missing AgentPay deployment", async () => {
  await assert.rejects(() => verifyArcDeployment(mockReader({ agentPayCode: "0x" })), /No contract code.*AgentPay/);
});

test("rejects a missing USDC deployment", async () => {
  await assert.rejects(() => verifyArcDeployment(mockReader({ usdcCode: undefined })), /No contract code.*USDC/);
});

test("rejects USDC with unexpected decimals", async () => {
  await assert.rejects(() => verifyArcDeployment(mockReader({ decimals: 18 })), /expected 6/);
});

test("rejects a contract whose configured USDC differs from Arc USDC", async () => {
  await assert.rejects(
    () => verifyArcDeployment(mockReader({ configuredUsdc: "0x1111111111111111111111111111111111111111" })),
    /does not match/
  );
});
