# Milestone 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running two-package repo with Postgres, staff login, a VLES sync that keeps a local copy of units, types, promos, mortgage banks and payment schemes, and a dashboard "Stok Unit" page — deployable with Docker Compose.

**Architecture:** `api/` (Fastify 5 + Drizzle + Postgres) owns data and background jobs; `dashboard/` (Next.js 16 + NextAuth credentials) is a server-rendered client of the API and authenticates to it with a shared secret, so the browser never calls the API directly. The VLES sync always calls list endpoints with `updated_since` (an early epoch on the first run) — only those responses carry `sync.server_time` and tombstones — so one code path handles first and later runs. Payment schemes come from `/units/{id}` for units that are for sale.

**Tech Stack:** Node 24, TypeScript ~5.8 (ESM, Node16 resolution), Fastify 5, drizzle-orm ^0.43 / drizzle-kit ^0.31, pg ^8.13, zod ^4 (api) / ^3 (dashboard), bcryptjs ^3, vitest ^3, Next.js ^16, next-auth 5.0.0-beta.28, React 19, Tailwind 3.4, Docker Compose, Caddy 2.

**Spec:** `docs/superpowers/specs/2026-10-30-moni-sales-agent-design.md` (sections 2.2, 3, 4.1, 4.2 `projects`, 4.5, 7 "Unit stock", 8 VLES rows, 9, 10 milestone 1).

**Port reference:** `/Users/claytonmildy/WidaProject/FDE Projects/vinindo-app` — files marked "port" are copied from there and trimmed to what the task needs.

## Global Constraints

- Two independent packages, `api/` and `dashboard/`, each with its own `package.json` and lockfile; no npm workspaces.
- Node `>=24.0.0` in both `engines`; `.nvmrc` = `24`.
- ESM everywhere in `api/` (`"type": "module"`); relative imports end in `.js`.
- Ports: API **50060**, dashboard **40060**, dev Postgres **54329**.
- API responses use the envelope `{ data, error, meta? }`; errors are `{ data: null, error: '<CODE>' }`.
- Dashboard → API auth: `Authorization: Bearer <API_SECRET_KEY>`; the key is server-only and never reaches the browser.
- All timestamps are `timestamptz`; anything shown to people is formatted in `Asia/Jakarta` with the suffix `WIB`.
- Dashboard UI text is Bahasa Indonesia.
- VLES is read-only; production base URL `https://vles.vistalandapp.com/api/v1/integration`. Tests never call the network — they use recorded fixtures in `api/tests/fixtures/vles/`. The client stays at or under `VLES_MAX_REQ_PER_MIN` (default **100**; the VLES limit is 120).
- The VLES API key is never logged and never included in an error message.
- Roles: `admin` and `sales` only.
- Commit after every task with `git add -A && git commit -m "<message>"`, on the currently checked-out branch.

## Review Focus

1. **VLES rejects the key mid-sync (401) or withdraws an endpoint** → that endpoint records `last_error`, keeps its existing rows, the other endpoints still sync, and the stock page shows the error. Test: Task 6 `one endpoint failing does not stop the others or delete rows`.
2. **Sync interrupted between pages (restart, timeout)** → `last_server_time` only advances after the last page, so the next run repeats from the old point; upserts are idempotent. Test: Task 6 `failure on page 2 keeps the previous server_time`.
3. **VLES adds an area no project lists** (a new cluster) → its units appear under "Area VLES belum dipetakan", not inside any project's counts. Test: Task 7 `units in an unmapped area are reported as unassigned`.
4. **An available unit has no price** (`selling_price: null`) → counted as available, excluded from min/max, reported as `unpricedAvailable`. Test: Task 7 `null price is counted but not used for min/max`.
5. **A unit stops being for sale** → its payment schemes disappear on the next scheme refresh, so later milestones never quote a stale scheme. Test: Task 6 `refreshSchemes removes schemes of units no longer for sale`.

---

## File Structure

```
vistaland-chatbot/
├── package.json                 root convenience scripts (setup, db:up, test, dev)
├── .gitignore  .nvmrc  .dockerignore  README.md
├── docker-compose.dev.yml       dev Postgres 17 on 54329 (+ test DB)
├── deploy/
│   ├── dev/init-test-db.sql     creates vistaland_test
│   ├── docker-compose.yml       production: postgres, api, dashboard, caddy
│   ├── Caddyfile
│   └── .env.example
├── api/
│   ├── package.json  tsconfig.json  vitest.config.ts  drizzle.config.ts  .env.example  Dockerfile
│   ├── scripts/ migrate.ts  seed.ts  record-vles-fixtures.ts
│   ├── src/
│   │   ├── index.ts             boot: config, app, background jobs
│   │   ├── app.ts               buildApp(): Fastify instance + routes
│   │   ├── config.ts            env schema
│   │   ├── db/ client.ts  schema/{index,system,catalog,vles}.ts  migrations/
│   │   ├── middleware/apiSecret.ts
│   │   ├── repositories/ projects.ts  staff.ts
│   │   ├── routes/ staff.ts  vles.ts  stock.ts
│   │   ├── vles/ types.ts  client.ts  mappers.ts  repository.ts  sync.ts
│   │   └── stock/summary.ts
│   └── tests/ setup/migrate.ts  helpers/{db,vles}.ts  fixtures/vles/*.json  *.test.ts
└── dashboard/
    ├── package.json  tsconfig.json  next.config.ts  tailwind.config.ts  postcss.config.js  vitest.config.ts  Dockerfile  .env.example
    ├── proxy.ts                 auth gate + admin-only paths
    ├── lib/ auth.ts  session.ts  format.ts  api/{client,stock,staff,vles}.ts
    ├── actions/ stockActions.ts  staffActions.ts
    ├── types/next-auth.d.ts
    ├── components/layout/Sidebar.tsx
    ├── app/ layout.tsx  globals.css  api/auth/[...nextauth]/route.ts
    │   ├── (auth)/login/page.tsx
    │   └── (dashboard)/ layout.tsx  page.tsx  stock/page.tsx  staff/{page,StaffClient}.tsx
    └── tests/format.test.ts
```

---

### Task 1: API scaffold, config and health check

**Files:**
- Create: `package.json`, `.gitignore`, `.nvmrc`, `README.md` (title + one paragraph; filled in Task 10), `docker-compose.dev.yml`, `deploy/dev/init-test-db.sql`
- Create: `api/package.json`, `api/tsconfig.json` (port vinindo's verbatim), `api/vitest.config.ts`, `api/.env.example`
- Create: `api/src/config.ts`, `api/src/app.ts`, `api/src/index.ts`
- Test: `api/tests/config.test.ts`, `api/tests/health.test.ts`

**Interfaces:**
- Produces: `parseConfig(env: Record<string, string | undefined>): Config` (throws one `Error` listing every bad key), `getConfig(): Config` (memoised `parseConfig(process.env)`), `type Config` with keys `NODE_ENV` (`development|test|production`, default `development`), `PORT` (default `50060`), `LOG_LEVEL` (default `info`), `DATABASE_URL` (url, required), `API_SECRET_KEY` (min length 32, required), `VLES_BASE_URL` (default `https://vles.vistalandapp.com/api/v1/integration`), `VLES_API_KEY` (default `''` = sync off), `VLES_SYNC_INTERVAL_MS` (int ≥ 0, default `900000`), `VLES_MAX_REQ_PER_MIN` (int 1–120, default `100`).
- Produces: `buildApp(): FastifyInstance` with `GET /health` → `{ status: 'ok', timestamp }`. No CORS plugin: no browser calls the API.

- [ ] **Step 1: Write root files.** Root `package.json` scripts: `setup` (`npm --prefix api i && npm --prefix dashboard i`), `db:up` (`docker compose -f docker-compose.dev.yml up -d`), `test` (`npm --prefix api test && npm --prefix dashboard test`), `dev` (`npm --prefix api run dev & npm --prefix dashboard run dev`). `docker-compose.dev.yml`: service `postgres`, image `postgres:17`, `POSTGRES_PASSWORD=postgres`, `POSTGRES_DB=vistaland`, port `54329:5432`, volume `pgdata`, mount `deploy/dev/init-test-db.sql` into `/docker-entrypoint-initdb.d/`. That SQL is `CREATE DATABASE vistaland_test;`. `.gitignore`: `node_modules`, `dist`, `dist-scripts`, `.next`, `.env`, `.env.local`, `deploy/.env`, `*.log`.

- [ ] **Step 2: Write `api/package.json`** with `"type": "module"`, scripts `dev` (`tsx watch src/index.ts`), `build` (`tsc`), `start` (`node dist/index.js`), `test` (`vitest run`), `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx scripts/migrate.ts`), `db:seed` (`tsx scripts/seed.ts`), `build:scripts` (`esbuild scripts/migrate.ts scripts/seed.ts --bundle --platform=node --target=node24 --format=esm --packages=external --outdir=dist-scripts`); deps `fastify ^5.8.0`, `drizzle-orm ^0.43.0`, `pg ^8.13.0`, `zod ^4.4.3`, `dotenv ^17.4.2`, `bcryptjs ^3.0.0`; devDeps `typescript ~5.8.0`, `tsx ^4.19.0`, `vitest ^3.0.0`, `drizzle-kit ^0.31.0`, `esbuild ^0.25.0`, `@types/pg`, `@types/bcryptjs`, `@types/node ^24`. Run `npm --prefix api install`.

