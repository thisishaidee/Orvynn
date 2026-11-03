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
- Latest verified PR head: `94028dd3ca757821937ce4bc17a3b4b40e3c2917`.
- PR #41 is open, draft, mergeable and unmerged. Production remains unchanged.
- Latest CI run #374 (workflow run ID `41715210353`) passed both jobs:
  - Frontend: typecheck, unit tests and production build.
  - Contracts: build, tests and committed deployment-artifact verification.
- CI result is for the exact latest head above.

## Incremental event-history implementation
- Helper module `src/lib/event-history-cache.ts` scopes cache keys by chain ID, contract, wallet, stream and optional filter fingerprint.
- Browser adapter `src/lib/event-history-storage.ts` stores event payload and checkpoint in one envelope. Invalid/corrupt envelopes are discarded; storage failures do not interrupt RPC reads.
- Loader `src/lib/incremental-event-history.ts` verifies checkpoint block hash, scans with a 12-block overlap, deduplicates by transaction hash + log index, checks snapshot hash before/after, and retries once with a full rebuild if the snapshot changes.
- Integrated streams in `src/lib/agentpay-reads.ts`:
  - Owner `LeaseCreated`, scoped to owner wallet.
  - Owner `AllowlistUpdated`, scoped to owner wallet and exact sorted lease-ID set.
  - Delegate `LeaseCreated`, scoped to delegate wallet.
  - Activity, scoped to wallet, event set and exact sorted lease-ID set.
- Current lease and remaining-allowance contract reads remain live at the lease-discovery snapshot. Cached history is not used to authorize a payment.
- Caller scans must fail on incomplete RPC results. The loader never checkpoints an incomplete scan.
- Latest tests in `src/lib/event-history-cache.test.ts` cover cache identity, serialization, corrupt cache cleanup, overlap, reorg recovery, snapshot changes, future checkpoints and preserving the previous checkpoint after RPC failure.

## Remaining review before release
1. Add integration-level tests around the actual activity RPC filter construction, event decoding and stable log metadata. Existing tests exercise cache primitives/loader, not the complete viem RPC integration.
2. Add tests or a safe harness for wallet/network switching across the integrated read functions.
3. Review whether timestamp retrieval remains a measurable bottleneck. Activity logs still call `getBlockTimestamps`; its cache is in-memory, per-client, 30 seconds and max 5,000 entries. Do not persist timestamps without a reorg-aware design.
4. Review local-storage failure and full-history behavior in a browser preview.
5. Measure real loading time before claiming a speed improvement.
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
