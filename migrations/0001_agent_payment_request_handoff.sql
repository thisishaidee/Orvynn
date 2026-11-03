-- Persistent inbox for AgentPay requests prepared by authenticated external agents.
-- Apply only after provisioning a Cloudflare D1 database and binding it as AGENT_REQUESTS_DB.
-- Requests remain unsigned and unsubmitted until the delegate explicitly approves in Orvynn.

CREATE TABLE IF NOT EXISTS agent_payment_requests (
  id TEXT PRIMARY KEY NOT NULL,
  lease_id TEXT NOT NULL,
  delegate_address TEXT NOT NULL,
  recipient_address TEXT NOT NULL,
  amount_base_units TEXT NOT NULL,
  amount_usdc TEXT NOT NULL,
  purpose TEXT,
  chain_id INTEGER NOT NULL CHECK (chain_id = 5042),
  agentpay_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'claimed', 'submitted', 'confirmed', 'rejected', 'expired')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  claimed_at INTEGER,
  claim_expires_at INTEGER,
  transaction_hash TEXT,
  updated_at INTEGER NOT NULL,
  CHECK (expires_at > created_at),
  CHECK (length(delegate_address) = 42),
  CHECK (length(recipient_address) = 42)
);

CREATE INDEX IF NOT EXISTS idx_agent_payment_requests_delegate_pending
  ON agent_payment_requests (delegate_address, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_payment_requests_expiry
  ON agent_payment_requests (status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_payment_requests_transaction_hash
  ON agent_payment_requests (transaction_hash)
  WHERE transaction_hash IS NOT NULL;

-- One-time wallet-authentication challenges for delegate inbox access.
CREATE TABLE IF NOT EXISTS delegate_auth_nonces (
  nonce_hash TEXT PRIMARY KEY NOT NULL,
  wallet_address TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (length(wallet_address) = 42),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_delegate_auth_nonces_expiry
  ON delegate_auth_nonces (expires_at);
