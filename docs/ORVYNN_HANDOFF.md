# Orvynn project handoff

Last updated: 2026-11-03

## Production safety
- Production URL: https://orvynn.pages.dev
- Production remains on `main` at approved PR #40 merge commit `c4da7ec25509094f0b9e01c0b7b8f5268cf88c59`.
- Do not merge, deploy, change production configuration, or mutate production data without explicit user approval.
- Report every check as passed, failed, or unverified. Never imply a check passed without a result.
- Never request wallet seed phrases or private keys. Do not sign transactions.

## Current performance work
- Isolated branch: `perf/incremental-event-history`.
- Draft PR: https://github.com/thisishaidee/Orvynn/pull/41
- Latest verified PR head: `d163cd43b8606b72bcdb4f16a4e1835fe995f6f5`.
- PR #41 is open, draft, mergeable and unmerged. Production remains unchanged.
- Latest CI run #377 (workflow run ID `41717654562`) passed both jobs on the exact head above:
  - Frontend: typecheck, frontend unit tests and build.
  - Contracts: build, contract tests and committed deployment-artifact verification.
- Cloudflare Pages preview for this exact commit deployed successfully:
  - https://8205bc76.orvynn.pages.dev
  - Deployment ID: `8205bc76-2b40-44bd-a60b-518f12d4315a`
- Preview caveat: its `ORVYNN_APP_ORIGIN` environment value still points to `https://feat-agent-payment-request-h.orvynn.pages.dev`, not the current preview origin. Agent-request API origin validation may therefore fail in this preview. Do not alter shared Cloudflare configuration without explicit approval; production must remain untouched.

## Incremental event-history implementation
- Helper module `src/lib/event-history-cache.ts` scopes cache keys by chain ID, contract, wallet, stream and optional filter fingerprint.
- Browser adapter `src/lib/event-history-storage.ts` stores event payload and checkpoint in one envelope. Invalid/corrupt envelopes are discarded; storage failures do not interrupt RPC reads. A 1.5-million-character per-stream cap prevents oversized localStorage writes while preserving the previous cache/checkpoint.
- Loader `src/lib/incremental-event-history.ts` verifies checkpoint block hash, scans with a 12-block overlap, deduplicates by transaction hash + log index, checks snapshot hash before/after, and retries once with a full rebuild if the snapshot changes.
- Integrated streams in `src/lib/agentpay-reads.ts`:
  - Owner `LeaseCreated`, scoped to owner wallet.
  - Owner `AllowlistUpdated`, scoped to owner wallet and exact sorted lease-ID set.
  - Delegate `LeaseCreated`, scoped to delegate wallet.
  - Activity, scoped to wallet, event set and exact sorted lease-ID set.
- Activity RPC filter construction combines event signatures and lease IDs with JSON-RPC topic-OR filters, splitting lease IDs into batches of at most 100.
- Current lease and remaining-allowance contract reads remain live at the lease-discovery snapshot. Cached history is not used to authorize a payment.
- Caller scans must fail on incomplete RPC results. The loader never checkpoints an incomplete scan.
- `src/lib/event-history-cache.test.ts` covers cache identity, serialization, corrupt cache cleanup, oversized writes, overlap, reorg recovery, snapshot changes, future checkpoints and preserving the previous checkpoint after RPC failure.
- `src/lib/agentpay-logs.test.ts` covers activity topic filters, event decoding, log ordering/metadata, 100-ID batching, empty filters and unknown event signatures.

## Remaining review before release
1. Manually open the preview in a browser, connect a wallet only if desired, and inspect owner/delegate lease history and activity. Do not approve or send any transaction as part of this test.
2. Verify wallet/network switching and empty-history behavior in the preview. Do not treat successful deployment as proof of full E2E behavior.
3. The preview API origin may fail due to the stale `ORVYNN_APP_ORIGIN` value above; keep this as a known environment caveat rather than changing shared configuration.
4. Review whether timestamp retrieval remains a measurable bottleneck. Activity logs still call `getBlockTimestamps`; its cache is in-memory, per-client, 30 seconds and max 5,000 entries. Do not persist timestamps without a reorg-aware design.
5. Measure real loading time before claiming a speed improvement. Compare cold first load and warm repeat load, using the same wallet/network and history.
6. Keep PR #41 draft until review and preview checks are complete. Ask for explicit approval before merge/deploy.

## GitHub access check
- User supplied a screenshot of repository Settings > Collaborators and teams for `thisishaidee/Orvynn`.
- Screenshot showed public repository, 0 direct collaborators, and no invited collaborators. This confirms no direct collaborators were listed on that screen at that time.
- Public visibility permits viewing/forking, not writing to the original repository.
- This does not verify account sessions, SSH keys, personal access tokens, OAuth authorizations, GitHub App permissions, or branch protection/rulesets. Those still need separate account/repository checks.
- No access settings, collaborators, tokens, keys, apps or branch protection were changed.

## Arc / AgentPay reference
- Arc Mainnet chain ID: `5042`.
- Arc Testnet chain ID: `5042002`.
- Mainnet AgentPay contract: `0xA549B60313A86288d46323e5723AAa4c0fAA6363`.
- Arc USDC: `0x3600000000000000000000000000000000000000`.
- Mainnet event start block: `28,888,842`.
- Testnet event start block: `70,433,685`.
- Production RPC configured for reads: `https://arc.nodely.dev`.

## User workflow preference
The user may start a new chat and say: "Check my previous Orvynn chats and continue." Read this handoff and relevant recent project conversations before making changes. Continue from verified state; do not ask the user to repeat details already available.
