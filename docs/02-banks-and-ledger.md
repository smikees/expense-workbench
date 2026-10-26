# Banks and the source ledger

Firefly III is the source ledger. Use the official Data Importer for bank/provider and file imports where the installed version supports them. The bundled reporting worker reads the Firefly API and never initiates bank payments.

## Enable Banking onboarding

Check the current official tutorial and exact institution/country. The control-panel account linkage and the importer's consent are separate steps. In restricted personal access, first link every intended account in the provider portal. Then authorize the importer and map returned accounts to Firefly asset accounts. A bank's approval screen may hide the account selector behind its selected-account row; inspect it and verify the returned account list rather than repeating approvals blindly. The user must approve bank access and terms themselves. Use fresh application credentials and a registered callback; configure trusted local HTTPS when the provider requires it.

The official documentation currently has older pages that disagree about Enable Banking support. Verify the installed release, its source/CLI capabilities and a real consent flow; use the dedicated Enable Banking tutorial. Do not assume all versions can renew or replay its sessions through CLI.

## Ledger mapping

Build a private inventory of owned accounts, currencies, provider IDs and account identifiers. Include shared accounts only with the owner's requested household scope. Never match ownership solely by a person's name. Create asset accounts before the first import. Identify opening balances independently; do not treat them as income. Include only booked activity in expense totals. Preserve pending items separately until booked.

Run a small period first, save the import configuration privately, and reconcile opening + inflows − outflows = closing for each currency/account when balances are comparable. Card available balance is not automatically a booked ledger balance. Ask about cash-balance versus investment-value scope for brokers.

Own-account transfers must be a single transfer with correct legs, not two expenses/income entries. Check both sides, currency, dates and references. Cross-currency transfers need both actual currency amounts and recorded rates/fees. Do not infer a payment is a transfer just because its amount matches another entry. Owner-to-shared-account funding stays excluded; merchant purchases and owner-confirmed onward household support follow the recipient's rules.

Refunds should use the Firefly tag `refund` on incoming deposits or an explicit reporting override. Refunds may offset a purchase from an earlier month. Ambiguous incoming money remains income with a review question until clarified. Do not use a merchant name alone to infer every credit's financial meaning.

## Automatic versus manual feeds

Export the new installation's importer configuration after a successful import. Test the installed CLI with an explicit argv command such as `docker compose exec -T importer php artisan importer:import /import/BANK_CONFIG.json`. The official CLI documents generic file/provider imports; **do not assume that command works unattended for a specific Enable Banking session until verified**. Store a separate job per independently safe feed in `private/settings.json` `import_jobs`, initially with `import_jobs_verified: false`. JSON configuration and raw logs are sensitive.

If the selected importer cannot safely replay that provider, implement the read-only provider adapter described in the daily-operations reference; the starter does not include universal bank normalization. Keep the feed manual until it passes those checks. Consent expiry still requires human renewal.

For unsupported banks/brokers, use official CSV/camt exports. Save format mappings and stable duplicate identities. For PDFs/screenshots, create a reviewable normalized file and reconcile totals before import. Never install an unofficial bank-login scraper to pretend a manual bank is connected. Keep manual accounts in coverage with an honest imported-through date. Access eligibility/pricing/history windows depend on the recipient's country and account product; verify current terms rather than promising permanent free access.