- [ ] **Step 3: Write `api/vitest.config.ts`**: import `dotenv/config`; `test.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/vistaland_test'`; `test.env.API_SECRET_KEY = 'test-secret-test-secret-test-secret-00'`; `fileParallelism: false` (DB tests truncate shared tables). `api/.env.example` lists every Config key with the defaults above plus `TEST_DATABASE_URL`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`.

- [ ] **Step 4: Write the failing tests**

```ts
// api/tests/config.test.ts
const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db', API_SECRET_KEY: 'x'.repeat(32) };
it('applies defaults', () => {
  const c = parseConfig(base);
  expect(c.PORT).toBe(50060);
  expect(c.VLES_BASE_URL).toBe('https://vles.vistalandapp.com/api/v1/integration');
  expect(c.VLES_SYNC_INTERVAL_MS).toBe(900000);
  expect(c.VLES_MAX_REQ_PER_MIN).toBe(100);
  expect(c.VLES_API_KEY).toBe('');
});
it('rejects a missing DATABASE_URL and a short API_SECRET_KEY in one error', () => {
  expect(() => parseConfig({ API_SECRET_KEY: 'short' })).toThrow(/DATABASE_URL[\s\S]*API_SECRET_KEY/);
});
it('rejects VLES_MAX_REQ_PER_MIN above the VLES limit', () => {
  expect(() => parseConfig({ ...base, VLES_MAX_REQ_PER_MIN: '121' })).toThrow(/VLES_MAX_REQ_PER_MIN/);
});

// api/tests/health.test.ts
it('GET /health returns ok', async () => {
  const res = await buildApp().inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json().status).toBe('ok');
});
```

- [ ] **Step 5: Run to verify failure** — `npm --prefix api test` → FAIL (modules not found).
- [ ] **Step 6: Implement** `api/src/config.ts` (zod v4 object, `safeParse`, issues joined as `  KEY: message` lines, same shape as vinindo `config.ts`), `api/src/app.ts` and `api/src/index.ts` (`dotenv/config`, `getConfig()`, `buildApp().listen({ port, host: '0.0.0.0' })`).
- [ ] **Step 7: Run tests** — `npm --prefix api test` → PASS; `npm --prefix api run build` → exit 0.
- [ ] **Step 8: Commit** — `Scaffold the API package with config and health check`

---

### Task 2: Database foundation — client, base schema, migrations, test harness, project seed

**Files:**
- Create: `api/drizzle.config.ts` (port; `schema: './src/db/schema/index.ts'`, `out: './src/db/migrations'`)
- Create: `api/src/db/client.ts` (port `getDb()` with the pool `error` listener; add `closeDb(): Promise<void>`)
- Create: `api/src/db/schema/index.ts`, `api/src/db/schema/system.ts`, `api/src/db/schema/catalog.ts`
- Create: `api/src/db/migrations/0000_*.sql` (generated)
- Create: `api/scripts/migrate.ts` (port; `MIGRATIONS_DIR` default `./src/db/migrations`), `api/scripts/seed.ts`
- Create: `api/src/repositories/projects.ts`
- Create: `api/tests/setup/migrate.ts`, `api/tests/helpers/db.ts`
- Modify: `api/vitest.config.ts` (add `globalSetup: './tests/setup/migrate.ts'`)
- Test: `api/tests/projects-repo.test.ts`

**Interfaces:**
- Produces tables (drizzle names camelCase, SQL snake_case):
  - `appSettings` / `app_settings`: `key text PK`, `value jsonb not null`, `updated_at timestamptz not null default now()`.
  - `staffUsers` / `staff_users`: `id uuid PK default gen_random_uuid()`, `email text unique not null` (stored lower-case), `password_hash text not null`, `display_name text not null`, `role text not null` with check `role in ('admin','sales')`, `is_active boolean not null default true`, `created_at timestamptz not null default now()`.
  - `projects`: `id integer generated always as identity PK`, `slug text unique not null`, `display_name text not null`, `persona_team_name text not null`, `location_label text`, `maps_url text`, `access_notes text`, `gallery_hours jsonb`, `visit_minutes integer not null default 60`, `same_day_min_notice_minutes integer not null default 120`, `vles_project_id integer not null`, `vles_area_ids integer[] not null default '{}'`, `subsidi_notes text`, `active boolean not null default true`, `created_at`, `updated_at` (timestamptz, default now()).
- Produces: `getDb(): Db`, `closeDb()`, `type Db`.
- Produces: `type Project = typeof projects.$inferSelect`; `type ProjectSeed = { slug: string; displayName: string; personaTeamName: string; locationLabel: string | null; vlesProjectId: number; vlesAreaIds: number[] }`; `listProjects(): Promise<Project[]>` (ordered by id); `upsertProjectBySlug(input: ProjectSeed): Promise<Project>`.
- Produces test helper: `truncate(...tables: string[]): Promise<void>` — one `TRUNCATE … RESTART IDENTITY CASCADE`.

- [ ] **Step 1: Write the schema files** (`system.ts`: appSettings, staffUsers; `catalog.ts`: projects; `index.ts` re-exports all).
- [ ] **Step 2: Generate the migration** — `npm run db:up`, then `npm --prefix api run db:generate` → `api/src/db/migrations/0000_*.sql`. Confirm it contains `CREATE TABLE "projects"`, `"vles_area_ids" integer[] DEFAULT '{}' NOT NULL`, and the role check constraint.
- [ ] **Step 3: Write the test harness.** `tests/setup/migrate.ts` exports `setup()` that runs drizzle's `migrate()` from `./src/db/migrations` against the same URL as `vitest.config.ts`, then ends its pool. `tests/helpers/db.ts` exports `truncate`.
- [ ] **Step 4: Write the failing test**

```ts
// api/tests/projects-repo.test.ts
beforeEach(() => truncate('projects'));
it('upsertProjectBySlug inserts then updates the same row', async () => {
  const a = await upsertProjectBySlug({ slug: 'zetira', displayName: 'Zetira', personaTeamName: 'tim Zetira', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [37] });
  const b = await upsertProjectBySlug({ slug: 'zetira', displayName: 'Zetira', personaTeamName: 'tim Zetira', locationLabel: 'Cibitung', vlesProjectId: 5, vlesAreaIds: [37, 99] });
  expect(b.id).toBe(a.id);
  expect(b.vlesAreaIds).toEqual([37, 99]);
  expect((await listProjects()).length).toBe(1);
});
```

- [ ] **Step 5: Run to verify failure** — `npm --prefix api test -- projects-repo` → FAIL (`upsertProjectBySlug` not defined).
- [ ] **Step 6: Implement `api/src/repositories/projects.ts`** with `insert … onConflictDoUpdate({ target: projects.slug })`, updating every seed field and `updated_at`.
- [ ] **Step 7: Write `api/scripts/seed.ts`** that upserts exactly these projects and prints them (admin creation is added in Task 3):

| slug | displayName | personaTeamName | locationLabel | vlesProjectId | vlesAreaIds |
|---|---|---|---|---|---|
| `zetira` | Zetira | tim Zetira | Cibitung | 5 | `[37]` |
| `gran-harmoni-cibitung` | Gran Harmoni Cibitung | tim Gran Harmoni Cibitung | Cibitung | 5 | `[5]` |
| `grand-harmoni-park` | Grand Harmoni Park | tim Grand Harmoni Park | `null` | 25 | `[25]` |

- [ ] **Step 8: Run tests** — `npm --prefix api test` → all PASS.
- [ ] **Step 9: Commit** — `Add the database client, base schema, migrations and test harness`

---

### Task 3: Staff accounts and API authentication

**Files:**
- Create: `api/src/middleware/apiSecret.ts`, `api/src/repositories/staff.ts` (port, trimmed), `api/src/routes/staff.ts`
- Modify: `api/src/app.ts` (register `staffRoutes`), `api/scripts/seed.ts` (first admin)
- Test: `api/tests/staff-routes.test.ts`

**Interfaces:**
- Consumes: `getDb`, `staffUsers`, `getConfig().API_SECRET_KEY`, `truncate`.
- Produces: `requireApiSecret(req, reply): Promise<void>` — Fastify `preHandler`; compares the bearer token with `crypto.timingSafeEqual` on equal-length buffers (length mismatch = reject); failure → `401 { data: null, error: 'UNAUTHORIZED' }`.
- Produces: `type StaffRole = 'admin' | 'sales'`; `type PublicStaff = { id: string; email: string; displayName: string; role: StaffRole; isActive: boolean; createdAt: Date }`; `findStaffByEmail(email): Promise<StaffRow | null>` (lower-cases input; `StaffRow` includes `passwordHash`), `findStaffById(id)`, `listStaff(): Promise<PublicStaff[]>`, `createStaff({ email, password, displayName, role }): Promise<PublicStaff>` (bcrypt cost 12), `updateStaff(id, { displayName?, role?, isActive? }): Promise<PublicStaff | null>`, `setStaffPassword(id, password): Promise<void>`, `countStaff(): Promise<number>`.
- Produces routes (all `preHandler: requireApiSecret`):
  - `POST /api/v1/auth/verify-credentials` body `{ email, password }` → 200 `{ data: { id, email, displayName, role } }`, or 401 `UNAUTHORIZED` for unknown email, wrong password or inactive account.
  - `GET /api/v1/staff` → `{ data: PublicStaff[] }`.
  - `POST /api/v1/staff` body `{ email, password (min 12), displayName (min 1), role }` → 201 `{ data: PublicStaff }`; 400 `VALIDATION_ERROR`; 409 `EMAIL_TAKEN`.
  - `PATCH /api/v1/staff/:id` body `{ displayName?, role?, isActive?, password? (min 12) }` → 200 `{ data: PublicStaff }` / 400 / 404 `NOT_FOUND`.

- [ ] **Step 1: Write the failing tests**

```ts
// api/tests/staff-routes.test.ts
const auth = { authorization: 'Bearer test-secret-test-secret-test-secret-00' };
beforeEach(() => truncate('staff_users'));
it('rejects missing and wrong secrets', async () => {
  const app = buildApp();
  expect((await app.inject({ method: 'GET', url: '/api/v1/staff' })).statusCode).toBe(401);
  expect((await app.inject({ method: 'GET', url: '/api/v1/staff', headers: { authorization: 'Bearer nope' } })).statusCode).toBe(401);
});
it('creates staff without exposing the hash, and refuses a duplicate email in any case', async () => {
  const app = buildApp();
  const body = { email: 'Sari@Vista.id', password: 'correct-horse-1', displayName: 'Sari', role: 'sales' };
  const res = await app.inject({ method: 'POST', url: '/api/v1/staff', headers: auth, payload: body });
  expect(res.statusCode).toBe(201);
  expect(res.json().data.email).toBe('sari@vista.id');
  expect(JSON.stringify(res.json())).not.toMatch(/hash/i);
  const dup = await app.inject({ method: 'POST', url: '/api/v1/staff', headers: auth, payload: { ...body, email: 'sari@vista.id' } });
  expect(dup.statusCode).toBe(409);
  expect(dup.json().error).toBe('EMAIL_TAKEN');
});
it('verify-credentials accepts the right password and refuses wrong or inactive', async () => {
  const app = buildApp();
  const url = '/api/v1/auth/verify-credentials';
  const s = await createStaff({ email: 'a@vista.id', password: 'correct-horse-1', displayName: 'A', role: 'admin' });
  const ok = await app.inject({ method: 'POST', url, headers: auth, payload: { email: 'A@vista.id', password: 'correct-horse-1' } });
  expect(ok.statusCode).toBe(200);
  expect(ok.json().data.role).toBe('admin');
  expect((await app.inject({ method: 'POST', url, headers: auth, payload: { email: 'a@vista.id', password: 'wrong-password' } })).statusCode).toBe(401);
  await updateStaff(s.id, { isActive: false });
  expect((await app.inject({ method: 'POST', url, headers: auth, payload: { email: 'a@vista.id', password: 'correct-horse-1' } })).statusCode).toBe(401);
});
it('rejects a role other than admin or sales', async () => {
  const res = await buildApp().inject({ method: 'POST', url: '/api/v1/staff', headers: auth, payload: { email: 'b@vista.id', password: 'correct-horse-1', displayName: 'B', role: 'agent' } });
  expect(res.statusCode).toBe(400);
});
```

- [ ] **Step 2: Run to verify failure** — `npm --prefix api test -- staff-routes` → FAIL.
- [ ] **Step 3: Implement** the middleware, repository and routes per Interfaces. Detect a duplicate email from Postgres error code `23505`.
- [ ] **Step 4: Extend `scripts/seed.ts`:** after the projects, if `countStaff() === 0`, create an admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_NAME` (default name `Admin`); exit 1 with "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (min 12 chars) are required for the first admin" if either is missing or the password is shorter than 12. If staff already exist, print "Admin already exists, skipped".
- [ ] **Step 5: Run tests** — `npm --prefix api test` → PASS.
- [ ] **Step 6: Run the seed for real** — `cp api/.env.example api/.env`; set `DATABASE_URL=postgresql://postgres:postgres@localhost:54329/vistaland`, `API_SECRET_KEY` (from `openssl rand -hex 32`) and the seed admin vars; run `npm --prefix api run db:migrate && npm --prefix api run db:seed` → prints 3 projects and the admin email; a second `db:seed` prints "Admin already exists, skipped".
- [ ] **Step 7: Commit** — `Add staff accounts and shared-secret API authentication`

