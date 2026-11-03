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
   prefilled messages (for example `[ZTR-REELS] Halo`). On each project's settings tab also fill
   **Jam galeri** (opening hours per weekday), **Durasi kunjungan (menit)** and **Minimal
   pemberitahuan kunjungan hari yang sama (menit)**. Without gallery hours Moni finds no slots.
2. **Asumsi KPR**: the fixed and floating rates, tenors and DP per project. Without them Moni gives
   no instalment simulations.
3. **Roster Sales**: add each sales person with the projects they cover, their weekly hours and a
   linked dashboard account (so they see their own leads and get their own alerts). Moni books
   visits only into slots a rostered person is free for. A project with nobody on its roster makes
   Moni save the customer's timing and hand the chat to staff.
4. **Pengaturan**, section **WhatsApp keluar** (see the templates below).
5. **Uji Chat**: rehearse conversations. Nothing reaches WhatsApp and test leads stay out of Leads;
   it does use the Anthropic API.
6. Each sales user turns on **Aktifkan notifikasi** in the dashboard sidebar, in the browser they
   will use.

Visits are managed on **Jadwal** (the schedule, one column per sales person) and on each visit's
page, where staff move, reassign, cancel or close it. Sales users see only their own leads and
visits.

### WhatsApp templates

WhatsApp only lets us start a conversation with an approved template. Submit these two in
ChakraHQ (category `UTILITY`, language `id`), then enter their names and the **Phone number ID
ChakraHQ** in **Pengaturan > WhatsApp keluar** (fields **Template notifikasi sales** and
**Template pemberitahuan ganti sales**):

- Sales alert (one per line in the body):

  ```
  Halo Kak {{1}}, ada update kunjungan: *{{2}}*.
  Konsumen: {{3}}
  Waktu: {{4}}
  Proyek: {{5}}
  Ringkasan: {{6}}
  Detail: {{7}}
  ```

  Parameters: 1 agent name, 2 event label, 3 customer name and phone, 4 visit time (for "Kunjungan
  dialihkan ke sales lain" this is the old slot the agent no longer covers), 5 project, 6 handover
  summary ("-" when empty), 7 dashboard link.
- Reassignment notice to the customer:

  ```
  Halo Kak {{1}}, untuk kunjungan Kakak nanti akan dibantu oleh Kak {{2}} dari tim sales kami ya 😊
  ```

  Parameters: 1 customer name, 2 new sales name.

Until a template name is set, the messages that need it stay queued ("tertahan") and **Jadwal**
shows a banner linking to Pengaturan. If the first live send fails, compare the payload with
vinindo-app's template sender: whether ChakraHQ passes template messages through unchanged is not
confirmed yet.

### Web Push

Staff get Web Push alerts (hand-offs, failed replies, unverified availability, visit changes, failed
WhatsApp templates). Generate the VAPID keys once:

```sh
npx web-push generate-vapid-keys
```

Put them in `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, with `VAPID_SUBJECT` such as
`mailto:you@example.com`. Push is off while either key is empty. In production these go in
`deploy/.env` (compose passes them through; `deploy/.env.example` doesn't list them yet).

### Other API settings

All optional; the defaults are in `api/.env.example`.

| Variable | Default | What it does |
| --- | --- | --- |
| `TRUST_PROXY_HOPS` | `0` (compose: `1`) | Proxies in front of the API, so rate limits see the real client IP. |
| `MEDIA_RATE_LIMIT_PER_MIN` | `600` | Per client IP, for public `/media` files. `0` turns it off. Not wired into compose; add it there to change it. |
| `OUTBOUND_POLL_MS` | `60000` | How often due outbound WhatsApp messages are sent. `0` turns it off. |
| `SUMMARY_REFRESH_MS` | `600000` | How often summaries of quiet chats are refreshed. `0` turns it off. |
| `DASHBOARD_PUBLIC_URL` | `http://localhost:40060` | Where notification and template links open the dashboard (compose sets `https://<DOMAIN>`). |

`/webhook` has no rate limit on purpose. ChakraHQ posts every customer's message from a few
addresses, so a per-IP limit would drop real messages in a campaign burst. The HMAC check already
drops forged requests cheaply.

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
