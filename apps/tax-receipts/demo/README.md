# EO demo companion

`eo-demo-guide.html` is the presenter's companion for the live demo of the
Elections Ontario Evaluation Tool: a narrow, single-column page meant to sit
beside the app, with a step-by-step script for each evaluation row, the
logins to use, and the values to type.

It is one self-contained file (only Google Fonts load from outside); open it
straight from disk in a browser. It expects the data from
`api/prisma/seed-demo.ts`:

```bash
pnpm dev                                          # from the repo root
pnpm --filter @gpo/tax-receipts-api db:seed
pnpm --filter @gpo/tax-receipts-api db:seed:fixtures
pnpm --filter @gpo/tax-receipts-api db:seed:demo
```

When the demo seed or the app's screens change, update the guide to match.
