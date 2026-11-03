import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { onRequestPost } from "../api/agent/payment-requests/complete.js";

const delegate = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const other = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");
const origin = "https://orvynn.xyz";
const requestId = "11111111-1111-4111-8111-111111111111";
const transactionHash = `0x${"a".repeat(64)}`;
const now = Math.floor(Date.now() / 1000);
const nonce = "ab".repeat(32);
const payment = {
  id: requestId, lease_id: "7", delegate_address: delegate.address.toLowerCase(),
  recipient_address: "0x3333333333333333333333333333333333333333",
  amount_base_units: "1250000",
  agentpay_address: "0xA549B60313A86288d46323e5723AAa4c0fAA6363",
  status: "pending", expires_at: now + 600, transaction_hash: null
};

async function digest(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
  ].join("\\n");
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
  const response = await onRequestPost({
    request: makeRequest(), env: env(db)
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
