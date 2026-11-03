import { useState } from "react";
import { useAccount, useWalletClient } from "wagmi";
import { Button, Card, Notice } from "@/components/ui";

export interface AgentPaymentRequest {
  id: string;
  leaseId: string;
  delegate: string;
  recipient: string;
  amountUsdc: string;
  purpose: string | null;
  chainId: number;
  contract: string;
  status: "pending";
  createdAt: number;
  expiresAt: number;
  requiresDelegateWalletConfirmation: true;
}

interface Props {
  onSelect: (request: AgentPaymentRequest) => void;
}

export function AgentRequestInbox({ onSelect }: Props) {
  const { address, isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [requests, setRequests] = useState<AgentPaymentRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const refresh = async () => {
    setError("");
    if (!isConnected || !address) {
      setError("Connect the delegate wallet to check its agent payment requests.");
      return;
    }
    if (!walletClient || walletClient.account?.address.toLowerCase() !== address.toLowerCase()) {
      setError("The connected wallet signer is not ready. Reconnect your wallet and try again.");
      return;
    }

    setBusy(true);
    try {
      const challengeResponse = await fetch("/api/agent/delegate-auth/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ wallet: address }),
      });
      const challengeBody = await challengeResponse.json() as {
        wallet?: string; nonce?: string; message?: string; error?: string;
      };
      if (!challengeResponse.ok || !challengeBody.nonce || !challengeBody.message ||
          challengeBody.wallet?.toLowerCase() !== address.toLowerCase()) {
        throw new Error(challengeBody.error || "Could not create a delegate authentication challenge.");
      }

      // This is a message signature for inbox access only, not a transaction approval.
      const signature = await walletClient.signMessage({
        account: address,
        message: challengeBody.message,
      });
      const inboxResponse = await fetch("/api/agent/delegate-auth/inbox", {
        method: "POST",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ wallet: address, nonce: challengeBody.nonce, signature }),
      });
      const inboxBody = await inboxResponse.json() as {
        requests?: AgentPaymentRequest[]; error?: string;
      };
      if (!inboxResponse.ok || !Array.isArray(inboxBody.requests)) {
        throw new Error(inboxBody.error || "Could not load delegate payment requests.");
      }
      setRequests(inboxBody.requests);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load agent payment requests.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 rounded-control border border-line p-3 sm:p-4" aria-label="External agent requests">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-label font-semibold">Requests from external agents</h3>
          <p className="mt-1 text-support text-ink-soft">Sign a one-time message to load requests for this delegate wallet. This does not approve a payment.</p>
        </div>
        <Button size="sm" variant="secondary" loading={busy} disabled={busy || !isConnected || !walletClient} onClick={() => void refresh()}>
          {loaded ? "Refresh inbox" : "Load agent requests"}
        </Button>
      </div>
      {error && <Notice tone="warning" title="Inbox unavailable">{error}</Notice>}
      {loaded && requests.length === 0 && !error && (
        <Notice tone="info" title="No pending agent requests">There are no unexpired payment requests waiting for this wallet.</Notice>
      )}
      {requests.map((request) => (
        <Card key={request.id} padding="sm" className="space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="num text-lg font-semibold">{request.amountUsdc} USDC</p>
              <p className="text-support text-ink-soft">Lease {request.leaseId} · expires {new Date(request.expiresAt * 1000).toLocaleTimeString()}</p>
            </div>
            <span className="rounded-full bg-brand-mist px-2.5 py-1 text-caption text-brand-blue">Awaiting review</span>
          </div>
          {request.purpose && <p className="text-support">{request.purpose}</p>}
          <div className="space-y-1">
            <p className="text-caption text-ink-soft">Recipient</p>
            <p className="break-all font-mono text-support">{request.recipient}</p>
          </div>
          <Button size="sm" block onClick={() => onSelect(request)}>Review this request</Button>
        </Card>
      ))}
    </section>
  );
}
