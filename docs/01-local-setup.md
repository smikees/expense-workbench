# Local setup first

## Outcome

A password-protected dashboard on loopback, working notes, then a separate Firefly ledger and importer. The recipient needs no domain, FTP account or paid hosting to start.

## Discover and prepare

Ask for OS, exact banks/countries, start date, timezone and ownership/shared-account scope. Explain that the default monthly headline is expenses minus refunds minus external income; expense category totals are expenses minus refunds. Offer to adjust that accounting presentation if the user prefers spending-only. Do not carry assumptions about partners, support, loans or bank cards into a new installation.

Use a new user-chosen workspace. Check disk space and available ports. The starter uses 8787, Firefly 8080 and importer 8081. If occupied, update URLs consistently. Use official platform packages for Python 3.11+ and PHP 8.3+ with SQLite3 and mbstring. Check `php -m`. Do not download binaries from arbitrary mirrors or copy another person's runtime/configuration.

Clone this repository into a new directory. Do not copy an initialized installation or private data.

From the new project:

```text
python tests/test_core.py
python tests/test_http.py --php PATH_TO_PHP
python scripts/setup.py --php PATH_TO_PHP --demo
python scripts/serve.py --php PATH_TO_PHP
```

If PHP is on PATH, omit `--php`. Setup asks for a fresh password in the terminal; it stores only a hash. Open `http://127.0.0.1:8787`. Keep the process running while testing. The local PHP development server is for loopback use; do not expose it to a LAN or the Internet. On Windows launch long-running helpers hidden when creating a service/task, while keeping logs private. On macOS/Linux use an appropriate user service when the user wants persistence.

## Move from demo to real data

Prefer a second new project for the real installation, initialized without `--demo`. If retaining the same project, make a backup, set `private/settings.json` `mode` to `live`, set the intended `scope_start`, and ensure no real notes were written against demo IDs. Start a fresh notes database via an explicit migration if necessary; never silently blend demo IDs with Firefly IDs. The sync adapter discards the marked demo snapshot on the first real import. Demo transactions never enter Firefly.

Install Firefly/Data Importer using the official Docker instructions and `compose.yaml`. Select current compatible pinned image versions/digests; blank variables intentionally prevent an accidental unpinned install. Generate unique database credentials and APP_KEY according to the installed release; store them in ignored `.env`. Finish Firefly onboarding and create asset accounts before importing. The dashboard and Firefly can have different logins; they do not share passwords.

Set the new Firefly personal access token privately in `private/settings.json`; configure the importer with its own local API access. The host uses loopback; containers use `http://firefly:8080`. Run one real import only after mapping/reconciliation checks in the bank reference. Run `python scripts/workbench.py sync`, then refresh the dashboard. Set timezone in both site config and worker settings. The default UTC is intentional and must not be silently replaced with another person's locale.

Record the recipient's OS, versions, URLs, data directories, startup commands and actual test results in a new `SETUP-STATUS.md`. Keep credentials out of it. Use operating-system filesystem permissions for both private directories (owner-only on a single-user computer); Windows chmod alone is not an ACL boundary.