---

### Task 4: VLES client and recorded fixtures

**Files:**
- Create: `api/src/vles/types.ts`, `api/src/vles/client.ts`
- Create: `api/scripts/record-vles-fixtures.ts`
- Create: `api/tests/helpers/vles.ts`
- Create: `api/tests/fixtures/vles/` — recorded `units-page-1.json`, `units-page-2.json`, `unit-detail-for-sale.json`, `unit-detail-not-for-sale.json`, `unit-types.json`, `promos.json`, `mortgage-banks.json`; hand-written `units-tombstone.json`
- Test: `api/tests/vles-client.test.ts`

**Interfaces:**
- Produces in `types.ts` (zod v4 schemas with `.passthrough()` so new VLES fields never break parsing; each also exports its inferred type of the same name):
  - `VlesListEndpoint = 'units' | 'unit-types' | 'promos' | 'mortgage-banks'`
  - `VlesPage`: `{ data: unknown[]; page: { limit: number; next_cursor: string | null }; sync?: { server_time: string; updated_since: string; effective_since: string; lookback_hours: number } }`
  - `VlesUnitRaw`: `id, project_id, area_id, area_name, unit_number, block, unit, house_type_id, house_type_name, land_size, building_size, stage, stage_label, marketing_stock_stage: { code, label } | null, is_available_for_sale, selling_price: number | null, price_list_in_period: boolean | null, facing: { id, name } | null, strategic_position: { id, name, fixed_cost } | null, sales_category, business_group_label, ready, deleted, updated_at, changed_at?`
  - `VlesTombstone`: `{ id: number; deleted: true; changed_at?: string; project_id?: number }`; `isTombstone(row: unknown): row is VlesTombstone` (true when `deleted === true`)
  - `VlesUnitTypeRaw`, `VlesPromoRaw`, `VlesMortgageBankRaw` (fields as in spec 2.2 and the fixtures), `VlesSchemeRaw`: `{ id, name, selling_price: number | null, booking_fee: number | null, deposit: number | null, ppn: number | null }`, `VlesUnitDetail`: `{ data: VlesUnitRaw; schemes: VlesSchemeRaw[] }`
- Produces in `client.ts`: `class VlesError extends Error` with `constructor(endpoint: string, status: number, detail?: string)`, fields `endpoint`, `status`; message `VLES ${endpoint} failed with ${status}` (+ detail) and never the key.
- Produces: `type VlesClient = { listPage(endpoint: VlesListEndpoint, params: { updatedSince: string; cursor?: string; limit?: number }): Promise<VlesPage>; getUnit(id: number): Promise<VlesUnitDetail | null> }`; `createVlesClient(opts: { baseUrl: string; apiKey: string; maxRequestsPerMinute: number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; now?: () => number }): VlesClient`.
  - `listPage` sends `GET {baseUrl}/{endpoint}?updated_since=…&cursor=…&limit=…` (`limit` default 500; `cursor` omitted when undefined).
  - `getUnit` sends `GET {baseUrl}/units/{id}`; 404 → `null`.
  - Request starts are at least `60000 / maxRequestsPerMinute` ms apart (`now` + `sleep`).
  - 429 → sleep `Retry-After` seconds (default 60) and retry, at most 3 retries; 500–599 or a thrown network error → retry after 2000 ms then 4000 ms; 401/403/422, a 404 on a list, or exhausted retries → throw `VlesError`.
