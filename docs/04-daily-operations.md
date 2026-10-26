# Daily operation and resilience

## One local job

Use the recipient's preferred scheduler: Codex automation, Claude's available scheduling capability, Windows Task Scheduler, or a user-level timer/cron. The exact mechanism depends on their client and OS; do not claim Claude Code provides an always-on scheduler by default. Ask for a time/timezone (a quiet early-morning run is a sensible suggestion). Avoid duplicate jobs. A native scheduler can sync/publish without a running model; semantic note processing needs an authorized AI run. The PC and relevant services must be available. Do not use an AI turn as a substitute for a reliable command-line worker.

Once the bank jobs are separately verified, the scheduled procedure is:

1. `python scripts/workbench.py sync` under the built-in exclusive lock. Inspect `private/sync-status.json` and `private/publish-status.json` for fresh completion. Partial results do not prevent later note handling.
2. `python scripts/workbench.py notes` fetches pending authoritative notes (including backlog), excluding deferred unchanged versions. No remote-fetch failure may trigger fallback to stale notes.
3. With the owner's explicit standing authorization, interpret clear context, prepare structured changes and run `review`. Use `defer` for ambiguity. Process one note independently of another's conflict. Never pass note text through a shell command.
4. Re-fetch notes and publish the finished snapshot. Record per-run start/finish, outcomes, conflicts, deferrals, coverage and publication time. Do not store note text or credentials in a public operational receipt.
5. Notify only for meaningful failure, a new clarification, changed source needing attention, or consent renewal due within seven days. Do not repeat unchanged review questions or announce every successful run.

The included worker holds one OS lock, runs configured jobs with bounded execution and descendant termination, isolates failed job names, reads the saved Firefly ledger, holds changed reporting entries and preserves old publication on validation failure. It does not invent feed coverage or consent expiry: add these from the selected bank connector's authenticated status. A successful Firefly read alone is not proof that today's bank sync succeeded.

## Bank-worker acceptance contract

The original kind of setup often needs bank-specific normalization. Do not copy someone else's account IDs or merely set `import_jobs_verified=true`. Check the official importer's behaviour. If it cannot meet the following requirements, keep that feed manual or implement a dedicated adapter in the new project:

- **Read-only boundary:** authorization/account/session/transaction endpoints only. Never call payment APIs. Save provider application key and consents locally. Validate callback state and exact registered HTTPS return URL; a browser and user handle consent/MFA.
- **Freeze before applying:** download full paginated booked snapshots to protected storage. Validate dates, sign/direction, precision, currency, required IDs and account mappings. Preserve the original snapshot; planning may produce a separate effective one.
- **Stable duplicate identity:** prefer the provider's stable posting ID scoped by bank and account. Use a canonical fallback only when demonstrably unique. Preserve identity history and evidence. A changed label is not a new payment. Detect ambiguous collisions rather than dropping equal-value payments.
- **Recoverable ledger writes:** preview, back up, then transactionally apply stable external IDs. If Firefly creation succeeds before checkpoint persistence, the next run must find that external ID and avoid duplicate creation. Never blindly retry an uncertain non-idempotent POST.
- **Transfers:** match owned-account legs jointly using explicit ownership and source evidence. Preserve currencies, fees and both legs. If one counterpart is held, hold the related group. Never inflate income/spending by importing two sides separately.
- **Source revisions:** a changed previously indexed posting creates a versioned review proposal while keeping the original ledger/index unchanged. Unaffected transactions continue. Owner acceptance of financial changes requires deliberate evidence-based repair. Suppress repeated notifications for an unchanged proposal.
- **Failure boundaries:** isolate independent malformed entries when safe. Hold an affected feed or transfer group when identities/legs cannot be trusted. Continue other feeds. Saved-ledger corruption or an invariant failure stops financial writes, not an opportunity to weaken validation.
- **Checkpointing:** advance only successful complete feeds. Hold failed-feed checkpoints and retry with overlap (e.g. 35 days, configurable). A provider's historical window may be shorter; backfill from official statements and show the gap.
- **Network budgets:** bounded GET retries for network/429/5xx; no blind retries of auth failures or payment/ledger mutations. Per-feed deadline, pagination bounds, helper timeout and whole process-tree termination. Keep the run lock until descendants stop. Docker exec can leave a process in a container after killing its client: use an in-container timeout or explicit job cancellation and verify it stops before enabling that job.
- **Publication:** verify uploaded bytes before exposing a new snapshot. Keep old snapshots and note revisions. Missing FX valuations block new combined publication; valid cached rates can survive a transient upstream outage. Never replace a website notes database on routine deployment.

## Recovery and maintenance

Back up the Firefly database/uploads, bank mappings/duplicate indexes, reporting overrides, site users/config, notes database with revisions, and FX history. Use consistent database backups. Keep an encrypted off-device backup according to the owner's preference. Test a restore in an isolated directory before claiming disaster recovery. Never bundle backups into a shared skill.

Keep versions pinned; take backups before updates and run acceptance checks afterward. Monitor consent/session expiries, source account changes, manual-account freshness and disk usage. The starter intentionally retains snapshots/settings backups; add a retention policy after the owner chooses recovery needs (never delete the last valid snapshot or sole note-history backup). Logs remain private and should rotate. Do not send raw financial data to a logging or monitoring service by default.
