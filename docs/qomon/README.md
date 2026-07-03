# Qomon API — OpenAPI / Swagger specs

OpenAPI 3.0/3.1 specifications for [Qomon](https://qomon.com)'s API, which the
GPO uses as its CRM / supporter-activation platform.

- **Base URL:** `https://incoming.qomon.app`
- **Auth:** HTTP bearer token. Create an API key from
  [Qomon settings → extensions → connect](https://qomon.app/settings/extensions/connect).

## Files

| File | Title | Summary |
|------|-------|---------|
| `incoming-openapi3.0.yaml` | Qomon Public API Documentation | Contacts (create / upsert / search / KPI) and Forms. |
| `incoming-actions-openapi3.0.yaml` | Qomon public API – Actions | Read actions (canvassing, calling, events, …) with aggregates. |
| `incoming-imports-openapi3.0.yaml` | Qomon Import API | Bulk contact import from CSV (create → configure → map → enqueue → resolve). |
| `users-openapi3.0.yaml` | Qomon Users API | Invitations, users, roles, and teams within a space. |
| `donation-membership-transaction-openapi3.0.yaml` | Qomon Transaction Bundles API | Transactions, memberships, donations, and fundraising settings. |

## Provenance

Received by email (thread *"Qomon <> GPO call"* with Clare Atreo,
`clare@qomon.com`):

- **2026-05-07** — `openapi-qomon.zip`, described as the "downloadable Swagger
  files". Contains the Public API, Actions, Users, and Transaction Bundles specs.
- **2026-06-01** — `incoming-imports-openapi3.0.yaml`, sent separately as "the
  more robust Import API".

> ⚠️ Per Qomon, the Import API (and Transaction Bundles) documentation is **not
> currently public**. Treat these specs as shared in confidence; do not
> redistribute outside the GPO.

These are point-in-time snapshots. Qomon iterates quickly, so the live API may
have drifted — re-request the latest specs from Qomon when accuracy matters.
