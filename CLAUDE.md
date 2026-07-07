# GPO Monolith

Grab-bag repo for GPO operational assets that do not have a home of their own: Cypress e2e tests against the live sites, Qomon API specs, tax-receipt tooling, and one-off scripts. There is no single build or runtime.

## Repo map

```
gpoAutoTests/        Cypress e2e suite, runs against https://staging.gpo.ca
                     (weekly smoke run + full run via GitHub Actions)
docs/qomon/          OpenAPI 3.x specs for the Qomon API (CRM platform)
google-workspace/    tax_receipts_split_main_into_eo_reports.js (Apps Script)
scripts/generate_tax_receipt_pdfs/  Tax-receipt PDF generation (generate.mjs + template.pdf)
scripts/send_email.mjs              Email sending helper
```

## gpoAutoTests (Cypress)

- Config: `gpoAutoTests/cypress.config.ts` — `baseUrl` is **staging.gpo.ca**; these tests exercise a deployed site, not local code.
- Run locally: `cd gpoAutoTests && npx cypress run` (or `--env grepTags=@smoke`).
- Lint: `cd gpoAutoTests && ./node_modules/.bin/eslint --fix .` (in sandboxes, `npx eslint` mis-resolves to an incompatible global ESLint; always use the local binary)
- CI: `.github/workflows/e2e_smoke_tests.yml` (weekly + manual) and `e2e_all_tests.yml`. Trigger these to validate test changes rather than hitting staging from a sandbox.
- In cloud sandboxes the Cypress binary is not downloadable and staging may be unreachable — treat e2e runs as CI/local-only; validate spec changes with eslint + tsc.

## Conventions

- The Qomon OpenAPI specs in `docs/qomon/` are reference documentation for integrations elsewhere (gpo-ca, gpo-data); update them from Qomon's published specs, do not hand-tune them to match observed behaviour.
- Tax-receipt tooling here pairs with the annual workflow in `gpo-data/reports/tax-receipts/` — check that repo before changing formats.
