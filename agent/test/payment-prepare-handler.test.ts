import test from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../../functions/api/agent/payment-requests/prepare.js";

const token = "test-agent-token";
const env = { AGENT_API_TOKEN: token };

function request(body: string, authorization?: string): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== undefined) headers.set("authorization", authorization);
  return new Request("https://orvynn.test/api/agent/payment-requests/prepare", {
    method: "POST",
    headers,
    body
  });
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

test("returns 503 when the Agent API token is not configured", async () => {
  const response = await onRequestPost({
    request: request("{}"),
    env: {}
  });
  assert.equal(response.status, 503);
  assert.match(String((await responseBody(response)).error), /not configured/i);
});

test("rejects a missing bearer token before parsing the request body", async () => {
  const response = await onRequestPost({
    request: request("not-json"),
    env
  });
  assert.equal(response.status, 401);
  assert.match(String((await responseBody(response)).error), /token/i);
});

test("rejects an invalid bearer token", async () => {
  const response = await onRequestPost({
    request: request("{}", "Bearer wrong-token"),
    env
  });
  assert.equal(response.status, 401);
});

test("returns 400 for malformed JSON after successful authentication", async () => {
  const response = await onRequestPost({
    request: request("{invalid-json", `Bearer ${token}`),
    env
  });
  assert.equal(response.status, 400);
  assert.match(String((await responseBody(response)).error), /valid JSON/i);
});