- Produces test helpers in `tests/helpers/vles.ts`: `fixture(name: string): any` (reads `tests/fixtures/vles/<name>`), `json(status: number, body: unknown, headers?: Record<string, string>): Response`, `fakeFetch(responses: Response[]): { fetch: typeof fetch; calls: { url: string; headers: Record<string, string> }[] }` (headers lower-cased).

- [ ] **Step 1: Write the failing tests**

```ts
// api/tests/vles-client.test.ts
const opts = (o: Partial<Parameters<typeof createVlesClient>[0]>) =>
  createVlesClient({ baseUrl: 'https://v/api', apiKey: 'k', maxRequestsPerMinute: 120, sleep: async () => {}, ...o });
it('sends the bearer key and the updated_since/cursor/limit query', async () => {
  const { fetch, calls } = fakeFetch([json(200, fixture('units-page-1.json'))]);
  await opts({ apiKey: 'k1', fetch }).listPage('units', { updatedSince: '2000-01-01T00:00:00+07:00', cursor: 'abc' });
  expect(calls[0].headers.authorization).toBe('Bearer k1');
  const u = new URL(calls[0].url);
  expect(u.pathname).toBe('/api/units');
  expect(u.searchParams.get('updated_since')).toBe('2000-01-01T00:00:00+07:00');
  expect(u.searchParams.get('cursor')).toBe('abc');
  expect(u.searchParams.get('limit')).toBe('500');
});
it('waits Retry-After on 429 then succeeds', async () => {
  const slept: number[] = [];
  const { fetch } = fakeFetch([json(429, {}, { 'retry-after': '2' }), json(200, fixture('promos.json'))]);
  await opts({ fetch, sleep: async (ms) => { slept.push(ms); } }).listPage('promos', { updatedSince: 'x' });
  expect(slept).toContain(2000);
});
it('throws VlesError on 401 without retrying and without the key in the message', async () => {
  const { fetch, calls } = fakeFetch([json(401, { message: 'API key tidak valid.' })]);
  const err = await opts({ apiKey: 'secret-key-123', fetch }).listPage('units', { updatedSince: 'x' }).catch((e) => e);
  expect(err).toBeInstanceOf(VlesError);
  expect(err.status).toBe(401);
  expect(err.message).not.toContain('secret-key-123');
  expect(calls.length).toBe(1);
});
it('retries a 503 twice then throws', async () => {
  const slept: number[] = [];
  const { fetch, calls } = fakeFetch([json(503, {}), json(503, {}), json(503, {})]);
  const err = await opts({ fetch, sleep: async (ms) => { slept.push(ms); } }).listPage('units', { updatedSince: 'x' }).catch((e) => e);
  expect(err.status).toBe(503);
  expect(calls.length).toBe(3);
  expect(slept).toEqual([2000, 4000]);
});
it('getUnit returns null on 404', async () => {
  const { fetch } = fakeFetch([json(404, { message: 'Unit tidak ditemukan' })]);
  expect(await opts({ fetch }).getUnit(1)).toBeNull();
});
it('spaces requests to the configured rate', async () => {
  let t = 0; const slept: number[] = [];
  const { fetch } = fakeFetch([json(200, fixture('promos.json')), json(200, fixture('promos.json'))]);
  const c = opts({ maxRequestsPerMinute: 60, fetch, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
  await c.listPage('promos', { updatedSince: 'x' });
  await c.listPage('promos', { updatedSince: 'x' });
  expect(slept).toEqual([1000]);
});
it('every recorded fixture parses with its schema', () => {
  for (const r of fixture('units-page-1.json').data) expect(VlesUnitRaw.safeParse(r).success).toBe(true);
  expect(VlesUnitDetail.safeParse(fixture('unit-detail-for-sale.json')).success).toBe(true);
  expect(fixture('unit-detail-for-sale.json').schemes.length).toBeGreaterThan(0);
  for (const r of fixture('units-tombstone.json').data) expect(isTombstone(r)).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure** — `npm --prefix api test -- vles-client` → FAIL (modules and fixtures missing).
- [ ] **Step 3: Implement `types.ts` and `client.ts`** per Interfaces.
- [ ] **Step 4: Write `api/scripts/record-vles-fixtures.ts`.** Reads `VLES_API_KEY` and `VLES_BASE_URL` (default as in Config) from env and builds a client with `maxRequestsPerMinute: 60`. Writes pretty JSON to `tests/fixtures/vles/`:
  - `units-page-1.json` = `listPage('units', { updatedSince: '2000-01-01T00:00:00+07:00', limit: 3 })`; `units-page-2.json` = the next page via its `next_cursor`.
  - `unit-detail-for-sale.json` = `getUnit` of the first unit with `is_available_for_sale` found by paging `units` at `limit: 500`; `unit-detail-not-for-sale.json` = `getUnit` of the first unit in page 1 that is not for sale.
  - `unit-types.json`, `promos.json`, `mortgage-banks.json` = first page with `limit: 5`.
  - `units-tombstone.json` (written by the script, not fetched): `{ "data": [ { "id": <units-page-1 data[0].id>, "project_id": 5, "deleted": true, "changed_at": "2026-10-30T10:00:00+07:00" } ], "page": { "limit": 500, "next_cursor": null }, "sync": { "server_time": "2026-10-30T10:05:00+07:00", "updated_since": "2026-10-30T09:00:00+07:00", "effective_since": "2026-10-30T02:00:00+07:00", "lookback_hours": 7 } }`.
- [ ] **Step 5: Record the fixtures** — from `api/`: `VLES_API_KEY=$(security find-generic-password -s vles-api-key-dev -w) npx tsx scripts/record-vles-fixtures.ts` → 8 files written; confirm `unit-detail-for-sale.json` has a non-empty `schemes`. The fixtures hold units, types, promos and banks only — no customer data.
- [ ] **Step 6: Run tests** — `npm --prefix api test` → PASS.
- [ ] **Step 7: Commit** — `Add the VLES client with rate limiting, retries and recorded fixtures`

---

### Task 5: VLES tables, mappers and upserts

**Files:**
- Create: `api/src/db/schema/vles.ts`; Modify: `api/src/db/schema/index.ts`
- Create: `api/src/db/migrations/0001_*.sql` (generated)
- Create: `api/src/vles/mappers.ts`, `api/src/vles/repository.ts`
- Test: `api/tests/vles-repository.test.ts`

**Interfaces:**
- Produces tables (spec 4.1). Every table has `raw jsonb not null` and `synced_at timestamptz not null`. Money columns are `bigint` with `mode: 'number'`; sizes and percentages are `double precision`.
  - `vles_units`: `id integer PK` (VLES id), `project_id integer not null`, `area_id integer not null`, `area_name text not null`, `unit_number text not null`, `block text`, `house_type_id integer not null`, `house_type_name text not null`, `land_size`, `building_size`, `stage integer not null`, `stage_label text`, `marketing_stock_stage integer`, `is_available_for_sale boolean not null`, `selling_price bigint`, `price_list_in_period boolean`, `facing text`, `strategic_position text`, `strategic_fixed_cost bigint`, `sales_category text`, `business_group_label text`, `ready boolean not null`, `deleted boolean not null default false`, `vles_updated_at timestamptz`. Index `(project_id, area_id)`; partial index on `id` where `is_available_for_sale and not deleted`.
  - `vles_unit_types`: `id integer PK`, `project_id integer not null`, `name text not null`, `land_size`, `building_size`, `electric_power integer`, `sales_category text`, `deleted`, `vles_updated_at`.
  - `vles_unit_schemes`: PK `(unit_id, scheme_id)`, `name text not null`, `selling_price bigint`, `booking_fee bigint`, `deposit bigint`, `ppn bigint`.
  - `vles_promos`: `id integer PK`, `project_id integer not null`, `name text not null`, `sales_category text`, `benefit_type text`, `benefit_amount bigint`, `benefit_percent`, `valid_from date`, `valid_to date`, `status text`, `is_usable boolean not null`, `deleted`, `vles_updated_at`.
  - `vles_mortgage_banks`: `id integer PK`, `project_id integer not null`, `bank_id integer`, `bank_name text`, `branch_name text`, `deleted`, `vles_updated_at`.
  - `vles_sync_state`: `endpoint text PK`, `last_server_time timestamptz`, `last_run_at timestamptz`, `last_ok_at timestamptz`, `last_error text`. Export `type SyncStateRow = typeof vlesSyncState.$inferSelect`.
- Produces mappers: `mapUnit(raw: VlesUnitRaw, syncedAt: Date)`, `mapUnitType(raw, syncedAt)`, `mapPromo(raw, syncedAt)`, `mapMortgageBank(raw, syncedAt)`, `mapSchemes(unitId: number, schemes: VlesSchemeRaw[], syncedAt: Date)` → drizzle insert values. Nested objects flatten: `marketing_stock_stage.code`, `facing.name`, `strategic_position.name` and `.fixed_cost`, `benefit_type.code`, `status.code`, `bank.id` and `bank.name`. `ready` = `raw.ready === 1`. `vles_updated_at` = `changed_at ?? updated_at`.
- Produces repository:
  - `upsertPage(endpoint: VlesListEndpoint, rows: unknown[], syncedAt: Date): Promise<{ upserted: number; tombstoned: number }>` — live rows → `insert … onConflictDoUpdate` on `id` (all mapped columns and `deleted = false`); tombstones → `update … set deleted = true, synced_at` by `id` (no-op when absent, still counted).
  - `replaceUnitSchemes(unitId: number, schemes: VlesSchemeRaw[], syncedAt: Date): Promise<void>` — delete then insert in one transaction.
  - `deleteSchemesExceptUnits(unitIds: number[]): Promise<number>` — deletes scheme rows whose `unit_id` is not in the list; returns the count.
  - `listAvailableUnitIds(): Promise<number[]>` — `is_available_for_sale and not deleted`, ordered by id.
  - `getSyncState(endpoint: string): Promise<SyncStateRow | null>`, `listSyncStates(): Promise<SyncStateRow[]>`, `markSyncStarted(endpoint, at: Date)`, `markSyncOk(endpoint, serverTime: string | null, at: Date)` (sets `last_ok_at = at`, clears `last_error`, keeps the previous `last_server_time` when `serverTime` is null), `markSyncError(endpoint, message: string, at: Date)`.

- [ ] **Step 1: Write `schema/vles.ts` and generate** `0001_*.sql` (`npm --prefix api run db:generate`).
- [ ] **Step 2: Write the failing tests**

```ts
// api/tests/vles-repository.test.ts
beforeEach(() => truncate('vles_units', 'vles_unit_schemes', 'vles_promos', 'vles_unit_types', 'vles_mortgage_banks', 'vles_sync_state'));
it('maps and upserts a units page; a second upsert of the same page changes nothing', async () => {
  const page = fixture('units-page-1.json');
  expect(await upsertPage('units', page.data, new Date())).toEqual({ upserted: page.data.length, tombstoned: 0 });
  await upsertPage('units', page.data, new Date());
  const rows = await getDb().select().from(vlesUnits);
  expect(rows.length).toBe(page.data.length);
  const r = rows.find((x) => x.id === page.data[0].id)!;
  expect(r.unitNumber).toBe(page.data[0].unit_number);
  expect(r.houseTypeName).toBe(page.data[0].house_type_name);
  expect(r.areaId).toBe(page.data[0].area_id);
});
it('stores +07:00 timestamps as the right instant', async () => {
  const raw = { ...fixture('units-page-1.json').data[0], changed_at: '2026-10-29T23:00:04+07:00' };
  await upsertPage('units', [raw], new Date());
  const [r] = await getDb().select().from(vlesUnits);
  expect(r.vlesUpdatedAt!.toISOString()).toBe('2026-10-29T16:00:04.000Z');
});
it('a tombstone marks the unit deleted and keeps its other columns; an unknown id is ignored', async () => {
  const page = fixture('units-page-1.json');
  await upsertPage('units', page.data, new Date());
  const res = await upsertPage('units', [...fixture('units-tombstone.json').data, { id: 999999999, deleted: true }], new Date());
  expect(res.tombstoned).toBe(2);
  const rows = await getDb().select().from(vlesUnits);
  const r = rows.find((x) => x.id === page.data[0].id)!;
  expect(r.deleted).toBe(true);
  expect(r.unitNumber).toBe(page.data[0].unit_number);
  expect(rows.some((x) => x.id === 999999999)).toBe(false);
});
it('replaceUnitSchemes swaps the scheme set and deleteSchemesExceptUnits prunes others', async () => {
  const d = fixture('unit-detail-for-sale.json');
  await replaceUnitSchemes(d.data.id, d.schemes, new Date());
  await replaceUnitSchemes(d.data.id, d.schemes.slice(0, 1), new Date());
  expect((await getDb().select().from(vlesUnitSchemes)).length).toBe(1);
  await replaceUnitSchemes(123, d.schemes, new Date());
  expect(await deleteSchemesExceptUnits([d.data.id])).toBe(d.schemes.length);
});
it('markSyncOk with a null server time keeps the previous one', async () => {
  await markSyncOk('units', '2026-10-30T10:00:00+07:00', new Date());
  await markSyncOk('units', null, new Date());
  expect((await getSyncState('units'))!.lastServerTime!.toISOString()).toBe('2026-10-30T03:00:00.000Z');
});
it('upserts unit types, promos and banks with flattened fields', async () => {
  const t = fixture('unit-types.json').data, p = fixture('promos.json').data, b = fixture('mortgage-banks.json').data;
  await upsertPage('unit-types', t, new Date());
  await upsertPage('promos', p, new Date());
  await upsertPage('mortgage-banks', b, new Date());
  expect((await getDb().select().from(vlesUnitTypes)).find((x) => x.id === t[0].id)!.name).toBe(t[0].name);
  const promo = (await getDb().select().from(vlesPromos)).find((x) => x.id === p[0].id)!;
  expect(promo.isUsable).toBe(p[0].is_usable);
  expect(promo.benefitType).toBe(p[0].benefit_type.code);
  expect((await getDb().select().from(vlesMortgageBanks)).find((x) => x.id === b[0].id)!.bankName).toBe(b[0].bank.name);
});
```

- [ ] **Step 3: Run to verify failure** — `npm --prefix api test -- vles-repository` → FAIL.
- [ ] **Step 4: Implement `mappers.ts` and `repository.ts`.**
- [ ] **Step 5: Run tests** — `npm --prefix api test` → PASS.
- [ ] **Step 6: Commit** — `Store VLES units, types, promos, banks and schemes locally`

---

### Task 6: VLES sync job and admin endpoints

**Files:**
- Create: `api/src/vles/sync.ts`, `api/src/routes/vles.ts`
- Modify: `api/src/app.ts` (register `vlesRoutes`), `api/src/index.ts` (start the job), `api/tests/helpers/vles.ts` (add `fakeClient`)
- Test: `api/tests/vles-sync.test.ts`

**Interfaces:**
- Consumes: `VlesClient`, `VlesError` (Task 4); repository functions (Task 5).
- Produces:
  - `EPOCH_SINCE = '2000-01-01T00:00:00+07:00'`.
  - `toWibIso(d: Date): string` — `YYYY-MM-DDTHH:mm:ss+07:00` for the same instant.
  - `syncEndpoint(client: VlesClient, endpoint: VlesListEndpoint, clock?: () => Date): Promise<{ pages: number; upserted: number; tombstoned: number; serverTime: string | null }>`.
  - `refreshSchemes(client: VlesClient, clock?: () => Date): Promise<{ units: number; schemes: number; pruned: number }>` — sync-state key `unit-schemes`.
  - `runVlesSync(client: VlesClient): Promise<{ skipped: true } | { skipped: false; results: Record<string, { ok: boolean; error?: string }> }>` — result keys `unit-types`, `units`, `promos`, `mortgage-banks`, `unit-schemes`.
  - `startVlesSync(client: VlesClient, intervalMs: number): () => void` — runs once immediately, then every `intervalMs`; `0` → does nothing and returns a no-op.
  - Routes (`requireApiSecret`): `POST /api/v1/vles/sync` → 202 `{ data: { started: true } }`, firing `runVlesSync` without awaiting it, or 202 `{ data: { started: false } }` when a run is in progress; `GET /api/v1/vles/sync-state` → `{ data: SyncStateRow[] }`.
  - The routes and `index.ts` share one client: `getVlesClient(): VlesClient | null` in `sync.ts`, built from config, `null` when `VLES_API_KEY` is empty (the POST route then answers 409 `VLES_NOT_CONFIGURED`).
- Produces test helper: `fakeClient(script: { [endpoint in VlesListEndpoint]?: (VlesPage | VlesError)[] } & { units_detail?: Record<number, VlesUnitDetail>; delayMs?: number }): VlesClient & { calls: { endpoint: string; updatedSince: string; cursor?: string }[] }` — each `listPage` call for an endpoint returns (or throws) the next scripted entry; `getUnit` returns `units_detail[id] ?? null`; `delayMs` awaits that long inside each call.

Sync algorithm (the part the signatures leave open):

```
syncEndpoint(endpoint):
  state = getSyncState(endpoint)
  since = state?.lastServerTime ? toWibIso(state.lastServerTime) : EPOCH_SINCE
  markSyncStarted(endpoint, now)
  cursor = undefined; serverTime = null; pages = 0
  loop:
    page = client.listPage(endpoint, { updatedSince: since, cursor })
    if pages == 0: serverTime = page.sync?.server_time ?? null
    upsertPage(endpoint, page.data, now); pages++
    cursor = page.page.next_cursor; if !cursor: break
  markSyncOk(endpoint, serverTime, now)          // only after the last page
  on any error: markSyncError(endpoint, String(err.message), now); rethrow

