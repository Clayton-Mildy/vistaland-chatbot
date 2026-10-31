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

## Moni on WhatsApp

Moni answers WhatsApp messages that ChakraHQ forwards to `POST /webhook`. It needs:

- `ANTHROPIC_API_KEY` (and optionally `MONI_MODEL`, default `claude-opus-5-5`, and `MONI_EFFORT`,
  default `medium`). Without a key every conversation is handed to staff instead of answered.
- `CHAKRA_PLUGIN_ID`, `CHAKRA_ACCESS_TOKEN`, `CHAKRA_WEBHOOK_SECRET`, and in ChakraHQ a webhook to
  `https://<DOMAIN>/webhook`. Webhooks with a wrong signature are acknowledged and dropped.
- `PUBLIC_BASE_URL`: WhatsApp downloads materials from `PUBLIC_BASE_URL/media/<file>`, so it must
  be the public https origin.

Before going live, fill in the dashboard as admin:
1. **Proyek & Materi**: bedrooms for each house type (Moni cannot filter types without them), the
   latest flyer, house video and promo image, promo wording, and the ad tags used in Click-to-WhatsApp
   prefilled messages (for example `[ZTR-REELS] Halo`).
2. **Asumsi KPR**: the fixed and floating rates, tenors and DP per project. Without them Moni gives
   no instalment simulations.
3. **Uji Chat**: rehearse conversations. Nothing reaches WhatsApp and test leads stay out of Leads;
   it does use the Anthropic API.

Moni pauses on a conversation (a takeover, default 24 hours, see **Pengaturan**) when it hands off,
when a reply fails its checks, when staff reply from the dashboard, and when staff reply from
ChakraHQ's own inbox. **Leads** flags hand-offs nobody has answered yet as "Perlu ditangani".

To try the webhook locally without ChakraHQ:

```sh
cd api && NODE_ENV=development SKIP_HMAC_IN_DEV=true npm run dev
curl -X POST -H 'content-type: application/json' --data @tests/fixtures/chakra/inbound-text.json localhost:50060/webhook
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