test("returns 400 when the request body is missing", async () => {
  const req = new Request("https://orvynn.test/api/agent/payment-requests/prepare", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` }
  });
  const response = await onRequestPost({ request: req, env });
  assert.equal(response.status, 400);
  assert.match(String((await responseBody(response)).error), /body is required/i);
});

test("returns 400 when the request body exceeds 16 KB", async () => {
  const response = await onRequestPost({
    request: request(JSON.stringify({ payload: "x".repeat(16 * 1024) }), `Bearer ${token}`),
    env
  });
  assert.equal(response.status, 400);
  assert.match(String((await responseBody(response)).error), /16 KB limit/i);
});

test("rejects invalid payment addresses before attempting RPC access", async () => {
  const response = await onRequestPost({
    request: request(JSON.stringify({
      leaseId: "1",
      delegate: "not-an-address",
      recipient: "0x2222222222222222222222222222222222222222",
      amountUsdc: "1"
    }), `Bearer ${token}`),
    env
  });
  assert.equal(response.status, 422);
  assert.match(String((await responseBody(response)).error), /valid wallet addresses/i);
});


const owner = "0x1111111111111111111111111111111111111111";
const delegate = "0x2222222222222222222222222222222222222222";
const recipient = "0x3333333333333333333333333333333333333333";
const contractUsdc = "0x3600000000000000000000000000000000000000";

function rpcClient(options: { allowance?: bigint; recipientAllowed?: boolean; lease?: unknown } = {}) {
  const calls: string[] = [];
  const client = {
    getChainId: async () => 5042,
    getBlock: async () => ({ timestamp: 1_800_000_000n }),
    readContract: async ({ functionName }: { functionName: string }) => {
      calls.push(functionName);
      if (functionName === "leases") {
        return [owner, delegate, 1_000_000n, 86_400n, 1_900_000_000n, 0n, 0n, 0n, 5_000_000n, false, false];
      }
      if (functionName === "remainingAllowance") return options.allowance ?? 2_000_000n;
      if (functionName === "USDC") return contractUsdc;
      if (functionName === "allowedRecipients") return options.recipientAllowed ?? false;
      throw new Error(`Unexpected contract read: ${functionName}`);
    },
    simulateContract: async () => {
      calls.push("spend");
      return {};
    }
  };
  return { client, calls };
}

function validPaymentRequest() {
  return request(JSON.stringify({
    leaseId: "7",
    delegate,
    recipient,
    amountUsdc: "1.25",
    purpose: "Approved supplier payment"
  }), `Bearer ${token}`);
}

test("prepares a valid authenticated payment using mocked Arc RPC and never submits it", async () => {
  const { client, calls } = rpcClient();
  const response = await onRequestPost(
    { request: validPaymentRequest(), env },
    { createClient: () => client as never }
  );
  const body = await responseBody(response);
  assert.equal(response.status, 200);
  assert.equal(body.status, "ready_for_delegate_approval");
  assert.equal(body.purpose, "Approved supplier payment");
  assert.deepEqual(body.payment, {
    leaseId: "7",
    delegate,
    recipient,
    amountUsdc: "1.25",
    amountBaseUnits: "1250000",
    remainingAllowanceUsdc: "2",
    contract: "0xA549B60313A86288d46323e5723AAa4c0fAA6363",
    chainId: 5042,
    requiresDelegateWalletConfirmation: true
  });
  assert.deepEqual(body.execution, {
    submitted: false,
    signed: false,
    requiresDelegateWalletConfirmation: true
  });
  assert.ok(calls.includes("leases"));
  assert.ok(calls.includes("remainingAllowance"));
  assert.ok(calls.includes("USDC"));
  assert.ok(calls.includes("spend"));
});

test("rejects a payment above remaining allowance before simulation", async () => {
  const { client, calls } = rpcClient({ allowance: 1_000_000n });
  const response = await onRequestPost(
    { request: validPaymentRequest(), env },
    { createClient: () => client as never }
  );
  const body = await responseBody(response);
  assert.equal(response.status, 422);
  assert.equal(body.status, "rejected");
  assert.match(String(body.error), /remaining lease allowance/i);
  assert.ok(!calls.includes("spend"));
});

test("rejects a non-Arc RPC chain before reading lease state", async () => {
  const { client, calls } = rpcClient();
  client.getChainId = async () => 1;
  const response = await onRequestPost(
    { request: validPaymentRequest(), env },
    { createClient: () => client as never }
  );
  const body = await responseBody(response);
  assert.equal(response.status, 422);
  assert.match(String(body.error), /chain ID 5042/i);
  assert.equal(calls.length, 0);
});


test("rejects a request from a wallet that is not the registered delegate", async () => {
  const { client, calls } = rpcClient();
  const body = JSON.stringify({
    leaseId: "7",
    delegate: "0x4444444444444444444444444444444444444444",
    recipient,
    amountUsdc: "1",
    purpose: "Delegate mismatch"
  });
  const response = await onRequestPost(
    { request: request(body, `Bearer ${token}`), env },
    { createClient: () => client as never }
  );
  assert.equal(response.status, 422);
  assert.match(String((await responseBody(response)).error), /not the delegate registered/i);
  assert.ok(!calls.includes("spend"));
});

test("rejects a revoked lease before simulation", async () => {
  const { client, calls } = rpcClient({
    lease: [owner, delegate, 1_000_000n, 86_400n, 1_900_000_000n, 0n, 0n, 0n, 5_000_000n, false, true]
  });
  const response = await onRequestPost(
    { request: validPaymentRequest(), env },
    { createClient: () => client as never }
  );
  assert.equal(response.status, 422);
  assert.match(String((await responseBody(response)).error), /revoked/i);
  assert.ok(!calls.includes("spend"));
});

test("rejects an expired lease before simulation", async () => {
  const { client, calls } = rpcClient({
    lease: [owner, delegate, 1_000_000n, 86_400n, 1_700_000_000n, 0n, 0n, 0n, 5_000_000n, false, false]
  });
  const response = await onRequestPost(
    { request: validPaymentRequest(), env },
    { createClient: () => client as never }
  );
  assert.equal(response.status, 422);
  assert.match(String((await responseBody(response)).error), /expired/i);
  assert.ok(!calls.includes("spend"));
});

test("rejects a recipient excluded by an enabled allowlist", async () => {
  const { client, calls } = rpcClient({
    recipientAllowed: false,
    lease: [owner, delegate, 1_000_000n, 86_400n, 1_900_000_000n, 0n, 0n, 0n, 5_000_000n, true, false]
  });
  const response = await onRequestPost(
    { request: validPaymentRequest(), env },
    { createClient: () => client as never }
  );
  assert.equal(response.status, 422);
  assert.match(String((await responseBody(response)).error), /not on this lease's allowlist/i);
  assert.ok(calls.includes("allowedRecipients"));
  assert.ok(!calls.includes("spend"));
});