refreshSchemes():
  ids = listAvailableUnitIds()
  for id in ids: d = client.getUnit(id); replaceUnitSchemes(id, d?.schemes ?? [], now)
  pruned = deleteSchemesExceptUnits(ids)
  markSyncOk('unit-schemes', null, now)   (markSyncError + rethrow on failure)

runVlesSync():  module-level `running` flag → { skipped: true } when already set
  for step in [unit-types, units, promos, mortgage-banks, unit-schemes]:
    try → results[step] = { ok: true }
    catch → results[step] = { ok: false, error: message }; continue
  finally running = false
```

- [ ] **Step 1: Write the failing tests**

```ts
// api/tests/vles-sync.test.ts
beforeEach(() => truncate('vles_units', 'vles_unit_schemes', 'vles_promos', 'vles_unit_types', 'vles_mortgage_banks', 'vles_sync_state'));
const others = () => ({ 'unit-types': [fixture('unit-types.json')], promos: [fixture('promos.json')], 'mortgage-banks': [fixture('mortgage-banks.json')] });
it('first run uses EPOCH_SINCE, follows the cursor, and stores server_time from page 1', async () => {
  const p1 = fixture('units-page-1.json'), p2 = { ...fixture('units-page-2.json'), page: { limit: 3, next_cursor: null } };
  const c = fakeClient({ units: [p1, p2] });
  const r = await syncEndpoint(c, 'units');
  expect(c.calls[0]).toMatchObject({ endpoint: 'units', updatedSince: EPOCH_SINCE, cursor: undefined });
  expect(c.calls[1].cursor).toBe(p1.page.next_cursor);
  expect(r.pages).toBe(2);
  expect((await getSyncState('units'))!.lastServerTime!.toISOString()).toBe(new Date(p1.sync.server_time).toISOString());
});
it('next run sends the stored server_time as +07:00', async () => {
  await markSyncOk('units', '2026-10-30T19:57:26+07:00', new Date());
  const c = fakeClient({ units: [fixture('units-tombstone.json')] });
  await syncEndpoint(c, 'units');
  expect(c.calls[0].updatedSince).toBe('2026-10-30T19:57:26+07:00');
});
it('failure on page 2 keeps the previous server_time and records the error', async () => {
  await markSyncOk('units', '2026-10-30T10:00:00+07:00', new Date());
  const c = fakeClient({ units: [fixture('units-page-1.json'), new VlesError('units', 500)] });
  await expect(syncEndpoint(c, 'units')).rejects.toThrow();
  const s = (await getSyncState('units'))!;
  expect(s.lastServerTime!.toISOString()).toBe('2026-10-30T03:00:00.000Z');
  expect(s.lastError).toMatch(/500/);
});
it('one endpoint failing does not stop the others or delete rows', async () => {
  await upsertPage('units', fixture('units-page-1.json').data, new Date());
  const r = await runVlesSync(fakeClient({ units: [new VlesError('units', 401)], ...others() }));
  expect(r.skipped).toBe(false);
  if (!r.skipped) { expect(r.results.units.ok).toBe(false); expect(r.results.promos.ok).toBe(true); }
  expect((await getDb().select().from(vlesUnits)).length).toBe(fixture('units-page-1.json').data.length);
});
it('refreshSchemes removes schemes of units no longer for sale', async () => {
  const d = fixture('unit-detail-for-sale.json');
  await upsertPage('units', [d.data], new Date());
  const c = fakeClient({ units_detail: { [d.data.id]: d } });
  await refreshSchemes(c);
  expect((await getDb().select().from(vlesUnitSchemes)).length).toBe(d.schemes.length);
  await upsertPage('units', [{ ...d.data, is_available_for_sale: false }], new Date());
  const r = await refreshSchemes(c);
  expect(r.pruned).toBe(d.schemes.length);
  expect((await getDb().select().from(vlesUnitSchemes)).length).toBe(0);
});
it('a second runVlesSync while one is running is skipped', async () => {
  const c = fakeClient({ units: [fixture('units-tombstone.json')], ...others(), delayMs: 50 });
  const [a, b] = await Promise.all([runVlesSync(c), runVlesSync(c)]);
  expect([a.skipped, b.skipped].sort()).toEqual([false, true]);
});
it('toWibIso renders the instant in +07:00', () => {
  expect(toWibIso(new Date('2026-10-30T12:57:26Z'))).toBe('2026-10-30T19:57:26+07:00');
});
```

- [ ] **Step 2: Run to verify failure** — `npm --prefix api test -- vles-sync` → FAIL.
- [ ] **Step 3: Implement `sync.ts`, `routes/vles.ts` and the `fakeClient` helper.** In `index.ts`, when `getVlesClient()` is non-null call `startVlesSync(client, VLES_SYNC_INTERVAL_MS)`; log one line per run with per-step ok/error (never the key).
- [ ] **Step 4: Run tests** — `npm --prefix api test` → PASS.
- [ ] **Step 5: Live check** — set `VLES_API_KEY` in `api/.env` from the keychain (`security find-generic-password -s vles-api-key-dev -w`), run `npm --prefix api run dev`, wait for the first run (≈3 minutes, mostly the throttled scheme fetches), then:
  - `psql postgresql://postgres:postgres@localhost:54329/vistaland -c "select count(*), count(*) filter (where is_available_for_sale and not deleted) from vles_units"` → about 2,246 total and about 190 for sale (2026-10-30 figures);
  - `psql … -c "select count(*) from vles_unit_schemes"` → greater than 0;
  - `curl -H "Authorization: Bearer $API_SECRET_KEY" localhost:50060/api/v1/vles/sync-state` → five rows, each with `lastOkAt` set and `lastError` null.
