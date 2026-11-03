import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/agent/payment-requests/prepare.js";

const owner = "0x1111111111111111111111111111111111111111";
const delegate = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const token = "test-agent-api-token";
const contractUsdc = "0x3600000000000000000000000000000000000000";

function mockDb() {
  const inserts: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (!sql.includes("INSERT INTO agent_payment_requests")) throw new Error("Unexpected SQL: " + sql);
              inserts.push(values);
              return { meta: { changes: 1 } };
            }
          };
        }
      };
    }
  };
  return { db, inserts };
}

function mockRpc(options: { allowance?: bigint; revoked?: boolean; delegate?: string } = {}) {
  const calls: string[] = [];
  const client = {
    getChainId: async () => 5042,
    getBlock: async () => ({ timestamp: 1_800_000_000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      if (functionName === "leases") return [
        owner, options.delegate ?? delegate, 1_000_000n, 86_400n, 1_900_000_000n,
        0n, 0n, 0n, 5_000_000n, false, options.revoked ?? false
      ];
      if (functionName === "remainingAllowance") return options.allowance ?? 2_000_000n;
      if (functionName === "USDC") return contractUsdc;
      throw new Error("Unexpected read: " + functionName);
    },
    simulateContract: async () => { calls.push("simulate-spend"); return {}; }
  };
  return { client, calls };
}

function paymentRequest(delegateAddress = delegate) {
  return new Request("https://orvynn.xyz/api/agent/payment-requests/prepare", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      leaseId: "7", delegate: delegateAddress, recipient, amountUsdc: "1.25",
      purpose: "Approved supplier payment"
    })
  });
}

test("persists a validated request for the delegate inbox without signing or submitting", async () => {
  const { db, inserts } = mockDb();
  const { client, calls } = mockRpc();
  const response = await onRequestPost(
    { request: paymentRequest(), env: {
      AGENT_API_TOKEN: token, AGENT_REQUESTS_DB: db,
      AGENTPAY_ADDRESS: "0xA549B60313A86288d46323e5723AAa4c0fAA6363",
      USDC_ADDRESS: contractUsdc
    } },
    { createClient: () => client as never }
  );
  const body = await response.json() as {
    status: string; requestId: string; requestExpiresAt: number;
    execution: { signed: boolean; submitted: boolean; requiresDelegateWalletConfirmation: boolean };
  };
  assert.equal(response.status, 200);
  assert.equal(body.status, "ready_for_delegate_approval");
  assert.ok(body.requestId);
  assert.ok(body.requestExpiresAt > Math.floor(Date.now() / 1000));
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0][1], "7");
  assert.equal(inserts[0][2], delegate.toLowerCase());
  assert.equal(inserts[0][3], recipient.toLowerCase());
  assert.equal(inserts[0][4], "1250000");
  assert.equal(inserts[0][5], "1.25");
  assert.equal(inserts[0][6], "Approved supplier payment");
  assert.equal(body.execution.signed, false);
  assert.equal(body.execution.submitted, false);
  assert.equal(body.execution.requiresDelegateWalletConfirmation, true);
  assert.ok(calls.includes("simulate-spend"));
});

test("does not persist a request when the registered delegate check fails", async () => {
  const { db, inserts } = mockDb();
  const { client, calls } = mockRpc();
  const response = await onRequestPost(
    { request: paymentRequest("0x4444444444444444444444444444444444444444"), env: {
      AGENT_API_TOKEN: token, AGENT_REQUESTS_DB: db, USDC_ADDRESS: contractUsdc
    } },
    { createClient: () => client as never }
  );
  assert.equal(response.status, 422);
  assert.equal(inserts.length, 0);
  assert.ok(!calls.includes("simulate-spend"));
});

test("fails closed when persistent inbox storage is not configured", async () => {
  const { client, calls } = mockRpc();
  const response = await onRequestPost(
    { request: paymentRequest(), env: { AGENT_API_TOKEN: token, USDC_ADDRESS: contractUsdc } },
    { createClient: () => client as never }
  );
  assert.equal(response.status, 503);
  assert.equal(calls.length, 0);
});
