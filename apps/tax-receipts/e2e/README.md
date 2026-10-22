# Tax Receipts e2e tests (Playwright)

Browser tests that drive the real api and web app against a freshly seeded
database.

## Running

```bash
pnpm db:dev:up                                  # the dev Postgres on :5434
pnpm --filter @gpo/tax-receipts-e2e e2e         # headless, list reporter
pnpm --filter @gpo/tax-receipts-e2e e2e:ui      # Playwright UI mode
```

Before the tests start, Playwright starts its own api on :3100 and web app on
:5174, and `global-setup.ts` rebuilds the `tax_receipts_e2e` database from
nothing: migrate, `prisma/seed.ts`, then `prisma/seed-fixtures.ts`. It takes
about 15 seconds. Your dev database on :5434 and dev servers on :3000 and
:5173 are left alone. The environment is set in `e2e-env.ts`, not read from
`api/.env`, and email stays on the `dev` adapter. Qomon is off because it is
a database setting (Admin > Qomon) that the fresh database never enables, so
every contributor is tool-owned; `global-setup.ts` also refuses to run if it
finds Qomon enabled. Set `E2E_SKIP_RESET=1` to skip the
reset while iterating on one test.

Seeded logins are `sysadmin@`, `cfo@`, `admin@`, `rules@`, `books@`,
`filer@`, and `readonly@` (all `@gpo.test`), password
`change-me-please-12345`. `tests/helpers.ts` has `signIn(page, 'cfo')` and
`pdfText(download)` for asserting what a receipt PDF prints.

## Writing tests that share one database

Tests run serially against one seeded database, reset once per run, not per
test. A test that changes shared fixture data (deactivating a seeded user,
cancelling a seeded receipt, merging seeded contacts) changes it for every
test after it. Prefer data the test creates itself (a new user, a new
contributor, a new payment), or a fixture no other test reads. Give created
records a unique name so a rerun with `E2E_SKIP_RESET=1` does not collide.

## Playwright agents

The planner, generator, and healer agents (`.claude/agents/playwright-test-*`,
from `playwright init-agents --loop=claude`) use the `playwright-test` MCP
server in the repo's `.mcp.json`, which runs against this package's config.

1. **Planner** explores the app from `tests/seed.spec.ts` (signed out, fresh
   database) and saves a Markdown plan under `specs/`.
2. **Generator** turns each plan scenario into a spec under `tests/`, one
   test per file, grouped in folders by plan section.
3. **Healer** runs the suite, debugs failures, and fixes or skips tests.

Regenerating the agent files after a Playwright upgrade overwrites
`.mcp.json` and drops the `--config` argument; put it back.