- [ ] **Step 6: Commit** — `Sync VLES every 15 minutes with resumable incremental pulls`

---

### Task 7: Stock summary API

**Files:**
- Create: `api/src/stock/summary.ts`, `api/src/routes/stock.ts`
- Modify: `api/src/app.ts` (register `stockRoutes`), `api/tests/helpers/vles.ts` (add `unit`, `seedUnits`, `seedProjects`)
- Test: `api/tests/stock-summary.test.ts`

**Interfaces:**
- Consumes: `projects`, `upsertProjectBySlug` (Task 2); `vles_units`, `vles_sync_state`, `upsertPage`, `markSyncOk`, `SyncStateRow` (Task 5).
- Produces:
  - `STALE_AFTER_MS = 7_200_000` (spec: data older than 2 hours is flagged).
  - `getStockSummary(now?: Date): Promise<StockSummary>` with
    - `StockSummary = { projects: ProjectStock[]; unassignedAreas: { vlesProjectId: number; areaId: number; areaName: string; units: number; availableUnits: number }[]; syncStates: SyncStateRow[]; stale: boolean }`
    - `ProjectStock = { projectId: number; slug: string; displayName: string; availableUnits: number; totalUnits: number; types: TypeStock[] }`
    - `TypeStock = { houseTypeId: number; houseTypeName: string; salesCategory: string | null; landSize: number | null; buildingSize: number | null; availableUnits: number; totalUnits: number; minPrice: number | null; maxPrice: number | null; unpricedAvailable: number; outOfPeriodAvailable: number }`
  - Rules: a unit belongs to a project when `unit.project_id = project.vles_project_id and unit.area_id = any(project.vles_area_ids)`; deleted units are ignored everywhere; every active project appears even with zero units; `minPrice`/`maxPrice` use available units with non-null `selling_price` only; `outOfPeriodAvailable` counts available units with `price_list_in_period = false`; types sort by `minPrice` ascending, nulls last; `stale` is true when the `units` sync state has no `last_ok_at` or it is older than `STALE_AFTER_MS`.
  - Route `GET /api/v1/stock` (`requireApiSecret`) → `{ data: StockSummary }`.
