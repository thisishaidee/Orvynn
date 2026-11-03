import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi } from "viem";
import { agentPayAbi } from "../../agent/src/agentpay-abi.js";
import { onRequestPost } from "../api/agent/payment-requests/complete.js";

const delegate = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const other = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");
const origin = "https://orvynn.xyz";
const requestId = "11111111-1111-4111-8111-111111111111";
const transactionHash = `0x${"a".repeat(64)}`;
const now = Math.floor(Date.now() / 1000);
const nonce = "ab".repeat(32);
const spentAbi = parseAbi(["event Spent(uint256 indexed leaseId, address indexed recipient, uint256 amount)"]);
const payment = {
  id: requestId, lease_id: "7", delegate_address: delegate.address.toLowerCase(),
  recipient_address: "0x3333333333333333333333333333333333333333",
  amount_base_units: "1250000",
  agentpay_address: "0xA549B60313A86288d46323e5723AAa4c0fAA6363",
  status: "pending", expires_at: now + 600, transaction_hash: null
};

function mockDb(options: { challengeWallet?: string; paymentRow?: typeof payment | null } = {}) {
  let challenge = options.challengeWallet ? {
    wallet_address: options.challengeWallet.toLowerCase(), created_at: now, expires_at: now + 300
  } : null;
  const row = options.paymentRow === undefined ? { ...payment } : options.paymentRow;
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes("SELECT wallet_address, created_at, expires_at FROM delegate_auth_nonces")) return challenge as T | null;
              if (sql.includes("FROM agent_payment_requests WHERE id = ?")) return (row as T | null);
              throw new Error("Unexpected SQL first: " + sql);
            },
            async run() {
              if (sql.includes("DELETE FROM delegate_auth_nonces")) {
                if (challenge && challenge.wallet_address === String(values[1]) && challenge.expires_at > Number(values[2])) {
                  challenge = null;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes("UPDATE agent_payment_requests")) return { meta: { changes: 1 } };
              throw new Error("Unexpected SQL run: " + sql);
            }
          };
        }
      };
    }
  };
  return { db, hasChallenge: () => challenge !== null };
}

async function signedProof(wallet = delegate) {
  const message = [
    "Orvynn delegate payment inbox authentication",
    "",
    "This signature proves wallet control for one inbox request. It does not authorize or submit a payment.",
    `Origin: ${origin}`,
    `Wallet: ${wallet.address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(now * 1000).toISOString()}`,
    `Expiration Time: ${new Date((now + 300) * 1000).toISOString()}`,
  ].join("\n");
  return wallet.signMessage({ message });
}

function makeRequest(proof: { wallet?: string; nonce?: string; signature?: string } = {}) {
  return new Request(`${origin}/api/agent/payment-requests/complete`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({
      requestId, transactionHash, wallet: proof.wallet ?? delegate.address,
      nonce: proof.nonce ?? nonce, signature: proof.signature ?? `0x${"0".repeat(130)}`
    })
  });
}

const env = (db: ReturnType<typeof mockDb>["db"]) => ({
  AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: origin
});

test("rejects completion when the app Origin does not match the configured HTTPS origin", async () => {
  const { db } = mockDb({ challengeWallet: delegate.address });
  const request = new Request("https://orvynn.xyz/api/agent/payment-requests/complete", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: JSON.stringify({ requestId, transactionHash, wallet: delegate.address, nonce, signature: `0x${"0".repeat(130)}` })
  });
  const response = await onRequestPost({ request, env: env(db) });
  assert.equal(response.status, 403);
});

test("rejects completion when the authentication challenge is missing", async () => {
  const { db } = mockDb();
  const response = await onRequestPost({ request: makeRequest(), env: env(db) });
  assert.equal(response.status, 401);
});

test("rejects an invalid delegate signature without consuming the challenge", async () => {
  const { db, hasChallenge } = mockDb({ challengeWallet: delegate.address });
  const invalidSignature = await signedProof(other);
  const response = await onRequestPost({
    request: makeRequest({ signature: invalidSignature }), env: env(db)
  });
  assert.equal(response.status, 401);
  assert.equal(hasChallenge(), true);
});

test("rejects a validly authenticated wallet that is not the request's registered delegate", async () => {
  const { db, hasChallenge } = mockDb({
    challengeWallet: other.address,
    paymentRow: { ...payment, delegate_address: delegate.address.toLowerCase() }
  });
  const signature = await signedProof(other);
  const response = await onRequestPost({
    request: makeRequest({ wallet: other.address, signature }), env: env(db)
  });
  assert.equal(response.status, 403);
  assert.equal(hasChallenge(), false);
});

