# vistaland-chatbot

Moni, the WhatsApp AI sales agent for Vista Land, and the dashboard that tracks its leads and site
visits. `api/` is the Fastify + Postgres backend; `dashboard/` is the Next.js staff app. They are
two independent packages, each with its own lockfile. Design:
`docs/superpowers/specs/2026-10-30-moni-sales-agent-design.md`.

## Local development

Needs Node 24 and Postgres 17.

```sh
npm run db:up        # Postgres on localhost:54329 with vistaland + vistaland_test (Docker)
npm run setup        # npm install in api/ and dashboard/
cp api/.env.example api/.env                    # fill API_SECRET_KEY, SEED_ADMIN_*, VLES_API_KEY
cp dashboard/.env.example dashboard/.env.local  # AUTH_SECRET, and the same API_SECRET_KEY
npm --prefix api run db:migrate
npm --prefix api run db:seed                    # projects + first admin; safe to re-run
npm run dev                                     # API :50060, dashboard http://localhost:40060
npm test                                        # API tests (need the test DB) + dashboard tests
```

Any Postgres works: point `DATABASE_URL` and `TEST_DATABASE_URL` in `api/.env` at it.

The API syncs VLES every 15 minutes when `VLES_API_KEY` is set (`VLES_SYNC_INTERVAL_MS=0` turns the
timer off; "Sinkronkan sekarang" on the Stok Unit page still works). **The keychain item
`vles-api-key-dev` holds a production key** — the VLES dev server rejects it. It is read-only.

Tests never call VLES; they replay `api/tests/fixtures/vles/`. To re-record them (read-only GETs,
no customer data):

```sh
cd api && VLES_API_KEY=$(security find-generic-password -s vles-api-key-dev -w) npx tsx scripts/record-vles-fixtures.ts
```

## Deploy (cloud VM, Docker Compose)

Four services: `postgres`, `api` (runs migrations, then starts), `dashboard`, and `caddy` (TLS on
`DOMAIN`). Caddy exposes only `/webhook*`, `/media/*` and `/health` from the API; everything else
is the dashboard. `/api/v1` stays on the compose network.

```sh
cp deploy/.env.example deploy/.env    # fill every value; see the comments in the file
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api node dist-scripts/seed.js
curl https://$DOMAIN/health
```

The seed creates the first admin only while no staff exist, so re-running it is safe. Rehearse
locally with `DOMAIN=localhost` (Caddy issues a local certificate; use `curl -k`).
