# ID System Universe

Infrastructure control plane for the ID System SaaS ecosystem: connect one or
more Coolify instances, see every application's real status, logs and
deployments, and act on them (start/stop/restart/redeploy) — with a 3D
"command center" visualization on top of a real, audited backend.

Coolify stays the source of truth for infrastructure. This app only caches
what the UI needs (application list, status, deployment history) and never
duplicates Coolify's own database.

## Stack

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS ·
React Three Fiber / Three.js · Zustand · TanStack Query · Prisma 6 ·
PostgreSQL · Zod · Argon2id (`@node-rs/argon2`)

## Architecture

```
UI  →  Application Services (src/server/*)  →  Domain (src/providers/deployment/types.ts)  →  Infrastructure Providers (src/providers/deployment/coolify/*)
```

The UI never talks to Coolify directly, and never sees a Coolify API token.
Every admin action goes browser → Next.js route handler → decrypts the
token server-side → Coolify API. Adding a second provider type (Docker,
Vercel, Railway, ...) means implementing `DeploymentProvider`
(`src/providers/deployment/types.ts`) in a new folder — nothing above that
layer changes.

## Setup

```bash
npm install
cp .env.example .env   # fill in DATABASE_URL, AUTH_SECRET, CREDENTIAL_ENCRYPTION_KEY
npx prisma db push     # applies the schema to your Postgres database
npm run dev
```

Generate the two secrets:

```bash
openssl rand -hex 32     # AUTH_SECRET
openssl rand -base64 32  # CREDENTIAL_ENCRYPTION_KEY
```

**`CREDENTIAL_ENCRYPTION_KEY` encrypts every stored Coolify token.** It lives
only in the environment, never in the database. Losing it makes stored
tokens permanently undecryptable — back it up outside the database.

First run: visiting `/` with no user in the database redirects to
`/onboarding`, which creates the admin account and (optionally) connects
your first Coolify instance. Bootstrap permanently disables itself once any
user exists.

## Database

Prisma schema: `prisma/schema.prisma`. This project uses `prisma db push`
rather than versioned migrations (matching the pattern already in use
elsewhere in this Second Brain's projects) — a genuine limitation worth
promoting to real migrations before this handles anything you can't afford
to `db push` your way out of.

## Coolify integration

`src/providers/deployment/coolify/coolify-client.ts` centralizes every
Coolify REST endpoint this app calls (`/api/v1/...`). **This environment's
network egress was blocked from reaching `coolify.io` while building this**,
so the endpoint list was written from documented/trained knowledge of
Coolify's public API rather than a live check — it was validated end-to-end
against a local mock server (start/stop/restart/redeploy/logs/deployments,
including the async deployment-tracking loop), but *not* against a real
Coolify instance. If something doesn't match your version, that one file is
where to fix it.

Deployment tracking is pull-based: the frontend polls faster while a
deployment/logs panel is open and backs off when it's closed, and each poll
reconciles the real deployment status from Coolify rather than assuming
success from an HTTP 200.

## Security notes

- Coolify tokens: encrypted at rest (AES-256-GCM), decrypted only server-side, never sent to the browser (`src/server/crypto/encryption.ts`).
- Passwords: Argon2id (`src/server/auth/password.ts`).
- Sessions: random token in an `httpOnly`, `sameSite=lax` cookie; only its SHA-256 hash is stored (`src/server/auth/session.ts`).
- SSRF: provider base URLs are validated (protocol, no embedded credentials, no cloud metadata endpoints) before being stored or called (`src/server/security/ssrf.ts`).
- RBAC: `ADMIN` / `OPERATOR` / `VIEWER` permission table in `src/server/auth/rbac.ts` — every route checks `can(role, permission)`, nothing branches on `role === "ADMIN"` directly. Only `ADMIN` accounts can currently be created (via bootstrap); creating `OPERATOR`/`VIEWER` users is a natural next step once user management ships.
- Every administrative action writes an `AuditEvent` (never including tokens/secrets) and a `UniverseEvent` for the activity feed.
- Concurrent conflicting actions on the same application are rejected with a clear error rather than racing.

## Dev/build

```bash
npm run lint
npx tsc --noEmit
npm run build
```

All three pass as of this commit. `npm run build` was also smoke-tested end
to end against a local mock Coolify server (auth, provider CRUD, sync,
start/stop/restart, redeploy with real async deployment reconciliation,
logs, audit trail) — see the Second Brain entry for this project for details.

## Docker / Coolify deployment

```bash
docker build -t id-system-universe .
docker run -p 3000:3000 --env-file .env id-system-universe
```

Multi-stage Debian-slim build (`output: "standalone"`), with the Prisma CLI
installed in its own stage since the standalone bundle only carries the
query engine, not the schema engine — see `Dockerfile` and
`docker-entrypoint.sh`. The entrypoint runs `prisma db push` (no
`--accept-data-loss`) before starting the server, so a destructive schema
change fails the container rather than silently dropping data; Coolify keeps
the previous version running until the health check on the new one passes.

`/api/health` checks only this app's own database connectivity — never
Coolify — so a Coolify outage never fails this container's health check.

**Not verified in this environment:** no Docker daemon was available here,
so the image itself was not actually built/run — only reviewed against the
same pattern already proven for another project in this Second Brain. Build
and run it once before trusting it in production.