test("rejects a second use of the same completion challenge", async () => {
  const { db } = mockDb({ challengeWallet: other.address });
  const signature = await signedProof(other);
  const first = await onRequestPost({
    request: makeRequest({ wallet: other.address, signature }), env: env(db)
  });
  const second = await onRequestPost({
    request: makeRequest({ wallet: other.address, signature }), env: env(db)
  });
  assert.equal(first.status, 403);
  assert.equal(second.status, 401);
});

test("does not confirm a request that is no longer pending", async () => {
  const { db } = mockDb({
    challengeWallet: delegate.address,
    paymentRow: { ...payment, status: "expired" }
  });
  const signature = await signedProof();
  const response = await onRequestPost({
    request: makeRequest({ signature }), env: env(db)
  });
  assert.equal(response.status, 409);
});


function mockCompletionClient(options: {
  from?: string; to?: string | null; value?: bigint; input?: string;
  status?: "success" | "reverted"; blockTimestamp?: bigint; chainId?: number;
  logs?: Array<{ address: string; topics: readonly string[]; data: string }>;
} = {}) {
  const input = options.input ?? encodeFunctionData({
    abi: agentPayAbi, functionName: "spend",
    args: [7n, payment.recipient_address as `0x${string}`, 1_250_000n]
  });
  const topics = encodeEventTopics({
    abi: spentAbi, eventName: "Spent",
    args: { leaseId: 7n, recipient: payment.recipient_address as `0x${string}` }
  });
  const correctLog = {
    address: payment.agentpay_address, topics,
    data: encodeAbiParameters([{ type: "uint256" }], [1_250_000n])
  };
  return {
    getChainId: async () => options.chainId ?? 5042,
    getTransaction: async () => ({
      from: options.from ?? delegate.address,
      to: options.to === undefined ? payment.agentpay_address : options.to,
      value: options.value ?? 0n, input
    }),
    getTransactionReceipt: async () => ({
      status: options.status ?? "success", blockNumber: 100n,
      logs: options.logs ?? [correctLog]
    }),
    getBlock: async () => ({ timestamp: options.blockTimestamp ?? BigInt(now) })
  };
}

async function completeWith(options: Parameters<typeof mockCompletionClient>[0] = {}) {
  const { db } = mockDb({ challengeWallet: delegate.address });
  const signature = await signedProof();
  const response = await onRequestPost({
    request: makeRequest({ signature }), env: env(db)
  }, { createClient: () => mockCompletionClient(options) });
  return { response, body: await response.json() as Record<string, unknown> };
}

test("confirms only a successful Arc spend with a matching AgentPay Spent event", async () => {
  const { response, body } = await completeWith();
  assert.equal(response.status, 200);
  assert.equal(body.status, "confirmed");
  assert.equal(body.transactionHash, transactionHash);
  assert.equal(body.blockNumber, "100");
});

test("rejects a transaction sent by an address other than the registered delegate", async () => {
  const { response } = await completeWith({ from: other.address });
  assert.equal(response.status, 422);
});

test("rejects a transaction sent to a different contract", async () => {
  const { response } = await completeWith({ to: other.address });
  assert.equal(response.status, 422);
});

test("rejects a transaction that transfers native value", async () => {
  const { response } = await completeWith({ value: 1n });
  assert.equal(response.status, 422);
});

test("rejects a reverted transaction", async () => {
  const { response } = await completeWith({ status: "reverted" });
  assert.equal(response.status, 422);
});

test("rejects a spend with a different recipient or amount", async () => {
  const wrongInput = encodeFunctionData({
    abi: agentPayAbi, functionName: "spend",
    args: [7n, other.address, 1_250_000n]
  });
  const { response } = await completeWith({ input: wrongInput });
  assert.equal(response.status, 422);
});

test("rejects a successful receipt without the matching AgentPay Spent event", async () => {
  const { response } = await completeWith({ logs: [] });
  assert.equal(response.status, 422);
});

test("rejects a matching-looking event emitted by a different contract", async () => {
  const client = mockCompletionClient();
  const receipt = await client.getTransactionReceipt();
  const { response } = await completeWith({
    logs: [{ ...receipt.logs[0], address: other.address }]
  });
  assert.equal(response.status, 422);
});

test("rejects transactions mined after the payment request expiry", async () => {
  const { response } = await completeWith({ blockTimestamp: BigInt(payment.expires_at + 1) });
  assert.equal(response.status, 409);
});

test("fails closed when the supplied RPC is not Arc Mainnet", async () => {
  const { response } = await completeWith({ chainId: 1 });
  assert.equal(response.status, 503);
});
