# Deploying the Tax Receipts tool (staging)

Everything needed to run the tool from container images. The working
reference is [`docker-compose.staging.yml`](docker-compose.staging.yml): it
brings up the whole stack on one host, and its service definitions are the
spec for a managed deploy (Cloud Run, GKE, or similar).

## Topology

```
HTTPS load balancer
  └─> web  (nginx, :8080)  static SPA; /api/* -> api with the /api prefix stripped
        └─> api (Node, :3000)  Fastify API + in-process email dispatcher
              ├─> PostgreSQL 17
              └─> /data volume  receipt PDFs and print batches
migrate (one-off, before each api rollout): prisma migrate deploy
```

Only `web` needs to be reachable from outside. The browser talks to a single
origin; the API is never called cross-origin.

## Images

All three come from [`Dockerfile`](Dockerfile), built with the **repo root**
as context (the pnpm workspace spans `apps/tax-receipts/*` and `packages/*`):

```bash
docker build -f apps/tax-receipts/Dockerfile --target api       -t tax-receipts-api .
docker build -f apps/tax-receipts/Dockerfile --target api-tools -t tax-receipts-api-tools .
docker build -f apps/tax-receipts/Dockerfile --target web       -t tax-receipts-web .
```

| Target | Runs | Port | Notes |
|---|---|---|---|
| `api` | `node dist/server.js` | 3000 | Production deps only, runs as `node`. Health: `GET /health` (503 when the database is down). |
| `api-tools` | `prisma migrate deploy` | none | One-off job. Needs only `DATABASE_URL`. Exits 0 when the schema is current. |
| `web` | nginx | 8080 | Health: `GET /healthz`. Set `API_UPSTREAM` to the api's internal URL (default `http://api:3000`). |

## Rollout order

1. Run `api-tools` (migrations) against the target database; stop on failure.
2. Roll out `api`.
3. Roll out `web`.

The existing `prisma migrate deploy` command installs both the application
tables and pg-boss's separate `pgboss` namespace, including the sweep queue.
The queue SQL is generated from the pinned pg-boss version and committed as a
Prisma migration. Matching installations from the former queue setup command
are adopted without deleting jobs. An incompatible existing version fails
the migration.

Run migrations before rolling out API and worker at the same code version.
Runtime services use `migrate: false` and never migrate the queue schema.
The deployment migration role needs permission to create the `pgboss`
namespace; runtime roles need access to its existing data and functions.
For pg-boss upgrades, generate and review a new SQL migration using the
upstream migration plans, and test both a fresh install and an upgrade.
Keep pg-boss objects outside the Prisma application data model.

Migrations are forward-only and must run before the api that needs them.

## Constraints

- **Run exactly one `api` instance.** Generated PDFs are stored on local disk
  (`ARTIFACT_STORAGE_DIR`, default `/data/artifacts`), and the email
  dispatcher runs inside the api process. Object storage and a separate
  worker are later work.
- **`/data` must be a persistent volume** and backed up alongside the
  database. Losing it loses issued receipt PDFs, which the database still
  points at.
- **HTTPS in front is required.** With `NODE_ENV=production` the session
  cookie is `Secure`. The api trusts `X-Forwarded-Proto` (`TRUST_PROXY=true`),
  and `web` passes the load balancer's value through.
- Receipt data is never hard-deleted (a regulatory requirement), so treat the
  staging database as long-lived and back it up like production.

## Environment variables (`api`)

Required:

| Name | Value |
|---|---|
| `DATABASE_URL` | `postgresql://USER:PASSWORD@HOST:5432/DB?schema=public` (URL-encode special characters in the password). Also needed by `api-tools`. |
| `SESSION_SECRET` | At least 32 random characters (`openssl rand -base64 48`). Secret. |
| `PUBLIC_WEB_URL` | The public HTTPS origin, e.g. `https://tax-receipts-staging.example.org`. Used in links in donor email. The api refuses to start without it when `NODE_ENV=production`. |
| `NODE_ENV` | `production` |
| `TRUST_PROXY` | `true` |

Set by the image (override only with reason): `PORT=3000`, `HOST=0.0.0.0`,
`ARTIFACT_STORAGE_DIR=/data/artifacts`.

Optional:

| Name | Default | Notes |
|---|---|---|
| `EMAIL_LIVE_SENDING_ALLOWED` | `false` | **Keep `false` in staging.** Every send is then simulated end to end. Production only. |
| `EMAIL_PROVIDER` | `dev` | `resend` needs `RESEND_API_KEY` and `EMAIL_FROM`. |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | unset | Secrets. Webhook URL: `https://<host>/api/webhooks/email`. |
| `EMAIL_FROM`, `EMAIL_REPLY_TO` | placeholder, unset | Sender on a domain verified in Resend. `EMAIL_FROM` is required with `EMAIL_PROVIDER=resend`. |
| `EMAIL_RATE_PER_SECOND`, `EMAIL_DAILY_LIMIT`, `EMAIL_DISPATCH_INTERVAL_MS` | 5, none, 15000 | Send throttling. |

The api validates its environment at start and exits non-zero with a list of
every missing or invalid variable, so a misconfigured container fails its
first start instead of serving traffic.

## First run: users

There is no sign-up. To load the evaluation data set (the Ontario riding
directory, periods, limits, and test users such as `sysadmin@gpo.test` with
the shared dev password from `api/prisma/seed.ts`), run once after
migrating:

```bash
docker run --rm -e DATABASE_URL=... tax-receipts-api-tools pnpm exec tsx prisma/seed.ts
```

It is idempotent. Change the seeded passwords straight away, or deactivate
those accounts, on any environment reachable from the internet.

## After deploying: Qomon

Qomon is not configured through the environment. A new deployment starts
with Qomon off: the tool owns its contributors (D13), Qomon-linked ones
cannot be edited, and the mirror sweep refuses. To connect it, sign in as a
system administrator and open **Admin > Qomon**: enter the API key (and the
base URL if it is not `https://incoming.qomon.app`), tick **Enabled**, and
save with a reason. It takes effect on the next request. On staging, use a
sandbox space, never the production one.

An environment that used to set `QOMON_API_KEY` must be configured this way
once after upgrading; the variable is no longer read.

## Running the stack with Compose

```bash
cd apps/tax-receipts
cp .env.staging.example .env.staging     # fill in; it is gitignored
docker compose --env-file .env.staging -f docker-compose.staging.yml up -d --build
docker compose --env-file .env.staging -f docker-compose.staging.yml run --rm migrate pnpm exec tsx prisma/seed.ts   # optional, once
```

The app is then on `http://localhost:8080`. Over plain http, set
`NODE_ENV=development` in `.env.staging` or the browser will not get a
session cookie and login fails.

## Sweep worker

Run a separate process from the same `api` image with the command
`node dist/sweeps/worker.js`. Use one replica and supply `DATABASE_URL`
pointing at the same database as the API. No HTTP ingress, session secret, or
email settings are needed. When using this image for a worker, disable its
API HTTP health check (`--no-healthcheck` with Docker); worker liveness is its
running process after the `Sweep worker ready` message. Startup verifies
database connectivity, pg-boss compatibility, and the installed queue.
More detailed worker health and crash recovery are follow-up work.

Finished queue jobs are retained for 30 days by default. Set
`SWEEP_JOB_RETENTION_DAYS` on the API to a positive whole number of days
(maximum 24,855) to change the policy for newly queued jobs. Invalid values
fail runtime startup without exposing configuration values. Existing jobs keep
their original retention policy. Worker queue maintenance removes expired
internal jobs, while application sweep history and results remain permanent.
Unprocessed queued jobs expire after a fixed 30 days independently of this
setting.
The worker disables scheduling. SIGINT or SIGTERM allows 30 seconds to drain;
configure a termination grace period greater than 30 seconds. A sweep failure
is recorded safely and stops the worker with exit code 1. Abrupt termination
can leave application runs RUNNING until recovery tooling is added; investigate
before manually restarting work.

Locally, from the repository root:

```bash
pnpm --filter @gpo/tax-receipts-api migrate:deploy
pnpm --filter @gpo/tax-receipts-api worker:dev
```

The API and Vite run separately using `pnpm dev`. Once both API and worker
are running, queue a party incremental sweep under **Admin > Sweep**.
Riding queue targets, schedules, retries, and history browsing are
follow-up slices; existing synchronous controls remain temporarily available.
Avoid running synchronous sweeps while queued work is active.
