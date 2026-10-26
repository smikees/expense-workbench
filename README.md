# Expense Workbench

A local-first personal finance dashboard with monthly comparisons, category breakdowns, recurrent payments and transaction notes. Run it on your own computer, connect your own Firefly III ledger, and optionally publish a password-protected web copy.

The repository includes the dashboard's layout, colours, icons, typography and note editor. It starts with **no real accounts, transactions, credentials, merchant rules or hosting destination**. Demo records are generated from explicitly fictional examples.

## Start locally

Install Python 3.11+ and PHP 8.3+ with `sqlite3` and `mbstring`. Node.js is optional for the frontend tests. No Python packages or frontend build step are required.

```sh
git clone https://github.com/smikees/expense-workbench.git
cd expense-workbench
python tests/test_core.py
python tests/test_http.py --php php
python scripts/setup.py --demo
python scripts/serve.py
```

Open **http://127.0.0.1:8787**. Setup asks for a password and stores only a password hash; the default username is `owner`. Supply `--user YOUR_NAME` to setup to change it. The password must have at least 12 characters. On Windows, `py` may replace `python`; pass `--php "C:/path/to/php.exe"` to setup, serve and the HTTP tests when PHP is not on PATH. Keep the server running. It binds to loopback and is not an Internet production server.

## Use your own finances

Use a second clean clone initialized **without `--demo`**. Follow [local setup](docs/01-local-setup.md) and [banks and ledger](docs/02-banks-and-ledger.md):

1. Install official Firefly III and its Data Importer. The supplied `compose.yaml` deliberately requires you to select compatible pinned images and generate fresh secrets in ignored `.env`.
2. Import statements or authorize your bank through the importer's supported providers. Bank support depends on country/account type; bank passwords, MFA and consent stay with you.
3. Configure `private/settings.json` with your local Firefly URL/token, history start and timezone. The reporting adapter reads Firefly through GET requests; it never connects to your bank directly.
4. Run `python scripts/workbench.py sync`, then refresh the dashboard.
5. Verify transfer mapping, duplicate prevention and reconciliation before enabling a scheduled importer. See [daily operations](docs/04-daily-operations.md).

**Bank automation is a setup step, not preconfigured magic.** This repository bundles no bank credentials, consents or account-specific ingestion scripts. The included worker isolates changed Firefly records for review, retains old snapshots, retries safe reads and checks note revisions. Provider-specific import resilience must be verified separately using the documented contract.

## Features

- Monthly chart with category comparisons, signed sorting, search and filtered CSV export.
- Food, Utilities, Transport and Travel breakdowns, with a consistent category palette and locally bundled icons.
- Recurrent-payment buckets, search, charge history and notes for confirmation candidates.
- Persistent transaction notes, a Needs review queue and version-checked acknowledgements.
- EUR/native currency views and combined EUR reporting using historical ECB rates.
- Own-account transfers excluded; monthly net outflow is expenses minus refunds minus external income. Expense categories deduct refunds only. Confirm this reporting policy during setup.
- Authenticated local dashboard, optional HTTPS hosting, and private backups/status.

The category vocabulary is a generic starting point. Rules are empty until you configure your own; no original household classifications or personal decisions are included. The starter supports currencies with two decimal places.

## Ask Codex or Claude to help

Open this checkout in a filesystem-enabled coding assistant and say:

> Read AGENTS.md and docs/01-local-setup.md. Help me run the demo locally, then configure a separate real-data installation for my banks. Keep secrets private and ask before bank consent or publishing.

The [setup guide](docs/01-local-setup.md), [reporting and notes](docs/03-reporting-and-notes.md), [optional hosting](docs/05-optional-hosting.md) and [acceptance checklist](docs/06-acceptance.md) provide the implementation playbook. Hosting is optional; banks and the main ledger can remain on your computer.

## Validate changes

```sh
python tests/test_core.py
python tests/test_http.py --php php
node tests/reporting.cjs
python scripts/check-public-tree.py
```

Tests use synthetic data and temporary installations. Never run maintenance against an existing ledger to test a code change. CI runs these checks without secrets or bank access.

## Privacy and licensing

`private/`, `site/.private/`, `.env`, imports, databases, keys and backups are ignored. **Gitignore is only a safety net:** inspect staged files before every push; never publish an initialized project or financial screenshots. See [SECURITY.md](SECURITY.md).

Application code is MIT licensed. Bundled fonts/icons/chart code retain their upstream licences; see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Firefly III and its Data Importer are installed separately and retain their own licences.
