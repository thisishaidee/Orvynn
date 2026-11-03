# Orvynn project handoff

Last updated: 2026-11-03

## Production safety
- Production URL: https://orvynn.pages.dev
- Production is on `main` at the approved PR #40 merge commit `c4da7ec25509094f0b9e01c0b7b8f5268cf88c59`.
- Do not merge, deploy, change production configuration, or mutate production data without explicit user approval.
- Report every check as passed, failed, or unverified. Never imply a check passed without a result.
- Never request wallet seed phrases or private keys. Do not sign transactions.

## Current performance work
- Isolated branch: `perf/incremental-event-history`.
- Draft PR: https://github.com/thisishaidee/Orvynn/pull/41
- Latest known commit when this handoff was written: `826fee532a9d1dac0b387ae321c8c039164848f4`.
- PR #41 is unmerged. Production remains unchanged.
- The branch contains pure cache primitives, a browser storage adapter, a reorg-checked incremental scan loader, and unit tests.
- These helpers are NOT yet integrated into `src/lib/agentpay-reads.ts` or `src/lib/agentpay-logs.ts`.
- CI for the latest commit has not yet been confirmed. A previous commit had a pending AgentPay CI run; do not treat it as proof for the latest commit.

## Cache design constraints
- Cache identity includes chain ID, contract, wallet, stream scope, and optional `filterKey`.
- Stream scopes: `owner-lease-created`, `owner-allowlist`, `delegate-lease-created`, and `activity`.
- Activity `filterKey` must fingerprint the exact lease-ID query set. If the set changes, force a rebuild.
- Only save a checkpoint after the complete RPC scan succeeds and the snapshot block hash is unchanged before and after the scan.
- Verify the stored checkpoint block hash; rebuild on mismatch or when the checkpoint is ahead of the current snapshot.
- Merge overlap events by transaction hash + log index.
- Storage is an optional display cache only. RPC reads remain authoritative; cache failures must not break reads.
- Keep full-scan recovery available. Never advance a checkpoint after partial or failed RPC history.

## Next steps
1. Verify latest CI (typecheck, frontend tests, build, contract tests).
2. Fix any failures before integrating.
3. Inspect the exact query filters and event types in `agentpay-reads.ts` and `agentpay-logs.ts`.
4. Integrate separate cache streams for owner lease creation, owner allowlist history, delegate lease creation, and activity with a stable activity filter fingerprint.
5. Add regression tests for wallet/network changes, changed lease filters, incomplete RPC scans, cache corruption, and reorg recovery.
6. Review the complete PR diff and verify preview behavior.
7. Ask for explicit approval before merging or deploying.

## Arc / AgentPay reference
- Arc Mainnet chain ID: `5042`.
- Arc Testnet chain ID: `5042002`.
- Mainnet AgentPay contract: `0xA549B60313A86288d46323e5723AAa4c0fAA6363`.
- Arc USDC: `0x3600000000000000000000000000000000000000`.
- Mainnet event start block: `28,888,842`.
- Testnet event start block: `70,433,685`.
- Production RPC configured for reads: `https://arc.nodely.dev`.

## User workflow preference
The user may start a new chat and say: "Check my previous Orvynn chats and continue." Read this handoff and relevant recent project conversations before making changes. Continue from the verified state; do not ask the user to repeat details already available.


## Incremental event-history integration update (2026-11-03)
- Owner `LeaseCreated` stream integrated in `src/lib/agentpay-reads.ts`, identity scoped by Arc chain ID, AgentPay contract, owner wallet and `owner-lease-created`.
- Owner `AllowlistUpdated` stream integrated separately; cache identity includes the exact sorted owner lease-ID set so a changed set triggers a rebuild.
- Delegate `LeaseCreated` stream integrated independently using `delegate-lease-created` and the delegate wallet identity.
- Activity stream integrated using `activity`; identity includes wallet, contract, chain, event-name set and exact sorted lease-ID filter.
- Each integrated stream uses the same loader safeguards: checkpoint block hash verification, 12-block overlap, complete-scan requirement, stable snapshot hash before/after, one full rebuild on snapshot change, and storage failure fallback.
- Activity and lease logs must include stable transaction hash and log index before they can be cached. Missing identity metadata causes the read to fail safely rather than checkpoint incomplete data.
- Current lease/allowance contract reads remain live at the lease-discovery snapshot; the cache is not used to authorize spending.
- Latest branch commit: `4b3c667ca9f547c46eb722249cc683f3e7ecffcd` (activity integration). Delegate integration commit: `f29404b05c7759c6d11e708618fd8256f0fe4272`.
- Latest commit has no confirmed CI run/status yet. Earlier green CI does not validate these integration changes.
- PR #41 remains draft, open and unmerged. Production remains unchanged at the PR #40 release.
- Next required work: trigger/obtain CI for the latest branch head, fix any type/test/build failures, then perform a focused code review and add integration-level tests for event decoding/filtering and wallet/network switching. Do not merge or deploy without explicit user approval.
