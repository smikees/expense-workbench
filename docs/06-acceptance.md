# Acceptance checks

Create evidence in the recipient's project; do not assume the packaged validation covers their bank or hosting provider.

- Run `python tests/test_core.py`, `python tests/test_http.py --php PATH_TO_PHP`, and `node tests/reporting.cjs` if Node is available. All fixtures are fictional and isolated.
- Start the demo and inspect desktop/mobile layouts. Verify logo/latest month, filters, signed sorting, parent/child category totals, collapsible hierarchy, comparison bars/tooltips, empty data, currency labels and notes modal. No console errors or missing local assets.
- Ensure the local server binds only loopback. Unauthenticated data and private paths must be unavailable. A valid user can save a note; a stale version returns 409 and preserves the current note. Cross-origin writes fail. Confirm persistence after server restart.
- Real ledger: create asset accounts; verify account ownership, duplicate imports, refunds, income, opening balances, transfers and cross-currency legs. Reconcile an independent statement period and record history limitations. Demonstrate that a repeat sync adds no duplicate financial entries.
- Faults: malformed posting, changed description, changed amount, duplicate identity, one failed bank, page timeout, unknown account, interrupted write, missing FX rate, failed publication, concurrent note edit and lost remote notes revision. Preserve old values and isolate the correct scope; prove other safe stages continue.
- Notes: clear clarification updates only allowed reporting fields, publishes before acknowledgement, preserves the source amount/date/account/currency and skips unchanged deferred versions. A modified note becomes pending again. Source/financial proposals require separate owner review.
- Scheduling: verify one configured job, correct timezone/DST, bounded processes, no overlapping writes, fresh status receipts and quiet normal success. Check bank consent renewal and manual-account freshness.
- Optional cloud: run authenticated and unauthenticated checks against the actual origin; private/config/database/backup paths must never be downloadable. Verify HTTPS and FTPS chains, cookies, host/origin restrictions and remote notes persistence across deployments. Restore a backup in isolation.

Mark untested features explicitly in `SETUP-STATUS.md`. The starter was validated offline/locally; live banks, Docker images, DNS/TLS and hosting credentials must be tested in the recipient's own environment. Do not manufacture screenshots or coverage claims.
