import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { onRequestPost as createChallenge } from "../../functions/api/agent/delegate-auth/challenge.js";
import { onRequestPost as readInbox } from "../../functions/api/agent/delegate-auth/inbox.js";

type NonceRow = { wallet_address: string; created_at: number; expires_at: number };
type PaymentRow = {
  id: string; lease_id: string; delegate_address: string; recipient_address: string;
  amount_usdc: string; purpose: string | null; chain_id: number; agentpay_address: string;
  status: string; created_at: number; expires_at: number; updated_at?: number;
};

function mockDb(seed: PaymentRow[] = []) {
  const nonces = new Map<string, NonceRow>();
  const payments = seed.map((row) => ({ ...row }));
  const db = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (sql.includes("INSERT INTO delegate_auth_nonces")) {
                nonces.set(String(values[0]), {
                  wallet_address: String(values[1]), created_at: Number(values[2]), expires_at: Number(values[3])
                });
                return { meta: { changes: 1 } };
              }
              if (sql.includes("DELETE FROM delegate_auth_nonces WHERE nonce_hash")) {
                const row = nonces.get(String(values[0]));
                if (row && row.wallet_address === String(values[1]) && row.expires_at > Number(values[2])) {
                  nonces.delete(String(values[0]));
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes("DELETE FROM delegate_auth_nonces WHERE expires_at")) {
                for (const [key, row] of nonces) if (row.expires_at <= Number(values[0])) nonces.delete(key);
                return { meta: { changes: 1 } };
              }
              if (sql.includes("UPDATE agent_payment_requests SET status = 'expired'")) {
                for (const row of payments) {
                  if (row.delegate_address === String(values[1]) && row.status === "pending" && row.expires_at <= Number(values[2])) {
                    row.status = "expired"; row.updated_at = Number(values[0]);
                  }
                }
                return { meta: { changes: 1 } };
              }
              throw new Error("Unexpected SQL run: " + sql);
            },
            async first<T>() {
              if (sql.includes("SELECT wallet_address, created_at, expires_at FROM delegate_auth_nonces")) {
                return (nonces.get(String(values[0])) ?? null) as T | null;
              }
              throw new Error("Unexpected SQL first: " + sql);
            },
            async all<T>() {
              if (sql.includes("FROM agent_payment_requests")) {
                const rows = payments.filter((row) =>
                  row.delegate_address === String(values[0]) && row.status === "pending" && row.expires_at > Number(values[1])
                ).sort((a, b) => b.created_at - a.created_at).slice(0, 50);
                return { results: rows as T[] };
              }
              throw new Error("Unexpected SQL all: " + sql);
            }
          };
        }
      };
    }
  };
  return { db, nonces, payments };
}

const account = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const other = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000002");
const now = Math.floor(Date.now() / 1000);
const pending: PaymentRow = {
  id: "request-1", lease_id: "7", delegate_address: account.address.toLowerCase(),
  recipient_address: "0x3333333333333333333333333333333333333333", amount_usdc: "1.25",
  purpose: "Supplier payment", chain_id: 5042,
  agentpay_address: "0xA549B60313A86288d46323e5723AAa4c0fAA6363",
  status: "pending", created_at: now, expires_at: now + 600
};
const jsonRequest = (body: unknown) => new Request("https://orvynn.xyz/api/agent/delegate-auth", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
});

test("issues a short-lived challenge and returns a message bound to the wallet and app origin", async () => {
  const { db, nonces } = mockDb();
  const response = await createChallenge({ request: jsonRequest({ wallet: account.address }), env: {
    AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: "https://orvynn.xyz"
  } });
  const body = await response.json() as { wallet: string; nonce: string; message: string; expiresAt: number };
  assert.equal(response.status, 200);
  assert.equal(body.wallet, account.address);
  assert.match(body.message, /Origin: https:\/\/orvynn\.xyz/);
  assert.match(body.message, new RegExp(account.address));
  const ttl = body.expiresAt - Math.floor(Date.now() / 1000);
  assert.ok(ttl >= 299 && ttl <= 300, `unexpected challenge TTL: ${ttl}`);
  assert.equal(nonces.size, 1);
});

test("returns only the authenticated delegate's pending, unexpired requests", async () => {
  const { db } = mockDb([
    pending,
    { ...pending, id: "other-wallet", delegate_address: other.address.toLowerCase() },
    { ...pending, id: "expired", expires_at: now - 1 }
  ]);
  const challengeResponse = await createChallenge({ request: jsonRequest({ wallet: account.address }), env: {
    AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: "https://orvynn.xyz"
  } });
  const challenge = await challengeResponse.json() as { nonce: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  const response = await readInbox({ request: jsonRequest({
    wallet: account.address, nonce: challenge.nonce, signature
  }), env: { AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: "https://orvynn.xyz" } });
  const body = await response.json() as { requests: Array<{ id: string; requiresDelegateWalletConfirmation: boolean }> };
  assert.equal(response.status, 200);
  assert.deepEqual(body.requests.map((row) => row.id), ["request-1"]);
  assert.equal(body.requests[0].requiresDelegateWalletConfirmation, true);
});

test("rejects an invalid wallet signature without consuming the challenge", async () => {
  const { db, nonces } = mockDb([pending]);
  const challengeResponse = await createChallenge({ request: jsonRequest({ wallet: account.address }), env: {
    AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: "https://orvynn.xyz"
  } });
  const challenge = await challengeResponse.json() as { nonce: string; message: string };
  const signature = await other.signMessage({ message: challenge.message });
  const response = await readInbox({ request: jsonRequest({
    wallet: account.address, nonce: challenge.nonce, signature
  }), env: { AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: "https://orvynn.xyz" } });
  assert.equal(response.status, 401);
  assert.equal(nonces.size, 1);
});

test("rejects replay after a successful inbox read", async () => {
  const { db } = mockDb([pending]);
  const challengeResponse = await createChallenge({ request: jsonRequest({ wallet: account.address }), env: {
    AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: "https://orvynn.xyz"
  } });
  const challenge = await challengeResponse.json() as { nonce: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  const env = { AGENT_REQUESTS_DB: db, ORVYNN_APP_ORIGIN: "https://orvynn.xyz" };
  const first = await readInbox({ request: jsonRequest({ wallet: account.address, nonce: challenge.nonce, signature }), env });
  const replay = await readInbox({ request: jsonRequest({ wallet: account.address, nonce: challenge.nonce, signature }), env });
  assert.equal(first.status, 200);
  assert.equal(replay.status, 401);
});