- Produces test helpers: `unit(overrides: Partial<VlesUnitRaw>): VlesUnitRaw` (spreads `units-page-1.json` `data[0]` then the overrides, `deleted: false`), `seedUnits(units: VlesUnitRaw[])` (calls `upsertPage('units', …)`), `seedProjects()` (upserts the three Task 2 seed rows).

- [ ] **Step 1: Write the failing tests**

```ts
// api/tests/stock-summary.test.ts
beforeEach(async () => { await truncate('projects', 'vles_units', 'vles_sync_state'); await seedProjects(); });
const zetira = async () => (await getStockSummary()).projects.find((p) => p.slug === 'zetira')!;
it('groups available units by project and type with price range', async () => {
  await seedUnits([
    unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: true, selling_price: 400000000 }),
    unit({ id: 2, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: true, selling_price: 433425660 }),
    unit({ id: 3, project_id: 5, area_id: 37, house_type_id: 500, house_type_name: 'ZETIRA BELVIA', is_available_for_sale: false, selling_price: null }),
  ]);
  const z = await zetira();
  expect(z.availableUnits).toBe(2);
  expect(z.types[0]).toMatchObject({ houseTypeName: 'ZETIRA BELVIA', availableUnits: 2, totalUnits: 3, minPrice: 400000000, maxPrice: 433425660 });
});
it('null price is counted but not used for min/max', async () => {
  await seedUnits([
    unit({ id: 1, project_id: 5, area_id: 37, house_type_id: 500, is_available_for_sale: true, selling_price: null }),
    unit({ id: 2, project_id: 5, area_id: 37, house_type_id: 500, is_available_for_sale: true, selling_price: 465520000 }),
  ]);
  expect((await zetira()).types[0]).toMatchObject({ availableUnits: 2, unpricedAvailable: 1, minPrice: 465520000, maxPrice: 465520000 });
});
it('deleted units are ignored', async () => {
  await seedUnits([unit({ id: 1, project_id: 5, area_id: 37, is_available_for_sale: true, selling_price: 1 })]);
  await upsertPage('units', [{ id: 1, deleted: true }], new Date());
  expect((await zetira()).totalUnits).toBe(0);
});
it('units in an unmapped area are reported as unassigned', async () => {
  await seedUnits([unit({ id: 9, project_id: 5, area_id: 77, area_name: 'CLUSTER BARU', is_available_for_sale: true, selling_price: 1 })]);
  const s = await getStockSummary();
  expect(s.unassignedAreas).toEqual([{ vlesProjectId: 5, areaId: 77, areaName: 'CLUSTER BARU', units: 1, availableUnits: 1 }]);
  expect(s.projects.length).toBe(3);
  expect(s.projects.every((p) => p.totalUnits === 0)).toBe(true);
});
it('stale is true with no successful units sync or one older than 2 hours', async () => {
  const now = new Date('2026-10-30T12:00:00Z');
  expect((await getStockSummary(now)).stale).toBe(true);
  await markSyncOk('units', null, new Date('2026-10-30T09:00:00Z'));
  expect((await getStockSummary(now)).stale).toBe(true);
  await markSyncOk('units', null, new Date('2026-10-30T11:00:00Z'));
  expect((await getStockSummary(now)).stale).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** — `npm --prefix api test -- stock-summary` → FAIL.
- [ ] **Step 3: Implement** `getStockSummary` as SQL aggregates (one grouped query over `vles_units` joined to `projects` on `area_id = any(vles_area_ids)`, one anti-join for unassigned areas) and the route.
- [ ] **Step 4: Run tests** — `npm --prefix api test` → PASS.
- [ ] **Step 5: Commit** — `Summarise synced stock per project and type`

---

### Task 8: Dashboard scaffold, login and admin gate

**Files:**
- Create: `dashboard/package.json`, `tsconfig.json` (with the `@/*` alias), `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `.env.example`, `vitest.config.ts`
- Create: `dashboard/lib/auth.ts` (port; role typed `admin | sales`), `dashboard/lib/session.ts`, `dashboard/lib/api/client.ts` (port `apiFetch`, `ApiError`; default URL `http://localhost:50060`), `dashboard/types/next-auth.d.ts` (port)
- Create: `dashboard/proxy.ts`
- Create: `dashboard/app/layout.tsx`, `app/globals.css`, `app/api/auth/[...nextauth]/route.ts`, `app/(auth)/login/page.tsx`, `app/(dashboard)/layout.tsx`, `app/(dashboard)/page.tsx`, `components/layout/Sidebar.tsx`

**Interfaces:**
- Consumes: `POST /api/v1/auth/verify-credentials` (Task 3).
- Produces: `auth()`, `signIn`, `signOut`, `handlers` (NextAuth v5, JWT sessions; `session.user.id`, `session.user.role`); `sessionRole(): Promise<'admin' | 'sales' | null>`; `requireAdmin(): Promise<void>` (throws `Error('FORBIDDEN')` unless the session role is `admin` — every admin server action calls it); `apiFetch<T>(path: string, init?: RequestInit): Promise<ApiEnvelope<T>>` (server-only; prefixes `/api/v1`; sends `Authorization: Bearer ${API_SECRET_KEY}`; non-2xx → `ApiError(status, code)` where `code` is the envelope's `error`).
- Produces in `proxy.ts`: `ADMIN_ONLY_PATHS = ['/stock', '/staff']`. No session → redirect `/login`; role `sales` on an admin-only path → redirect `/`. Public: `/login`, `/api/auth/*`, `/_next/*`, `/favicon.ico`. No `basePath` (Caddy serves the dashboard at the site root).
- Env: `AUTH_SECRET`, `AUTH_URL` (`http://localhost:40060` in dev), `API_INTERNAL_URL` (`http://localhost:50060` in dev), `API_SECRET_KEY`.
- Sidebar items: "Beranda" (`/`), "Stok Unit" (`/stock`, admin), "Staf" (`/staff`, admin), "Keluar" (sign out). Later milestones add items here.

- [ ] **Step 1: Write `dashboard/package.json`** — scripts `dev` (`next dev -p 40060`), `build` (`next build`), `start` (`next start -p 40060`), `type-check` (`tsc --noEmit`), `test` (`vitest run`); deps `next ^16.2.6`, `next-auth 5.0.0-beta.28`, `react ^19.0.0`, `react-dom ^19.0.0`, `zod ^3.24.0`; devDeps `tailwindcss ^3.4.0`, `postcss ^8.4.0`, `autoprefixer ^10.4.0`, `typescript ~5.8.0`, `@types/node ^24`, `@types/react ^19`, `@types/react-dom ^19`, `vitest ^3.0.0`. `next.config.ts`: `output: 'standalone'`. Run `npm --prefix dashboard install`.
- [ ] **Step 2: Implement** the files above. Login page: email and password fields, button "Masuk", error text "Email atau kata sandi salah." on failure. Home page: "Selamat datang, {name}" and the role label ("Admin" / "Sales").
- [ ] **Step 3: Verify types and build** — `npm --prefix dashboard run type-check` → exit 0; `npm --prefix dashboard run build` → exit 0.
- [ ] **Step 4: Manual check** — `npm run dev`; open `http://localhost:40060` → redirected to `/login`; a wrong password shows "Email atau kata sandi salah."; sign in as the seeded admin → home shows the name and a sidebar with "Stok Unit" and "Staf". Create a sales user: `curl -X POST localhost:50060/api/v1/staff -H "Authorization: Bearer $API_SECRET_KEY" -H 'content-type: application/json' -d '{"email":"sales1@vista.id","password":"sales-password-1","displayName":"Sales Satu","role":"sales"}'`; sign in as it → the sidebar hides "Stok Unit" and "Staf", and opening `/stock` lands on `/`.
- [ ] **Step 5: Commit** — `Add the dashboard with login and an admin-only gate`

---

### Task 9: Stok Unit and Staf pages

**Files:**
- Create: `dashboard/lib/format.ts`, `dashboard/lib/api/stock.ts`, `dashboard/lib/api/staff.ts`, `dashboard/lib/api/vles.ts`
- Create: `dashboard/actions/stockActions.ts`, `dashboard/actions/staffActions.ts`
- Create: `dashboard/app/(dashboard)/stock/page.tsx`, `dashboard/app/(dashboard)/staff/page.tsx`, `dashboard/app/(dashboard)/staff/StaffClient.tsx`
- Test: `dashboard/tests/format.test.ts`

**Interfaces:**
- Consumes: `GET /api/v1/stock` (Task 7), `POST /api/v1/vles/sync` (Task 6), staff routes (Task 3), `apiFetch`, `requireAdmin` (Task 8).
- Produces: `formatRupiahShort(n: number): string`, `formatRupiah(n: number): string`, `formatWib(value: string | Date): string`.
- Produces server actions, each calling `requireAdmin()` first and `revalidatePath` on its page: `triggerVlesSync(): Promise<{ started: boolean }>`, `createStaffAction(input: { email: string; password: string; displayName: string; role: 'admin' | 'sales' }): Promise<{ error?: string }>`, `updateStaffAction(id: string, patch: { displayName?: string; role?: 'admin' | 'sales'; isActive?: boolean }): Promise<{ error?: string }>`, `resetStaffPasswordAction(id: string, password: string): Promise<{ error?: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
// dashboard/tests/format.test.ts
it('formats rupiah in rb, jt and M with an Indonesian decimal comma', () => {
  expect(formatRupiahShort(465520000)).toBe('Rp465,5 jt');
  expect(formatRupiahShort(400000000)).toBe('Rp400 jt');
  expect(formatRupiahShort(1250000000)).toBe('Rp1,25 M');
  expect(formatRupiahShort(950000)).toBe('Rp950 rb');
});
it('formats full rupiah with dot thousands', () => {
  expect(formatRupiah(433425660)).toBe('Rp433.425.660');
});
it('formats instants in WIB', () => {
  expect(formatWib('2026-10-30T12:57:26Z')).toBe('30 Okt 2026, 19.57 WIB');
});
```

Rounding for `formatRupiahShort`: below 1 juta → ribu with 0 decimals; below 1 miliar → juta with 1 decimal; otherwise miliar with 2 decimals; trailing `,0` / `,00` dropped.

- [ ] **Step 2: Run to verify failure** — `npm --prefix dashboard test` → FAIL.
- [ ] **Step 3: Implement `lib/format.ts`** with `Intl.NumberFormat('id-ID')` and `Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', … })`.
- [ ] **Step 4: Run tests** — `npm --prefix dashboard test` → PASS.
- [ ] **Step 5: Implement the Stok Unit page** (server component; admin only):
  - Header "Stok Unit" with a "Sinkronkan sekarang" button (`triggerVlesSync`; then shows "Sinkronisasi dimulai." or "Sinkronisasi sedang berjalan.").
  - When `stale`, a warning banner: "Data VLES terakhir berhasil disinkron {formatWib(lastOkAt)} — lebih dari 2 jam lalu.", or "Data VLES belum pernah berhasil disinkron." when there is none. One red line per sync state with `lastError`: "{endpoint}: {lastError}".
  - One card per project: "{displayName} — {availableUnits} unit tersedia dari {totalUnits}". Table columns: "Tipe"; "LT/LB" (`{landSize}/{buildingSize} m²`); "Kategori" (`salesCategory`); "Tersedia" (`{availableUnits}/{totalUnits}`); "Harga" (`{min}–{max}` via `formatRupiahShort`, one value when equal, "—" when null); "Catatan" ("{n} unit tanpa harga" when `unpricedAvailable > 0`; "{n} di luar periode price list" when `outOfPeriodAvailable > 0`).
  - Section "Area VLES belum dipetakan" listing `unassignedAreas` (hidden when empty) with the note "Unit di area ini tidak ditawarkan Moni sampai area dipetakan ke proyek."
- [ ] **Step 6: Implement the Staf page** (admin only): table Nama / Email / Peran / Status; form "Tambah staf" (nama, email, peran admin/sales, kata sandi min 12); per row "Nonaktifkan" / "Aktifkan" and "Atur ulang kata sandi". API errors show "Email sudah dipakai." for `EMAIL_TAKEN` and "Data belum lengkap." for `VALIDATION_ERROR`.
- [ ] **Step 7: Verify** — `npm --prefix dashboard run type-check && npm --prefix dashboard run build` → exit 0. With the API synced from Task 6: `/stock` shows three project cards; Zetira lists ZETIRA ARIA / BELVIA / FREYA / JUNA types priced around Rp384–466 jt; no unassigned areas. Then set `VLES_SYNC_INTERVAL_MS=0` in `api/.env`, restart the API, run `psql postgresql://postgres:postgres@localhost:54329/vistaland -c "update vles_sync_state set last_ok_at = now() - interval '3 hours' where endpoint = 'units'"` and reload `/stock` → the stale banner appears; restore the interval. Create a sales user from `/staff`, sign in as them, confirm they cannot open `/staff`.
- [ ] **Step 8: Commit** — `Add the Stok Unit and Staf pages`

---

### Task 10: Production Docker deploy

**Files:**
- Create: `api/Dockerfile`, `dashboard/Dockerfile`, `.dockerignore` (`node_modules`, `.next`, `dist`, `dist-scripts`, `.env*`, `deploy/.env`)
- Create: `deploy/docker-compose.yml`, `deploy/Caddyfile`, `deploy/.env.example`
- Modify: `README.md` (local development and deploy sections)

**Interfaces:**
- Consumes: api scripts `build` and `build:scripts`; dashboard `output: 'standalone'`.
- Produces compose services:
  - `postgres`: `postgres:17`, volume `pgdata`, healthcheck `pg_isready -U postgres`, no published port.
  - `api`: built from `api/Dockerfile`, env from `deploy/.env` plus `PORT=50060`, `MIGRATIONS_DIR=./migrations`; `depends_on: postgres: condition: service_healthy`; command `sh -c "node dist-scripts/migrate.js && node dist/index.js"` (a failed migration stops the container instead of running half-migrated); `restart: unless-stopped`.
  - `dashboard`: built from `dashboard/Dockerfile`, env `API_INTERNAL_URL=http://api:50060`, `API_SECRET_KEY`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_TRUST_HOST=true`; `restart: unless-stopped`.
  - `caddy`: `caddy:2`, ports `80:80` and `443:443`, volumes `caddy_data`, `caddy_config`, mounts `deploy/Caddyfile`.
- Caddy on `{$DOMAIN}`: `/webhook*`, `/media/*` and `/health` → `api:50060`; everything else → `dashboard:40060`. `/api/v1/*` is **not** routed publicly: only the dashboard container calls it, over the compose network.
- `deploy/.env.example`: `DOMAIN`, `POSTGRES_PASSWORD`, `DATABASE_URL=postgresql://postgres:<POSTGRES_PASSWORD>@postgres:5432/vistaland`, `API_SECRET_KEY`, `AUTH_SECRET`, `AUTH_URL=https://<DOMAIN>`, `VLES_API_KEY`, `VLES_SYNC_INTERVAL_MS=900000`, `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME`.

- [ ] **Step 1: Write both Dockerfiles** — multi-stage `node:24-slim`: `npm ci`, build, then copy only runtime files. api: `dist`, `dist-scripts`, `src/db/migrations` → `./migrations`, production `node_modules`. dashboard: `.next/standalone`, `.next/static` → `.next/static`, `public`; `CMD ["node", "server.js"]` with `PORT=40060` and `HOSTNAME=0.0.0.0`.
- [ ] **Step 2: Write compose, Caddyfile and env example** per Interfaces.
- [ ] **Step 3: Validate** — `docker compose -f deploy/docker-compose.yml --env-file deploy/.env.example config` → exit 0.
- [ ] **Step 4: Local production rehearsal** — copy `deploy/.env.example` to `deploy/.env` with `DOMAIN=localhost` and real secrets; then:
  - `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build` → all four services running;
  - `docker compose -f deploy/docker-compose.yml exec api node dist-scripts/seed.js` → 3 projects and the admin;
  - `curl -sk https://localhost/health` → `{"status":"ok",…}`; `curl -sk -o /dev/null -w '%{http_code}' https://localhost/api/v1/staff` → `404` (not exposed);
  - open `https://localhost` → login page; sign in → Stok Unit fills after the first sync;
  - `docker compose -f deploy/docker-compose.yml restart api` → `/health` ok again; a second seed run prints "Admin already exists, skipped".
- [ ] **Step 5: Write the README** — local development (`npm run db:up`, `npm run setup`, copy both env examples, `npm --prefix api run db:migrate`, `npm --prefix api run db:seed`, `npm run dev`; re-recording fixtures with the keychain command from Task 4) and deploy (the commands in Step 4, where each secret comes from, and that the current VLES key is a production key until a dev key is issued).
- [ ] **Step 6: Commit** — `Add the Docker Compose production deploy`

---

## Next milestones

Plans for Milestone 2 (Moni answers), 3 (Visits) and 4 (Outbound and reporting) are written after this one is merged, against the code it produced. They rely on these names from this milestone: `getDb`, `truncate`, `requireApiSecret`, `apiFetch`, `requireAdmin`, `projects` / `listProjects`, the `vles_*` tables, `listAvailableUnitIds`, `getVlesClient().getUnit` (the live availability check), `getStockSummary`, `toWibIso`, `formatRupiahShort`, `formatWib`, and `components/layout/Sidebar.tsx`.
