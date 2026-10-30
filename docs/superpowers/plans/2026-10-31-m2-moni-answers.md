# Milestone 2 — Moni Answers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moni answers WhatsApp leads through ChakraHQ, following FLOW MONI. It uses verified VLES stock and prices, the materials and KPR assumptions that staff manage in the dashboard, and guarded replies. Staff can follow every lead, take a chat over, and rehearse Moni in a test chat.

**Architecture:**
- **Inbound:** messages arrive on `POST /webhook`, are verified and deduplicated, then a per-conversation debounce batches them into one turn.
- **A turn:** a manual Claude Messages API tool loop (`@anthropic-ai/sdk`) with nine tools. Its only exit is `respond_to_customer`, and a deterministic reply check gates every outgoing text.
- **Sending:** goes through a `Transport` interface, so the test chat runs the same router against a recording transport.
- **Visits** (find slots, book) arrive in Milestone 3. Until then, Moni collects the preferred day and time, moves the lead to `visit_proposed`, and hands the chat to staff.

**Tech Stack:**
- Everything Milestone 1 uses
- `@anthropic-ai/sdk ^1.3.0`
- `@fastify/multipart ^10`, `@fastify/static ^9`

**Spec:** `docs/superpowers/specs/2026-10-30-moni-sales-agent-design.md`. The sections that apply: 2.1, 3.2, 4.2–4.3, 4.5, 5 (all), 7 (Leads, Lead detail, Projects & materials, KPR settings, Test chat, Settings), 8, 9, and 10 milestone 2.

**Builds on:** Milestone 1 on `main`. Port reference: `/Users/claytonmildy/WidaProject/FDE Projects/vinindo-app`. Each task names the vinindo file and lines it ports.

**Before Task 9:** load the `claude-api` skill. Its TypeScript `README.md` and `tool-use.md` are authoritative for SDK calls.

## Global Constraints

Everything in Milestone 1's Global Constraints still holds: two packages, Node ≥24, ESM with `.js` imports, the `{data, error}` envelope, the bearer secret, WIB display, Bahasa Indonesia UI, and the VLES key never logged. In addition:

- **Model:**
  - `CLAUDE_MODEL` defaults to `claude-opus-5-5`.
  - `CLAUDE_EFFORT` defaults to `medium` and is sent as `output_config.effort`.
  - Every request goes through `client.beta.messages.create` with `betas: ['server-side-fallback-2026-07-01']` and `fallbacks: 'default'`.
  - Never send `thinking`, `temperature`, `top_p`, `top_k`, a forced `tool_choice`, or an assistant prefill.
  - `max_tokens: 16000`.
- **Tool loop:**
  - Within one turn, append each `response.content` back unchanged.
  - Tool inputs are validated with zod in our code. Invalid input returns a `tool_result` with `is_error: true`; the turn does not throw.
- **Moni's voice:**
  - Replies are Bahasa Indonesia and short, using WhatsApp markup (`*bold*`, not `**bold**`).
  - Moni introduces itself as "Moni dari tim <persona>". For an unknown project, the persona is `app_settings.persona_group_name` (default `tim Vista Land`).
- **Facts:** prices, promos, stock and simulations reach the customer only from tool results or the injected project facts (spec 5.5).
- **Media:** sent by public link only, as `${PUBLIC_BASE_URL}/media/<file>`. Uploads are limited to `image/jpeg`, `image/png`, `video/mp4`, `application/pdf`, at most **16 MB** (WhatsApp's video limit; WhatsApp rejects webp sent by link).
- **Test data:** a contact with `is_test = true` never reaches Chakra, and is excluded from the Leads list and later reports.
- **Takeover:** a human takeover lasts `app_settings.takeover_hours` (default **24**), or until staff hand the chat back.
- **Debounce:**
  - The timer is `TYPING_DEBOUNCE_MS` (default **8000**) after the last message, capped at `TYPING_MAX_WAIT_MS` (default **30000**) after the first.
  - It fires at once on the 20th message.
  - Only one turn runs per conversation at a time.

## Review Focus

1. **A customer sends three messages in four seconds** → one reply that answers all three, not three replies. Test: Task 10, `a burst of messages produces one turn`.
2. **Chakra delivers the same webhook twice** → the message is stored once and answered once. Test: Task 6, `insertInbound reports a duplicate wamid`; Task 10, `a duplicate inbound does not schedule a turn`.
3. **The customer writes again while Moni is mid-turn** → the stale draft is dropped and one combined answer goes out, at most once per batch. Test: Task 10, `a message arriving mid-turn supersedes the draft once`.
4. **VLES is unreachable during `check_availability`** → the tool returns `verified: false`, and a reply naming a unit number is rejected by the reply check. Test: Task 5, `availability is unverified when VLES fails`; Task 8, `a unit number without a verified check is rejected`.
5. **A material's media send fails** (bad link, Chakra 4xx) → the text still goes out, the failure is logged as a lead event, and the material is not marked sent, so Moni may offer it again. Test: Task 10, `a failed media send is not recorded as sent`.

---

## File Structure

```
api/src/
├── config.ts                     + ANTHROPIC_*, CLAUDE_*, CHAKRA_*, PUBLIC_BASE_URL, MEDIA_DIR, TYPING_*
├── db/schema/
│   ├── catalog.ts                + typeProfiles, materials, promoCopy, kprSettings, schemeDpOverrides, channelTags
│   ├── conversations.ts          NEW contacts, conversations, messages, leads, leadEvents
│   └── system.ts                 + promptVersions
├── settings/appSettings.ts       getSetting/setSetting with typed defaults
├── kpr/ calculator.ts  assumptions.ts
├── media/storage.ts              saveUpload, publicUrl
├── repositories/ typeProfiles.ts  materials.ts  promoCopy.ts  channelTags.ts   (projects.ts, staff.ts exist)
├── knowledge/ units.ts  availability.ts  simulation.ts  facts.ts
├── leads/ stages.ts  repository.ts  state.ts
├── chakra/ client.ts  signature.ts  parse.ts  detectProject.ts  staffSync.ts
├── agent/
│   ├── prompts/system.md         rules + tool guidance (ships with the build)
│   ├── prompts/flow-moni.md      FLOW MONI playbook (seed for prompt_versions)
│   ├── rupiah.ts  replyChecks.ts  prompt.ts  tools.ts  executor.ts  claude.ts  loop.ts
├── router/ transport.ts  debounce.ts  turn.ts  inbound.ts
└── routes/ webhook.ts  media.ts  catalog.ts  kpr.ts  leads.ts  testChat.ts  settings.ts
api/tests/fixtures/chakra/        inbound-text.json  inbound-image.json  inbound-audio.json  inbound-status.json  inbound-referral.json
dashboard/
├── app/(dashboard)/ projects/  kpr/  leads/  leads/[id]/  test-chat/  settings/
├── app/api/upload/route.ts       admin-only multipart forward to POST /api/v1/media
├── lib/api/ catalog.ts  kpr.ts  leads.ts  testChat.ts  settings.ts
└── actions/ catalogActions.ts  kprActions.ts  leadActions.ts  testChatActions.ts  settingsActions.ts
```

---

### Task 1: Milestone 1 carry-overs that Milestone 2 depends on

**Files:**
- Modify: `api/src/vles/client.ts`, `api/src/stock/summary.ts`, `api/src/app.ts`, `dashboard/lib/api/stock.ts`, `dashboard/app/(dashboard)/stock/page.tsx`
- Test: `api/tests/vles-client.test.ts`, `api/tests/stock-summary.test.ts`

**Interfaces:**
- Produces: `VlesClient` calls are serialized. Requests from concurrent callers run one at a time through an internal promise chain, so the rate spacing holds when `check_availability` runs during a sync.
- Produces: `TypeStock.landSize` is renamed to `landSizeMin` in the API and the dashboard.
- `buildApp` reads `getConfig().LOG_LEVEL`.

- [ ] **Step 1: Write the failing tests**

```ts
// vles-client.test.ts
it('serializes concurrent callers so spacing holds', async () => {
  let t = 0; const starts: number[] = [];
  const fetch = (async () => { starts.push(t); return json(200, fixture('promos.json')); }) as typeof globalThis.fetch;
  const c = opts({ maxRequestsPerMinute: 60, fetch, now: () => t, sleep: async (ms) => { t += ms; } });
  await Promise.all([c.listPage('promos', { updatedSince: 'x' }), c.listPage('promos', { updatedSince: 'x' }), c.getUnit(1)]);
  expect(starts).toEqual([0, 1000, 2000]);
});
// stock-summary.test.ts: rename landSize -> landSizeMin in 'reports the land size range…'
```

- [ ] **Step 2: Run to verify failure:** `npm --prefix api test -- vles-client stock-summary` → FAIL. Concurrent starts come out as `[0,0,0]`, and `landSizeMin` is undefined.
- [ ] **Step 3: Implement:**
  - Queue each request behind `let chain: Promise<unknown> = Promise.resolve()`, with `chain = chain.then(run, run)` so a rejection doesn't break the chain.
  - Rename the field everywhere: `rg -l landSize` in both packages.
  - Read `LOG_LEVEL` through `getConfig()`.
- [ ] **Step 4: Run tests:** `npm test` → all PASS. Also run `npm --prefix dashboard run type-check`.
- [ ] **Step 5: Commit:** `Serialize VLES requests and rename landSize to landSizeMin`

---

### Task 2: Schema for knowledge, conversations, leads and prompts

**Files:**
- Create: `api/src/db/schema/conversations.ts`
- Modify: `api/src/db/schema/catalog.ts`, `system.ts`, `index.ts`
- Create: `api/src/db/migrations/0002_*.sql` (generated, then hand-edited for the two items noted in Step 2)
- Create: `api/src/settings/appSettings.ts`
- Test: `api/tests/schema-m2.test.ts`, `api/tests/app-settings.test.ts`

**Interfaces:**

Tables. The spec section each one comes from is in brackets; columns are snake_case in SQL.

- **`type_profiles`** [4.2]:
  - `house_type_id integer PK` (VLES id), `project_id int FK projects`
  - `marketing_name text`, `bedrooms int`, `bathrooms int`, `floors int`, `highlights text`
  - `active bool default true`, `updated_at`
- **`materials`** [4.2]:
  - `id int identity PK`, `project_id int FK not null`, `house_type_id int null`
  - `kind text check in ('flyer','video','promo','floor_plan','brochure','photo')`
  - `url text not null`, `mime text not null`, `filename text not null`
  - `valid_from date`, `valid_to date`, `sort int default 0`, `active bool default true`, `created_at`
- **`promo_copy`** [4.2]: `vles_promo_id int PK`, `customer_text text not null`, `terms_text text`, `updated_at`
- **`kpr_settings`** [4.2]:
  - `id int identity PK`, `project_id int FK not null`, `bank_id int null`
  - `fixed_rate_pct double`, `fixed_years int`, `floating_rate_pct double`
  - `tenor_options int[] not null`, `dp_options_pct double precision[] not null`, `notes text`, `updated_at`
  - Unique `(project_id, bank_id)` **NULLS NOT DISTINCT**
- **`scheme_dp_overrides`** [4.2]: `scheme_name text PK`, `dp_pct double not null`
- **`channel_tags`** [4.2]:
  - `tag text PK`, upper-case, e.g. `ZTR-REELS`
  - `project_id int FK not null`
  - `channel text check in ('instagram','facebook','tiktok','other')`
  - `content_kind text check in ('promo','reels','general')`
- **`contacts`** [4.3]:
  - `id uuid PK`, `wa_phone text unique not null` (62…), `display_name text`
  - `is_test bool not null default false`, `opted_out_at timestamptz`, `created_at`
- **`conversations`** [4.3]:
  - `id uuid PK`, `contact_id uuid unique FK cascade`, `wa_phone_number_id text`
  - `ai_enabled bool not null default true`, `human_takeover_until timestamptz`
  - `last_customer_msg_at`, `last_moni_msg_at`, `last_canned_reply_at`, `created_at`
- **`messages`** [4.3]:
  - `id uuid PK`, `conversation_id uuid FK cascade`
  - `wa_message_id text unique` (null allowed)
  - `direction text check in ('in','out')`
  - `sender text check in ('customer','moni','staff','system')`, `staff_user_id uuid null`
  - `kind text not null default 'text'`, `body text not null`, `media_url text`
  - `status text check in ('received','sent','failed','recorded')`, `created_at`
  - Index `(conversation_id, created_at)`
- **`leads`** [4.3]:
  - `id uuid PK`, `contact_id uuid unique FK cascade`
  - Project: `current_project_id int FK null`, `projects_of_interest int[] not null default '{}'`
  - Source: `source_channel text`, `source_content_kind text`, `source_ref text`
  - `stage text not null default 'new'`, with a check over the 12 stages in Task 6
  - Facts:
    - `name text`, `budget_price bigint`, `budget_monthly bigint`, `dp_budget bigint`, `bedrooms_wanted int`
    - `purpose text check in ('own_use','investment')`, `timeline text`, `domicile_area text`
    - `concerns text[] not null default '{}'`, `type_interest int[] not null default '{}'`
    - `hot_cold text check in ('hot','warm','cold')`, `lost_reason text`
  - `assigned_sales_id uuid null`, `summary jsonb` (both null until Milestone 3), `created_at`, `updated_at`
- **`lead_events`** [4.3]:
  - `id bigint identity PK`, `lead_id uuid FK cascade`
  - `kind text check in ('stage_changed','fact_updated','material_sent','material_failed','simulation_sent','handoff','opt_out','project_set','note')`
  - `payload jsonb not null default '{}'`, `actor text not null` (`moni` | `staff:<uuid>` | `system`), `created_at`
  - Index `(lead_id, created_at)`
- **`prompt_versions`** [5.2]: `id int identity PK`, `text text not null`, `created_by uuid null`, `created_at`

Settings (`settings/appSettings.ts`):
- `type AppSettings = { aiEnabled: boolean; personaGroupName: string; takeoverHours: number }`
- Defaults: `{ aiEnabled: true, personaGroupName: 'tim Vista Land', takeoverHours: 24 }`
- `getAppSettings(): Promise<AppSettings>` merges stored keys over the defaults.
- `updateAppSettings(patch: Partial<AppSettings>): Promise<AppSettings>`

- [ ] **Step 1: Write the schema files and generate** `0002_*.sql` (`npm --prefix api run db:generate`).
- [ ] **Step 2: Hand-check the migration:**
  - The `kpr_settings` unique index must read `NULLS NOT DISTINCT`. Add it by hand if drizzle omits it.
  - Every check constraint above must be present.
- [ ] **Step 3: Write the failing tests**

```ts
// schema-m2.test.ts (truncate the new tables first)
it('allows one default and one per-bank KPR row per project, not two defaults', async () => {
  await seedProjects(); const p = (await listProjects())[0]!;
  await getDb().insert(kprSettings).values({ projectId: p.id, bankId: null, fixedRatePct: 5, fixedYears: 3, floatingRatePct: 11, tenorOptions: [10, 15, 20], dpOptionsPct: [5] });
  await getDb().insert(kprSettings).values({ projectId: p.id, bankId: 2, fixedRatePct: 4.5, fixedYears: 3, floatingRatePct: 11, tenorOptions: [15], dpOptionsPct: [1] });
  await expect(getDb().insert(kprSettings).values({ projectId: p.id, bankId: null, fixedRatePct: 6, fixedYears: 3, floatingRatePct: 11, tenorOptions: [15], dpOptionsPct: [5] })).rejects.toThrow();
});
it('rejects an unknown lead stage and an unknown material kind', async () => { /* insert a lead with stage 'won' -> throws; a material with kind 'gif' -> throws */ });
it('keeps wa_message_id unique but allows many nulls', async () => { /* two null wamids ok, two 'wamid.X' throw */ });
// app-settings.test.ts
it('returns defaults when nothing is stored and merges a patch', async () => {
  expect(await getAppSettings()).toEqual({ aiEnabled: true, personaGroupName: 'tim Vista Land', takeoverHours: 24 });
  await updateAppSettings({ takeoverHours: 6 });
  expect((await getAppSettings()).takeoverHours).toBe(6);
});
```

- [ ] **Step 4: Run to verify failure** → FAIL (tables and module missing).
- [ ] **Step 5: Implement `appSettings.ts`, then run** `npm --prefix api run db:migrate` on the dev DB and `npm --prefix api test` → PASS.
- [ ] **Step 6: Commit:** `Add knowledge, conversation, lead and prompt tables`

---

### Task 3: KPR calculator, assumptions and settings API

**Files:**
- Create: `api/src/kpr/calculator.ts`, `api/src/kpr/assumptions.ts`, `api/src/routes/kpr.ts`
- Modify: `api/src/app.ts`
- Test: `api/tests/kpr-calculator.test.ts`, `api/tests/kpr-routes.test.ts`

**Interfaces:**
- Produces in `calculator.ts`:
  - `type KprAssumptions = { fixedRatePct: number; fixedYears: number; floatingRatePct: number; tenorOptions: number[]; dpOptionsPct: number[] }`
  - `monthlyAnnuity(principal: number, annualRatePct: number, months: number): number` (unrounded)
  - `type KprSimulation = { price: number; dpAmount: number; dpPct: number; loan: number; tenorYears: number; fixedRatePct: number; fixedYears: number; floatingRatePct: number; monthlyFixed: number; monthlyAfterFixed: number | null; note: 'persetujuan KPR mengikuti penilaian bank' }`. All rupiah values are rounded to whole rupiah.
  - `simulateKpr(input: { price: number; dpPct?: number; dpAmount?: number; tenorYears: number; assumptions: KprAssumptions }): KprSimulation`. DP is `dpAmount`, else `dpPct`, else `assumptions.dpOptionsPct[0]`. `monthlyAfterFixed` is null when `fixedYears * 12 >= tenor months`.
  - `parseDpFromSchemeName(name: string): number | null`: `/KPR\s*(\d{1,3})\s*%/i` gives `100 - n`; otherwise null.
- Produces in `assumptions.ts`:
  - `getKprAssumptions(projectId: number, bankId?: number | null): Promise<KprAssumptions | null>`. The bank row wins over the project default row; null when neither exists.
  - `listKprSettings(projectId)`
  - `upsertKprSettings(row)`
  - `getSchemeDpOverride(name): Promise<number | null>`
  - `setSchemeDpOverride(name, dpPct)`
- Routes (`requireApiSecret`):
  - `GET /api/v1/kpr-settings?projectId=` → rows
  - `PUT /api/v1/kpr-settings` with `{projectId, bankId|null, fixedRatePct (0–30), fixedYears (0–30), floatingRatePct (0–30), tenorOptions (1–30 each, ≥1 item), dpOptionsPct (0–100 each, ≥1 item), notes?}` → upserts the row
  - `GET /api/v1/scheme-dp-overrides`
  - `PUT /api/v1/scheme-dp-overrides` with `{schemeName, dpPct}`

- [ ] **Step 1: Write the failing tests.** The expected values were computed for these exact inputs.

```ts
const A = { fixedRatePct: 5, fixedYears: 3, floatingRatePct: 11, tenorOptions: [10, 15, 20], dpOptionsPct: [5] };
it('simulates 400 jt with 5% DP for 10, 15 and 20 years', () => {
  const s15 = simulateKpr({ price: 400_000_000, tenorYears: 15, assumptions: A });
  expect(s15).toMatchObject({ dpAmount: 20_000_000, loan: 380_000_000, monthlyFixed: 3_005_016, monthlyAfterFixed: 4_072_864 });
  expect(simulateKpr({ price: 400_000_000, tenorYears: 10, assumptions: A })).toMatchObject({ monthlyFixed: 4_030_490, monthlyAfterFixed: 4_882_712 });
  expect(simulateKpr({ price: 400_000_000, tenorYears: 20, assumptions: A })).toMatchObject({ monthlyFixed: 2_507_832, monthlyAfterFixed: 3_735_583 });
});
it('uses the scheme price and its 1% DP for BCA KPR 99%', () => {
  const dp = parseDpFromSchemeName('BCA KPR 99% BF 1JT PPN 0%')!;
  expect(dp).toBe(1);
  expect(simulateKpr({ price: 381_000_000, dpPct: dp, tenorYears: 15, assumptions: A })).toMatchObject({ dpAmount: 3_810_000, loan: 377_190_000, monthlyFixed: 2_982_794, monthlyAfterFixed: 4_042_747 });
});
it('has no after-fixed instalment when the fixed period covers the tenor', () => {
  expect(simulateKpr({ price: 400_000_000, tenorYears: 3, assumptions: A })).toMatchObject({ monthlyFixed: 11_388_941, monthlyAfterFixed: null });
});
it('handles a zero rate and reads no DP from cash schemes', () => {
  expect(Math.round(monthlyAnnuity(120_000_000, 0, 120))).toBe(1_000_000);
  expect(parseDpFromSchemeName('CASH KERAS BF 1JT PPN 0%')).toBeNull();
  expect(parseDpFromSchemeName('KPR 95% BF 1JT PPN 0%')).toBe(5);
});
it('always states the bank-approval note', () => {
  expect(simulateKpr({ price: 1, tenorYears: 1, assumptions: A }).note).toBe('persetujuan KPR mengikuti penilaian bank');
});
// kpr-routes.test.ts
it('a bank row overrides the project default', async () => { /* PUT default + bank 2; getKprAssumptions(p, 2).fixedRatePct === bank's; getKprAssumptions(p, 9) === default */ });
it('rejects an empty tenor list', async () => { /* PUT tenorOptions: [] -> 400 */ });
```

The fixed-then-floating rule:

```
fixed = annuity(loan, fixedRatePct, n)             # n = tenorYears*12
if fixedYears*12 >= n: after = null
else:
  k = fixedYears*12; r = fixedRatePct/1200
  balance = loan*(1+r)^k - fixed*((1+r)^k - 1)/r    # r == 0 -> loan - fixed*k
  after = annuity(balance, floatingRatePct, n - k)
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** `calculator.ts`, `assumptions.ts` and `routes/kpr.ts`.
- [ ] **Step 4: Run tests:** `npm --prefix api test` → PASS.
- [ ] **Step 5: Commit:** `Add the KPR calculator and settings`

---

### Task 4: Media storage and the catalog admin API

**Files:**
- Create: `api/src/media/storage.ts`, `api/src/routes/media.ts`, `api/src/routes/catalog.ts`
- Create: `api/src/repositories/typeProfiles.ts`, `materials.ts`, `promoCopy.ts`, `channelTags.ts`
- Modify: `api/src/repositories/projects.ts` (add `updateProject`), `api/src/app.ts`, `api/src/config.ts`, `api/package.json`, `deploy/docker-compose.yml` (volume `media:/app/media`, env `PUBLIC_BASE_URL=https://${DOMAIN}`, `MEDIA_DIR=/app/media`), `api/.env.example`, `deploy/.env.example`
- Test: `api/tests/media.test.ts`, `api/tests/catalog-routes.test.ts`

**Interfaces:**
- Config: `PUBLIC_BASE_URL` (url, default `http://localhost:50060`), `MEDIA_DIR` (default `./media`).
- `saveUpload(file: { filename: string; mimetype: string; stream: NodeJS.ReadableStream }): Promise<{ url: string; mime: string; filename: string; size: number }>`:
  - Stored as `<uuid>.<ext>`.
  - Allowed: `image/jpeg→jpg`, `image/png→png`, `video/mp4→mp4`, `application/pdf→pdf`.
  - Throws `MediaError('UNSUPPORTED_TYPE' | 'TOO_LARGE')`, deleting the partial file.
- `publicUrl(name: string): string` returns `${PUBLIC_BASE_URL}/media/${name}`.
- Routes:
  - `GET /media/:file` is public, served by `@fastify/static` from `MEDIA_DIR` (Caddy already routes `/media/*`).
  - `POST /api/v1/media` (multipart field `file`, `requireApiSecret`) → 201 `{data: {url, mime, filename, size}}`; 400 for `UNSUPPORTED_TYPE` or `TOO_LARGE`.
- Routes, all `requireApiSecret`:
  - **Projects:**
    - `GET /api/v1/projects`
    - `PATCH /api/v1/projects/:id`, accepting `{displayName, personaTeamName, locationLabel, mapsUrl, accessNotes, galleryHours, visitMinutes, sameDayMinNoticeMinutes, vlesAreaIds, subsidiNotes, active}`, each optional. `galleryHours` has the shape `{ "1": ["09:00","17:00"], …, "7": null }` (ISO weekday → open/close or null).
  - **Types:**
    - `GET /api/v1/projects/:id/types` → the VLES house types found in the project's areas (`vles_units` grouped), each with its `type_profiles` row merged (or null)
    - `PUT /api/v1/type-profiles/:houseTypeId` with `{projectId, marketingName, bedrooms, bathrooms, floors, highlights, active}`
  - **Materials:**
    - `GET /api/v1/materials?projectId=`
    - `POST /api/v1/materials` with `{projectId, houseTypeId?, kind, url, mime, filename, validFrom?, validTo?, sort?}`
    - `PATCH /api/v1/materials/:id`
    - `DELETE /api/v1/materials/:id` sets `active=false`
  - **Promos:**
    - `GET /api/v1/promos?projectId=` → that project's `vles_promos` rows (not deleted), each with `promo_copy` merged and `isUsable`
    - `PUT /api/v1/promo-copy/:vlesPromoId` with `{customerText, termsText?}`
  - **Channel tags:**
    - `GET /api/v1/channel-tags`
    - `PUT /api/v1/channel-tags/:tag` with `{projectId, channel, contentKind}`; the tag is upper-cased and must match `/^[A-Z0-9-]{2,24}$/`
    - `DELETE /api/v1/channel-tags/:tag`
- Types: `type MaterialKind = 'flyer' | 'video' | 'promo' | 'floor_plan' | 'brochure' | 'photo'`; `type Material = typeof materials.$inferSelect`.
- Repositories export:
  - `listMaterials(projectId)`
  - `activeMaterials(projectId: number, kind: MaterialKind, houseTypeId: number | null, today: string /*YYYY-MM-DD WIB*/): Promise<Material[]>`. Rows must be active and within `valid_from..valid_to`, null meaning open. When `houseTypeId` is given, type-specific rows come first, then project-wide ones. Sorted by `sort` then `id`.
  - `getTypeProfile(houseTypeId)`
  - `listChannelTags()`, `findChannelTag(tag)`
  - `getPromoCopy(id)`

- [ ] **Step 1: Write the failing tests**

```ts
// media.test.ts (MEDIA_DIR set to a temp dir in the test)
it('stores a png and serves it publicly', async () => { /* inject multipart POST /api/v1/media with a 1x1 png -> 201, url ends .png; GET /media/<name> -> 200 image/png without auth */ });
it('rejects webp and files over 16 MB', async () => { /* webp -> 400 UNSUPPORTED_TYPE; 16 MB + 1 byte mp4 -> 400 TOO_LARGE and no file left in MEDIA_DIR */ });
// catalog-routes.test.ts
it('patches a project profile including its VLES areas', async () => { /* PATCH mapsUrl + vlesAreaIds [37, 40] -> returned row has both */ });
it('lists house types from the project areas with their profile merged', async () => { /* seed vles units in area 37 for type 500; PUT profile bedrooms 2; GET types -> [{houseTypeId: 500, profile: {bedrooms: 2}}] */ });
it('activeMaterials honours validity and prefers type-specific rows', async () => {
  // project-wide flyer (sort 0), type-500 flyer (sort 5), expired flyer (valid_to yesterday)
  // activeMaterials(p, 'flyer', 500, today) -> [type-500 flyer, project-wide flyer]
});
it('normalises and validates channel tags', async () => { /* PUT 'ztr-reels' -> stored 'ZTR-REELS'; PUT 'bad tag!' -> 400 */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.**
  - `npm --prefix api i @fastify/multipart@^10 @fastify/static@^9`.
  - Register multipart with `limits.fileSize = 16 * 1024 * 1024`.
  - Stream to a temp name, check `truncated`, then rename into place.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit:** `Store media and manage projects, types, materials, promos and channel tags`

---

### Task 5: Knowledge services the agent's tools call

**Files:**
- Create: `api/src/knowledge/units.ts`, `availability.ts`, `simulation.ts`, `facts.ts`
- Test: `api/tests/knowledge.test.ts`

**Interfaces:**
- Consumes:
  - `projects`, `vles_units`, `vles_unit_schemes`, `vles_promos`, `type_profiles`, `promo_copy`
  - `getKprAssumptions`, `simulateKpr`, `parseDpFromSchemeName`, `getSchemeDpOverride` (Task 3)
  - `VlesClient.getUnit` (Milestone 1)
  - `formatRupiahShort` logic. Copy it into `api/src/knowledge/format.ts` with the same tests as `dashboard/lib/format.ts`; the packages don't share code.
- Produces:
  - `findProjectBySlug(slug): Promise<Project | null>`
  - `searchUnits(input: { projectId: number; bedrooms?: number; maxPrice?: number; maxMonthly?: number; salesCategory?: 'subsidi' | 'komersil' }): Promise<{ types: TypeOption[]; nearest: boolean }>`, where `TypeOption = { houseTypeId: number; name: string; marketingName: string | null; bedrooms: number | null; landSizeMin: number | null; landSizeMax: number | null; buildingSize: number | null; availableUnits: number; fromPrice: number; fromKprSchemePrice: number | null; estMonthlyFrom: number | null }`
    - Only types with at least one available, priced unit are included.
    - A `bedrooms` filter excludes types whose profile has no bedroom count.
    - `maxPrice` and `maxMonthly` keep types at or under the limit. If none remain, it returns the 2 cheapest with `nearest: true`.
    - `estMonthlyFrom` comes from `simulateKpr` on `fromKprSchemePrice ?? fromPrice`, using that scheme's parsed DP or `dpOptionsPct[0]`, and `max(tenorOptions)`. It is null when the project has no assumptions.
    - Sorted by `fromPrice`, at most 5.
  - `getTypeDetails(projectId: number, houseTypeId: number): Promise<TypeDetails | null>`, where `TypeDetails = TypeOption & { bathrooms, floors, highlights, maxPrice: number; schemes: { name: string; fromPrice: number; dpPct: number | null }[]; promos: { id: number; name: string; benefitType: string | null; benefitAmount: number | null; customerText: string | null; termsText: string | null }[]; materialKinds: MaterialKind[] }`
    - Promos are `is_usable` only, for the project and the type's sales category.
    - Schemes are distinct by name, using the minimum price among available units of the type.
  - `checkAvailability(client: VlesClient | null, input: { projectId: number; houseTypeId: number; facing?: string; max?: number }): Promise<{ verified: true; units: { unitNumber: string; facing: string | null; price: number | null }[]; checkedAt: string } | { verified: false; reason: 'NOT_CONFIGURED' | 'VLES_UNAVAILABLE' | 'NONE_AVAILABLE' }>`
    - Candidates are up to `max` (default 3) locally available units, filtered by facing (case-insensitive) when given.
    - Each candidate is fetched live with `getUnit`. Only units whose live data is still `is_available_for_sale && !deleted` are kept.
    - If every call throws: `VLES_UNAVAILABLE`. If all answers say sold: `NONE_AVAILABLE`.
  - `simulateForType(input: { projectId: number; houseTypeId: number; dpPct?: number; dpAmount?: number; tenorYears?: number[] }): Promise<{ schemeName: string | null; price: number; simulations: KprSimulation[] } | { error: 'NO_KPR_SETTINGS' | 'NO_PRICE' }>`
    - The price is the cheapest KPR scheme (`/KPR/i`) across available units of the type, falling back to the cheapest list price.
    - DP is the input, else the parsed scheme DP, else the override, else `dpOptionsPct[0]`.
    - Tenors are the input, else `tenorOptions`.
  - `buildProjectFacts(projectId: number | null, today: string): Promise<string>`. This is the plain-text block injected into the prompt (format below). For `null`, it lists every active project as one line: name, location, from-price, available units.

Format of `buildProjectFacts` for a known project (amounts via `formatRupiahShort`; empty fields omitted):

```
PROYEK: Zetira (tim Zetira) — Cibitung
Peta: <mapsUrl>
Akses: <accessNotes>
Jam galeri: Sen–Sab 09.00–17.00
Tipe tersedia:
- ZETIRA BELVIA (2 KT) LT 62–103 / LB 33 m² — 31 unit — mulai Rp400 jt (skema KPR mulai Rp381 jt)
Promo berlaku:
- PROMO X: potongan booking fee Rp500 rb. <customerText>
Catatan subsidi: <subsidiNotes>
Asumsi KPR: bunga tetap 5% 3 tahun, lalu 11%; tenor 10/15/20 tahun; DP 5%
```

- [ ] **Step 1: Write the failing tests.** Seed projects, `vles_units` via `seedUnits`, and schemes via `replaceUnitSchemes`. Use a `fakeClient` whose `getUnit` is scripted.

```ts
it('searchUnits filters by bedrooms and budget and estimates the monthly instalment', async () => {
  // types 500 (profile 2 KT; unit 400 jt with scheme 'BCA KPR 99%' at 381 jt) and 501 (profile 3 KT; 465.5 jt); KPR default A from Task 3
  const r = await searchUnits({ projectId: zetira.id, bedrooms: 2 });
  expect(r.types.map((t) => t.houseTypeId)).toEqual([500]);
  expect(r.types[0]).toMatchObject({ fromPrice: 400_000_000, fromKprSchemePrice: 381_000_000, estMonthlyFrom: 2_489_287 }); // DP 1%, 20 years, 5% fixed
  expect((await searchUnits({ projectId: zetira.id, maxPrice: 420_000_000 })).types.map((t) => t.houseTypeId)).toEqual([500]);
});
it('searchUnits returns the two cheapest as nearest when nothing fits the budget', async () => {
  const r = await searchUnits({ projectId: zetira.id, maxPrice: 300_000_000 });
  expect(r.nearest).toBe(true);
  expect(r.types.map((t) => t.houseTypeId)).toEqual([500, 501]);
});
it('getTypeDetails lists distinct schemes with parsed DP and only usable promos', async () => {
  // type 500 has two units sharing schemes 'KPR 95% BF 1JT' and 'CASH KERAS'; promos: 'PROMO USABLE' (usable, komersil) and one not usable
  const d = (await getTypeDetails(zetira.id, 500))!;
  expect(d.schemes).toEqual(expect.arrayContaining([{ name: 'KPR 95% BF 1JT', fromPrice: 400_000_000, dpPct: 5 }, { name: 'CASH KERAS', fromPrice: 400_000_000, dpPct: null }]));
  expect(d.promos.map((p) => p.name)).toEqual(['PROMO USABLE']);
});
it('availability keeps only units VLES still sells', async () => {
  // 3 local candidates; live getUnit: the first now has is_available_for_sale false, the other two true
  const r = await checkAvailability(client, { projectId: zetira.id, houseTypeId: 500 });
  expect(r).toMatchObject({ verified: true });
  if (r.verified) expect(r.units).toHaveLength(2);
});
it('availability is unverified when VLES fails', async () => { /* getUnit throws for all -> {verified:false, reason:'VLES_UNAVAILABLE'}; client null -> NOT_CONFIGURED */ });
it('simulateForType reports NO_KPR_SETTINGS without assumptions', async () => {
  expect(await simulateForType({ projectId: granHarmoni.id, houseTypeId: 32 })).toEqual({ error: 'NO_KPR_SETTINGS' });
});
it('buildProjectFacts renders the project block with the exact lines above', async () => { /* snapshot the string for a seeded Zetira */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit:** `Add stock search, type details, live availability and KPR simulation for Moni`

---

### Task 6: Leads domain — contacts, conversations, messages, stages, events

**Files:**
- Create: `api/src/leads/stages.ts`, `api/src/leads/repository.ts`, `api/src/leads/state.ts`
- Test: `api/tests/leads-domain.test.ts`

**Interfaces:**
- `stages.ts`:
  - `LEAD_STAGES = ['new','engaged','qualified','recommended','visit_proposed','visit_scheduled','visit_confirmed','visited','no_show','cancelled','lost','opted_out'] as const`
  - `type LeadStage`
  - `canMoniSetStage(from: LeadStage, to: LeadStage): boolean`. True only for:
    - a forward move along `new → engaged → qualified → recommended → visit_proposed` (skipping steps allowed);
    - `→ lost` from any of those five;
    - `lost → engaged`.

    The visit stages belong to Milestone 3, and `opted_out` is set only by `optOut`.
- Types: `Contact`, `Conversation`, `Message`, `Lead`, `LeadEvent` are the tables' `$inferSelect`; `type LeadEventKind` is the 9 kinds from Task 2; `type LeadFactsPatch = { name?: string; budgetPrice?: number; budgetMonthly?: number; dpBudget?: number; bedroomsWanted?: number; purpose?: 'own_use' | 'investment'; timeline?: string; domicileArea?: string; addConcerns?: string[]; addTypeInterest?: number[]; hotCold?: 'hot' | 'warm' | 'cold'; lostReason?: string }`.
- `repository.ts`:
  - `getContact(id)`, `getLead(id)`, `getConversation(id)`
  - `upsertContact(waPhone: string, displayName: string | null, isTest?: boolean): Promise<Contact>`
  - `ensureConversation(contactId: string, waPhoneNumberId: string | null): Promise<Conversation>`
  - `ensureLead(contactId: string): Promise<Lead>`
  - `insertInbound(conversationId: string, m: { waMessageId: string | null; kind: string; body: string; mediaUrl?: string | null; createdAt: Date }): Promise<{ id: string } | 'duplicate'>`
  - `insertOutbound(conversationId: string, m: { sender: 'moni' | 'staff' | 'system'; staffUserId?: string | null; kind: string; body: string; mediaUrl?: string | null; waMessageId: string | null; status: 'sent' | 'failed' | 'recorded' }): Promise<{ id: string }>`
  - `recentMessages(conversationId: string, limit: number): Promise<Message[]>` (oldest first)
  - `customerMessagesSince(conversationId: string, since: Date): Promise<Message[]>`
  - `lastOutboundAt(conversationId): Promise<Date | null>`
  - `updateLeadFacts(leadId: string, patch: LeadFactsPatch, actor: string): Promise<Lead>` records one `fact_updated` event listing the changed keys, and appends `concerns`, `typeInterest` and `projectsOfInterest` without duplicates.
  - `setLeadStage(leadId: string, to: LeadStage, actor: string, opts?: { force?: boolean }): Promise<Lead>`. Throws `StageError` unless `force` is set or `canMoniSetStage` allows it. Records `stage_changed {from, to}`.
  - `setLeadProject(leadId: string, projectId: number, actor: string, source?: { channel: string | null; contentKind: string | null; ref: string | null })` sets the current project, adds it to `projectsOfInterest`, fills the source fields only while they are still null, and records `project_set`.
  - `recordEvent(leadId: string, kind: LeadEventKind, payload: object, actor: string)`
  - `listEvents(leadId: string, kinds?: LeadEventKind[]): Promise<LeadEvent[]>`
  - `optOut(contactId: string, leadId: string, actor: string)` sets `opted_out_at`, forces stage `opted_out`, and records `opt_out`.
  - `setTakeover(conversationId: string, until: Date | null, actor: string, reason?: string)` records a `handoff` event when `until` is set.
  - `isUnderTakeover(c: Conversation, now: Date): boolean`
- `state.ts`: `buildLeadState(lead: Lead, events: LeadEvent[]): string` is the plain-text block for the prompt:

```
STATUS LEAD: qualified
Nama: Sari · Budget: Rp400 jt · Cicilan: Rp3 jt/bulan · DP: — · Kamar: 2 · Tujuan: ditempati · Waktu: 3 bulan · Domisili: Bekasi
Keraguan: takut KPR tidak disetujui
Materi sudah dikirim: flyer (flyer-zetira.jpg), video (zetira.mp4)
Simulasi sudah dikirim: ZETIRA BELVIA Rp381 jt, DP 1%, 15 th: Rp2,98 jt/bulan (3 th pertama), lalu Rp4,04 jt
```

- [ ] **Step 1: Write the failing tests**

```ts
it('allows Moni forward moves and lost, refuses backward and visit stages', () => {
  expect(canMoniSetStage('engaged', 'recommended')).toBe(true);
  expect(canMoniSetStage('recommended', 'engaged')).toBe(false);
  expect(canMoniSetStage('qualified', 'visit_scheduled')).toBe(false);
  expect(canMoniSetStage('lost', 'engaged')).toBe(true);
});
it('insertInbound reports a duplicate wamid', async () => { /* same wamid twice -> second 'duplicate' */ });
it('updateLeadFacts appends concerns without duplicates and records one event', async () => {
  await updateLeadFacts(lead.id, { addConcerns: ['jauh'] }, 'moni');
  const l = await updateLeadFacts(lead.id, { addConcerns: ['jauh', 'kpr'], budgetMonthly: 3_000_000 }, 'moni');
  expect(l.concerns).toEqual(['jauh', 'kpr']);
  expect((await listEvents(lead.id, ['fact_updated']))[0]!.payload).toEqual({ keys: ['concerns', 'budgetMonthly'] });
});
it('setLeadProject keeps the first source and adds to projects of interest', async () => {
  await setLeadProject(lead.id, zetira.id, 'system', { channel: 'instagram', contentKind: 'reels', ref: 'ZTR-REELS' });
  const l = await setLeadProject(lead.id, ghp.id, 'moni', { channel: 'tiktok', contentKind: 'general', ref: 'x' });
  expect(l).toMatchObject({ currentProjectId: ghp.id, projectsOfInterest: [zetira.id, ghp.id], sourceChannel: 'instagram', sourceRef: 'ZTR-REELS' });
});
it('optOut forces the stage and timestamps the contact', async () => {
  await optOut(contact.id, lead.id, 'moni');
  expect((await getLead(lead.id)).stage).toBe('opted_out');
  expect((await getContact(contact.id)).optedOutAt).not.toBeNull();
});
it('buildLeadState lists materials and simulations already sent', async () => { /* events material_sent + simulation_sent -> the two lines above */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit:** `Add the leads domain: contacts, conversations, messages, stages and events`

---

### Task 7: ChakraHQ client, webhook parsing and project detection

**Files:**
- Create: `api/src/chakra/client.ts`, `signature.ts`, `parse.ts`, `detectProject.ts`, `api/src/routes/webhook.ts`
- Create: `api/tests/fixtures/chakra/*.json` (hand-written in Meta's webhook format; see Step 1)
- Modify: `api/src/config.ts`, `api/src/app.ts`, `api/.env.example`, `deploy/docker-compose.yml`, `deploy/.env.example`
- Test: `api/tests/chakra.test.ts`

**Port reference:** vinindo `routes/webhooks.ts:14-217` (raw body, HMAC, parsing, ack-first) and `services/chakraClient.ts:25-75` (send URL and payloads).

**Interfaces:**
- Config:
  - `CHAKRA_BASE_URL` (default `https://api.chakrahq.com`), `CHAKRA_PLUGIN_ID` (`''`), `CHAKRA_API_VERSION` (`v22.0`), `CHAKRA_ACCESS_TOKEN` (`''`), `CHAKRA_WEBHOOK_SECRET` (`''`)
  - `SKIP_HMAC_IN_DEV` (`false`; honoured only when `NODE_ENV=development`)
- `verifyChakraSignature(rawBody: Buffer, header: string | undefined, secret: string): boolean`: header `x-chakra-signature-256` is the lowercase hex of `HMAC-SHA256(secret, rawBody)` with **no** `sha256=` prefix. Use a timing-safe compare after the length check. An empty secret returns false.
- `type InboundMessage = { waMessageId: string; from: string; profileName: string | null; phoneNumberId: string; sentAt: Date; kind: 'text' | 'image' | 'document' | 'audio' | 'video' | 'other'; text: string; mediaId: string | null; referral: { sourceUrl: string | null; sourceType: string | null; headline: string | null; body: string | null } | null }`
- `parseWebhook(body: unknown): InboundMessage[]` walks `entry[].changes[].value.messages[]`:
  - `text` = `text.body`, else the image or document caption, else `''`.
  - Skips `reaction`, `edit` and `revoke`.
  - Ignores `value.statuses`.
  - `phoneNumberId` comes from `value.metadata.phone_number_id`, and `profileName` from the `value.contacts[]` entry with the same `wa_id`.
  - `referral` comes from Meta's Click-to-WhatsApp `message.referral` (`source_url`, `source_type`, `headline`, `body`) when present. Whether Chakra passes it on is unconfirmed (spec 11.8).
- `detectProject(msg: { text: string; referral: InboundMessage['referral'] }): Promise<{ projectId: number; channel: string | null; contentKind: string | null; ref: string } | null>` tries, in order:
  1. A `[TAG]` in the text, `/\[([A-Za-z0-9-]{2,24})\]/`, upper-cased and looked up in `channel_tags`. `ref` is the tag.
  2. The referral `headline`/`body`/`source_url`, matched case-insensitively against each tag and each active project's `display_name`. A match by name gets `channel 'other'`, `contentKind 'general'`, and `ref` = `source_url ?? headline`.
  3. Otherwise null.
- `type ChakraSend = { waMessageId: string | null }`
- `createChakraClient(cfg: { baseUrl; pluginId; apiVersion; accessToken; fetch?: typeof fetch }): ChakraClient` with:
  - `sendText(phoneNumberId: string, to: string, body: string): Promise<ChakraSend>`
  - `sendMedia(phoneNumberId: string, to: string, m: { kind: 'image' | 'video' | 'document'; link: string; caption?: string; filename?: string }): Promise<ChakraSend>`

  Both POST to `${baseUrl}/v1/ext/plugin/whatsapp/${pluginId}/api/${apiVersion}/${phoneNumberId}/messages` with `Authorization: Bearer <token>`:
  - Text body: `{messaging_product:'whatsapp', to, type:'text', text:{body}}`
  - Media body: `{messaging_product:'whatsapp', to, type:<kind>, <kind>:{link, caption?|filename?}}`. Documents take `filename` and no caption.
  - The wamid is read from `_data.whatsappMessageId`, or null.
  - Spec 8: a 5xx answer or a network error is retried after 1000, 2000 and 4000 ms (injectable `sleep`). A 4xx, or a 5xx after the last retry, throws `ChakraError(status, bodyText)`. The router stores a failed send with status `failed`.
- `toWhatsAppMarkup(text: string): string`:
  - `**x**` → `*x*`
  - `[label](url)` → `label url`
  - Strips leaked `<parameter…>` tags
  - Turns literal `\n` into newlines
- `webhookRoutes`:
  - `GET /webhook` returns 200 `OK`.
  - `POST /webhook`:
    - Uses a raw-body JSON parser scoped to this plugin.
    - A bad signature still answers **200** and nothing is processed.
    - Otherwise it answers 200 first, then calls `onInbound(msg)` for each parsed message in the background. `onInbound` is injected; Task 10 wires the router.

- [ ] **Step 1: Write the fixtures and failing tests.**
  - Fixtures are Meta-format envelopes:
    - `inbound-text.json`: text "Halo [ZTR-REELS] mau tanya promo"
    - `inbound-image.json`: image with caption "ini rumahnya?"
    - `inbound-audio.json`: audio
    - `inbound-status.json`: `statuses` only
    - `inbound-referral.json`: text with `referral {source_url, source_type:'ad', headline:'Promo Zetira Cibitung'}`
  - Each uses `metadata.phone_number_id: "PNID-1"` and `contacts: [{wa_id:"6281234567890", profile:{name:"Sari"}}]`.

```ts
it('verifies the Chakra signature over the raw bytes', () => {
  const raw = Buffer.from(JSON.stringify(fixture('inbound-text.json')));
  const sig = createHmac('sha256', 's3cret').update(raw).digest('hex');
  expect(verifyChakraSignature(raw, sig, 's3cret')).toBe(true);
  expect(verifyChakraSignature(raw, 'sha256=' + sig, 's3cret')).toBe(false);
  expect(verifyChakraSignature(raw, sig, '')).toBe(false);
});
it('parses text, captions, audio, referral; ignores statuses', () => {
  expect(parseWebhook(fixture('inbound-text.json'))[0]).toMatchObject({ from: '6281234567890', profileName: 'Sari', phoneNumberId: 'PNID-1', kind: 'text' });
  expect(parseWebhook(fixture('inbound-image.json'))[0]).toMatchObject({ kind: 'image', text: 'ini rumahnya?' });
  expect(parseWebhook(fixture('inbound-audio.json'))[0]!.kind).toBe('audio');
  expect(parseWebhook(fixture('inbound-status.json'))).toEqual([]);
  expect(parseWebhook(fixture('inbound-referral.json'))[0]!.referral).toMatchObject({ headline: 'Promo Zetira Cibitung' });
});
it('detects the project from a tag, then from the ad referral, else null', async () => {
  // channel_tags: ZTR-REELS -> zetira (instagram, reels)
  expect(await detectProject({ text: 'Halo [ztr-reels]', referral: null })).toMatchObject({ projectId: zetira.id, channel: 'instagram', contentKind: 'reels', ref: 'ZTR-REELS' });
  expect(await detectProject({ text: 'halo', referral: { headline: 'Promo Zetira Cibitung', sourceUrl: 'https://fb.me/ad1', sourceType: 'ad', body: null } })).toMatchObject({ projectId: zetira.id, channel: 'other', ref: 'https://fb.me/ad1' });
  expect(await detectProject({ text: 'halo', referral: null })).toBeNull();
});
it('POST /webhook acks 200 on a bad signature and processes nothing', async () => { /* inject with wrong header; onInbound spy not called */ });
it('POST /webhook acks then hands each message to onInbound', async () => { /* correct signature; spy called once with parsed message */ });
it('sendText posts the Meta payload and returns the wamid', async () => { /* fake fetch asserts URL, bearer, body; returns {_data:{whatsappMessageId:'wamid.A'}} */ });
it('sendMedia sends a document with filename and no caption; throws ChakraError on 400', async () => {
  // body.document equals { link, filename: 'brosur.pdf' } with no caption; a 400 answer -> ChakraError status 400 after one call
});
it('retries a 503 three times, then throws', async () => { /* four calls; sleeps [1000, 2000, 4000]; ChakraError 503 */ });
it('toWhatsAppMarkup converts bold and links', () => { expect(toWhatsAppMarkup('**Promo** [peta](https://m.ps/x)')).toBe('*Promo* peta https://m.ps/x'); });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** Add the Chakra env to compose (`CHAKRA_*: ${CHAKRA_*:-}`) and to both env examples.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit:** `Receive and send WhatsApp messages through ChakraHQ`

---

### Task 8: Reply checks

**Files:**
- Create: `api/src/agent/rupiah.ts`, `api/src/agent/replyChecks.ts`
- Test: `api/tests/reply-checks.test.ts`

**Interfaces:**
- `type RupiahMention = { raw: string; value: number; tolerance: number }`
- `parseRupiahMentions(text: string): RupiahMention[]`. A mention needs `Rp`, a unit word (`rb|ribu|jt|juta|M|miliar|milyar`), or both. Bare numbers ("15 tahun", "2 kamar", "5%") are not money.
  - In Indonesian notation, `.` followed by exactly 3 digits is a thousands separator, and `,` is the decimal mark.
  - `tolerance` is half of one unit of the last stated digit times the multiplier:
    - `Rp465,5 jt` → value 465 500 000, tolerance 50 000
    - `Rp400 jt` → 400 000 000, tolerance 500 000
    - `Rp2.834.123` → 2 834 123, tolerance 0.5
    - `Rp1,2 M` → 1 200 000 000, tolerance 50 000 000
    - `500 ribu` → 500 000, tolerance 500
- `collectAmounts(value: unknown): number[]` returns every number ≥ 1 000 found in a JSON value, plus every `parseRupiahMentions` value found in its strings.
- `type ReplyEvidence = { knownAmounts: number[]; toolsCalled: Set<string>; verifiedUnitNumbers: string[]; subsidiNotes: string | null }`
- `checkReply(text: string, ev: ReplyEvidence): { ok: true } | { ok: false; problems: string[] }`. Each problem string is in Bahasa Indonesia, because it is fed back to the model.
  1. **Unverified amount:** every mention must match some known amount within its tolerance. Problem: `Nominal "<raw>" tidak ada di data alat atau fakta proyek. Pakai angka dari alat saja.`
  2. **Promised approval:** `/(pasti|dijamin|100%)\s*(di)?(setujui|acc|lolos|approve)/i` and `/kpr(nya)?\s+(pasti|dijamin)/i`. Problem: `Jangan menjanjikan persetujuan KPR/subsidi.`
  3. **Scarcity claim:** `/\b(tinggal|sisa|hampir habis|segera habis|terbatas)\b/i` is allowed only if `search_units` or `check_availability` is in `toolsCalled`. Problem: `Klaim kelangkaan tanpa data stok.`
  4. **Unverified unit number:** every match of `/\b[A-Z]{1,3}\d{0,2}\/\d{1,3}[A-Z]?\b/` must be in `verifiedUnitNumbers`. Problem: `Unit <x> belum dicek ketersediaannya.`
  5. **Subsidy eligibility:** `/memenuhi syarat|lolos (syarat )?subsidi|berhak (mendapat(kan)? )?subsidi/i` is allowed only when `subsidiNotes` is non-null. Problem: `Jangan menilai kelayakan subsidi.`

- [ ] **Step 1: Write the failing tests**

```ts
it('parses rupiah with precision-based tolerance', () => {
  expect(parseRupiahMentions('mulai Rp465,5 jt atau Rp 400 juta, cicilan Rp2.834.123')).toEqual([
    { raw: 'Rp465,5 jt', value: 465_500_000, tolerance: 50_000 },
    { raw: 'Rp 400 juta', value: 400_000_000, tolerance: 500_000 },
    { raw: 'Rp2.834.123', value: 2_834_123, tolerance: 0.5 },
  ]);
  expect(parseRupiahMentions('tenor 15 tahun, 2 kamar, DP 5%')).toEqual([]);
  expect(parseRupiahMentions('Rp1,2 M')[0]).toMatchObject({ value: 1_200_000_000, tolerance: 50_000_000 });
});
const ev = (o: Partial<ReplyEvidence> = {}): ReplyEvidence => ({ knownAmounts: [465_520_000, 3_005_016], toolsCalled: new Set(), verifiedUnitNumbers: [], subsidiNotes: null, ...o });
it('accepts rounded known amounts and rejects invented ones', () => {
  expect(checkReply('Harganya Rp465,5 jt, cicilan sekitar Rp3 jt/bulan', ev()).ok).toBe(true);
  const r = checkReply('Harganya Rp450 jt', ev());
  expect(r.ok).toBe(false);
});
it('rejects promised approval and unsupported scarcity', () => {
  expect(checkReply('KPR-nya pasti disetujui kok Kak', ev()).ok).toBe(false);
  expect(checkReply('Unitnya tinggal sedikit Kak', ev()).ok).toBe(false);
  expect(checkReply('Unitnya tinggal sedikit Kak', ev({ toolsCalled: new Set(['search_units']) })).ok).toBe(true);
});
it('a unit number without a verified check is rejected', () => {
  expect(checkReply('Unit D3/15 masih tersedia', ev()).ok).toBe(false);
  expect(checkReply('Unit D3/15 masih tersedia', ev({ verifiedUnitNumbers: ['D3/15'] })).ok).toBe(true);
});
it('subsidy eligibility needs admin notes', () => {
  expect(checkReply('Kakak berhak subsidi', ev()).ok).toBe(false);
});
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit:** `Check every reply for invented amounts, promises and unverified claims`

---

### Task 9: The Moni agent — prompt, tools and the Claude tool loop

**Before starting:** load the `claude-api` skill and read `typescript/claude-api/README.md` and `tool-use.md` (Manual Agentic Loop, Tool Choice).

**Files:**
- Create: `api/src/agent/prompts/system.md`, `api/src/agent/prompts/flow-moni.md`, `prompt.ts`, `tools.ts`, `executor.ts`, `claude.ts`, `loop.ts`
- Create: `api/src/repositories/promptVersions.ts`
- Modify: `api/scripts/seed.ts` (seed `prompt_versions` from `flow-moni.md` when empty), `api/src/config.ts`, `api/package.json` (`@anthropic-ai/sdk ^1.3.0`), compose and env examples (`ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `CLAUDE_EFFORT`)
- Test: `api/tests/agent-tools.test.ts`, `api/tests/agent-loop.test.ts`

**Interfaces:**
- Config: `ANTHROPIC_API_KEY` (default `''`, which makes every turn fail with reason `AI_NOT_CONFIGURED`), `CLAUDE_MODEL` (default `claude-opus-5-5`), `CLAUDE_EFFORT` (`low|medium|high`, default `medium`).
- `flow-moni.md`: the FLOW MONI playbook, converted from `/Users/claytonmildy/Downloads/FLOW MONI.docx` with `textutil -convert txt` and tidied into Markdown headings (one `##` per numbered step). The wording stays unchanged.
- `system.md` holds the stable rules, in Bahasa Indonesia, ≤ 1 500 words. It must cover:
  - **Identity:** Moni, an AI sales assistant, honest when asked whether it is an AI. It speaks as "Moni dari tim <persona>" using the persona in the facts block, or the group persona when no project is known; in that case it asks which area the customer is interested in.
  - **Answer first:** answer the customer's question first; the flow is a guide, not a script; never repeat questions or materials listed under "sudah dikirim".
  - **Facts:** prices, promos, stock and simulations come only from tool results or PROYEK facts. No promised KPR approval. No scarcity without a count. Run `check_availability` before naming a unit or saying a position is available. Never judge subsidy eligibility; quote the subsidy notes only.
  - **Materials:** call `send_materials`, never paste links to flyers or videos. The Maps link from the facts may be written in text.
  - **Visits (until Milestone 3):** when the customer wants to visit, ask weekday or weekend, then the time, save them with `update_lead` (stage `visit_proposed`, timeline), then call `handoff_to_human` with reason `jadwal kunjungan`, and tell the customer the team will confirm the schedule and the sales person.
  - **Handoff:** for complaints, price negotiation, or anything outside buying a home, or when the customer asks for a person: call `handoff_to_human`, then send a short note.
  - **Opt-out:** when the customer asks not to be contacted, call `opt_out` and say goodbye politely.
  - **Output:** every turn ends with exactly one call to `respond_to_customer`. Never write the reply as plain text. WhatsApp style: short paragraphs, `*bold*` sparingly, emoji like the playbook.
- `prompt.ts`:
  - `buildSystemBlocks(input: { flowText: string; persona: string; projectFacts: string; leadState: string; nowWib: string }): Anthropic.Beta.BetaTextBlockParam[]`
  - Returns `[ {text: system.md + "\n\n# FLOW MONI\n" + flowText, cache_control: {type: 'ephemeral', ttl: '1h'}}, {text: "PERSONA: …\nWAKTU: …\n\n" + projectFacts}, {text: leadState} ]`.
  - The first block depends only on build files and the current prompt version, so it stays cache-stable.
- `tools.ts`:
  - `MONI_TOOLS: Anthropic.Beta.BetaTool[]` in this fixed order, with schemas exactly as listed (no `strict`; snake_case keys; descriptions in Bahasa Indonesia):

| Tool | Input |
|---|---|
| `search_units` | `project` string (slug); `bedrooms` int?; `max_price` int?; `max_monthly` int?; `sales_category` `subsidi\|komersil`? |
| `get_type_details` | `project` string; `house_type_id` int |
| `check_availability` | `project` string; `house_type_id` int; `facing` string? |
| `simulate_kpr` | `project` string; `house_type_id` int; `dp_pct` number?; `dp_amount` int?; `tenor_years` int[]? |
| `send_materials` | `kind` `flyer\|video\|promo\|floor_plan\|brochure\|photo`; `project` string; `house_type_id` int?; `resend` bool? |
| `update_lead` | any of `name`, `budget_price`, `budget_monthly`, `dp_budget`, `bedrooms_wanted`, `purpose` `own_use\|investment`, `timeline`, `domicile_area`, `add_concerns` string[], `add_type_interest` int[], `project` string, `hot_cold` `hot\|warm\|cold`, `stage` (Moni-settable stages), `lost_reason` |
| `handoff_to_human` | `reason` string |
| `opt_out` | (none) |
| `respond_to_customer` | `message` string; `no_reply` bool; `materials_position` `before\|after` (default `after`) |

  - `TOOL_INPUTS: Record<ToolName, z.ZodType>` holds the matching zod schemas used to validate inputs.
- `executor.ts`:
  - `type TurnContext = { leadId: string; contactId: string; projectId: number | null; vles: VlesClient | null; today: string; queuedMaterials: QueuedMaterial[]; evidence: ReplyEvidence; handoffReason: string | null; simulations: object[] }`
  - `type QueuedMaterial = { materialId: number; kind: MaterialKind; url: string; mime: string; filename: string }`
  - `runTool(name: string, input: unknown, ctx: TurnContext): Promise<{ content: string; isError: boolean }>`:
    - Validates the input; an unknown tool or invalid input returns an error result.
    - Resolves `project` slugs, mapping an unknown slug to an error that lists the valid slugs.
    - Calls Tasks 5 and 6 and returns JSON strings.
    - Side effects:
      - `search_units` / `check_availability` add the tool name to `evidence.toolsCalled`.
      - `check_availability` with `verified` adds the unit numbers to `evidence.verifiedUnitNumbers`.
      - Every result passes through `collectAmounts` into `evidence.knownAmounts`.
      - `simulate_kpr` pushes onto `ctx.simulations`.
      - `send_materials` queues `activeMaterials` rows. It skips materials with a `material_sent` event unless `resend`, and returns `{queued:[…], already_sent:[…], missing:boolean}`.
      - `update_lead` with `project` calls `setLeadProject` and switches `ctx.projectId`.
      - `handoff_to_human` sets `ctx.handoffReason`.
      - `opt_out` calls `optOut`.
- `claude.ts`:
  - `type AnthropicLike = { beta: { messages: { create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage> } } }`
  - `createAnthropic(): AnthropicLike | null` returns null without a key. The client is created with `timeout: 120_000` and `maxRetries: 2`.
- `loop.ts`:
  - `type AgentTurnResult = { kind: 'reply'; message: string; materials: QueuedMaterial[]; materialsPosition: 'before' | 'after'; handoffReason: string | null; simulations: object[]; trace: TraceEntry[] } | { kind: 'no_reply'; trace: TraceEntry[] } | { kind: 'failed'; reason: 'AI_NOT_CONFIGURED' | 'NO_RESPOND_TOOL' | 'REPLY_CHECK' | 'REFUSAL' | 'API_ERROR' | 'TOO_MANY_STEPS'; detail: string; trace: TraceEntry[] }`
  - `type TraceEntry = { tool: string; input: unknown; isError: boolean; output: string }`
  - `runAgentTurn(input: { system: Anthropic.Beta.BetaTextBlockParam[]; history: Anthropic.Beta.BetaMessageParam[]; latest: string; ctx: TurnContext; settings: { model: string; effort: 'low' | 'medium' | 'high' } }, client: AnthropicLike | null): Promise<AgentTurnResult>`
  - `ctx.evidence.knownAmounts` arrives pre-seeded with `collectAmounts(projectFacts + leadState)`.

The loop algorithm:

```
messages = [...history, {role:'user', content: latest}]
calls = 0; failsafeUsed = false; rewriteUsed = false
loop (max 8 calls, else failed TOO_MANY_STEPS):
  res = client.beta.messages.create({ model, max_tokens: 16000, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
          output_config: { effort }, system, tools: MONI_TOOLS, messages })        // APIError -> failed API_ERROR
  if res.stop_reason == 'refusal' -> failed REFUSAL (detail = stop_details?.category)
  messages.push({ role:'assistant', content: res.content })
  uses = tool_use blocks in res.content
  respond = uses.find(name == 'respond_to_customer')
  if respond:
    v = validate(respond.input); if v.no_reply and !v.message -> no_reply
    check = checkReply(v.message, ctx.evidence)
    if check.ok -> reply { message: toWhatsAppMarkup(v.message), materials: ctx.queuedMaterials, … }
    if rewriteUsed -> failed REPLY_CHECK (detail = problems)
    rewriteUsed = true
    push user [ tool_result for every tool_use in this response: respond -> is_error + "Balasan ditolak: <problems>. Panggil respond_to_customer lagi dengan balasan yang diperbaiki."; other tools run normally ]
    continue
  if uses.length:
    push user [ tool_result per use (runTool, run sequentially in order) ]
    continue
  // no tool call at all (end_turn with text)
  if failsafeUsed -> failed NO_RESPOND_TOOL
  failsafeUsed = true
  push user "[Instruksi sistem: panggil respond_to_customer sekarang dengan balasan final (atau no_reply true). Jangan menulis teks bebas.]"
```

- [ ] **Step 1: Write the failing tests** using a scripted fake `AnthropicLike` whose `create` returns queued `BetaMessage`-shaped objects and records its params. Seed the DB as in Task 5.

```ts
// agent-tools.test.ts
it('rejects invalid tool input without throwing', async () => { expect((await runTool('search_units', { project: 'zetira', bedrooms: 'two' }, ctx())).isError).toBe(true); });
it('names valid slugs when the project is unknown', async () => { /* project 'xyz' -> isError, content includes 'zetira' */ });
it('send_materials queues active materials once and skips ones already sent', async () => { /* first call queues flyer; record material_sent; second call -> already_sent, nothing queued; resend true -> queued */ });
it('check_availability records verified units as evidence', async () => { /* … verifiedUnitNumbers includes 'D3/15' */ });
// agent-loop.test.ts
it('runs tools then returns the respond_to_customer reply with queued materials', async () => { /* script: [tool_use search_units] -> [tool_use send_materials flyer] -> [tool_use respond(message with Rp400 jt known from search)] ; result kind reply, materials length 1 */ });
it('sends model, effort, fallbacks and the cached system block', async () => {
  /* params[0]: model 'claude-opus-5-5', output_config.effort 'medium', betas ['server-side-fallback-2026-07-01'], fallbacks 'default',
     system[0].cache_control {type:'ephemeral', ttl:'1h'}; no 'thinking', 'temperature' or 'tool_choice' keys */
});
it('asks once more when the model answers in plain text, then fails', async () => { /* [text] -> [text] => failed NO_RESPOND_TOOL; [text] -> [respond] => reply */ });
it('rewrites once on a failed reply check, then fails', async () => { /* respond 'Rp450 jt' -> respond 'Rp450 jt' => failed REPLY_CHECK; second respond with known amount => reply */ });
it('maps a refusal to failed REFUSAL', async () => { /* stop_reason 'refusal' */ });
it('fails AI_NOT_CONFIGURED without a client', async () => { /* client null */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.**
  - Write `flow-moni.md` from the docx and `system.md` as specified.
  - Add `promptVersions.ts` with `currentPrompt(): Promise<{ id: number; text: string }>` (falls back to `flow-moni.md`) and `savePromptVersion(text, staffUserId)`.
  - Extend the seed.
- [ ] **Step 4: Run tests** → PASS. Also run `npx tsc --noEmit` in `api`.
- [ ] **Step 5: Commit:** `Add Moni: prompt, tools and the Claude tool loop with reply checks`

---

### Task 10: Router — transport, debounce, turns, takeover

**Files:**
- Create: `api/src/router/transport.ts`, `debounce.ts`, `turn.ts`, `inbound.ts`
- Modify: `api/src/index.ts` (wire `webhookRoutes` → `handleInbound`), `api/src/config.ts` (`TYPING_DEBOUNCE_MS`, `TYPING_MAX_WAIT_MS`)
- Test: `api/tests/router.test.ts`

**Port reference:** vinindo `services/messageRouter.ts:24-50, 169-173, 273-283, 308-475, 692-1009` (debounce, supersede, turn order, gates).

**Interfaces:**
- `transport.ts`:
  - `type Transport = { sendText(to: string, body: string): Promise<ChakraSend>; sendMedia(to: string, m: { kind: 'image' | 'video' | 'document'; link: string; filename?: string }): Promise<ChakraSend> }`
  - `chakraTransport(client: ChakraClient, phoneNumberId: string): Transport`
  - `recordingTransport(): Transport & { sent: { kind: string; body?: string; link?: string }[] }` returns `{waMessageId: null}`.
  - `mediaKindFor(mime: string): 'image' | 'video' | 'document'` maps `image/*`, `video/*`, and everything else to document.
- `debounce.ts`:
  - `createDebouncer(cfg: { quietMs: number; maxWaitMs: number; maxBatch: number; onFire: (conversationId: string) => Promise<void>; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout; now?: () => number })` returns `{ push(conversationId: string): void; pending(conversationId: string): boolean }`.
    - Each push re-arms the timer to `min(quietMs, maxWaitMs - (now - firstAt))`.
    - The `maxBatch`-th push fires at once.
    - While `onFire` runs for a conversation, new pushes wait. When it finishes, if pushes arrived during it, it re-arms.
- `turn.ts`:
  - `type TurnDeps = { transport: Transport; anthropic: AnthropicLike | null; vles: VlesClient | null; now: () => Date; settings: { model: string; effort: 'low' | 'medium' | 'high' }; staffSync?: (conversationId: string) => Promise<boolean> }`
  - `runTurn(conversationId: string, deps: TurnDeps): Promise<TurnOutcome>`, where `TurnOutcome = { kind: 'replied' | 'no_reply' | 'skipped' | 'failed'; sent: number; result?: AgentTurnResult }`.

    Steps:
    1. Run `staffSync`, if given. If it returns true (staff replied), return `skipped`.
    2. Re-check the gates: app `aiEnabled`, `conversation.ai_enabled`, `isUnderTakeover`. Any failing gate returns `skipped`.
    3. The batch is the customer messages after `lastOutboundAt`; none means `skipped`. History is `recentMessages(20)` before the batch.
       - Customer messages become `user`; Moni messages become `assistant`.
       - Staff messages become `assistant` content `[Tim sales menulis: …]`.
       - Media placeholders: `[gambar: <caption>]`, `[dokumen]`.
       - Consecutive same-role entries are merged.
       - `latest` is the batch texts joined with `\n`.
    4. Build the system blocks (current prompt, persona, `buildProjectFacts`, `buildLeadState`) and run `runAgentTurn`.
    5. **Supersede:** if `customerMessagesSince(conversationId, startedAt)` is non-empty and this run has not superseded yet, discard the result and run steps 3–4 once more.
    6. Act on the result:
       - **`reply`:** send media then text, or text then media, per `materialsPosition`. Store each as an outbound `moni` message with its wamid and status.
         - A sent material gets `material_sent {materialId, kind, filename}`; a failed one gets `material_failed {materialId, error}`.
         - Each simulation gets `simulation_sent`.
         - If the text send fails, the result is `failed`.
         - If `handoffReason` is set, `setTakeover(now + takeoverHours)`.
       - **`no_reply`:** nothing is sent.
       - **`failed`:** `setTakeover(now + takeoverHours, 'system', reason)`; nothing is sent.
    7. Update `last_moni_msg_at`.
- `inbound.ts`:
  - `handleInbound(msg: InboundMessage, deps: { debouncer; transport: (phoneNumberId: string) => Transport; isTest?: boolean; now }): Promise<'duplicate' | 'stored' | 'queued' | 'canned'>`

    Steps:
    1. `upsertContact`, `ensureConversation`, `ensureLead`.
    2. `insertInbound`; a duplicate returns early.
    3. A lead at stage `new` moves to `engaged`.
    4. If the lead has no project, run `detectProject` and `setLeadProject` (with source).
    5. Gates (AI, conversation toggle, takeover) → `stored`.
    6. `audio`, `video` and `other` get the canned text `Maaf Kak, Moni belum bisa membuka pesan suara atau video 🙏 Boleh dituliskan saja, Kak?` at most once per 5 minutes (`last_canned_reply_at`) → `canned`.
    7. Otherwise `debouncer.push(conversationId)` → `queued`.

- [ ] **Step 1: Write the failing tests.** Use a fake debouncer clock, the recording transport, a fake `AnthropicLike` scripted to answer with `respond_to_customer`, and seeded projects.

```ts
it('a burst of messages produces one turn', async () => { /* push x3 within quietMs on fake timers -> onFire once; the agent sees latest 'a\nb\nc' */ });
it('fires at once on the 20th message and caps waiting at maxWaitMs', async () => {
  // 20 pushes at t=0 -> onFire once, immediately; separately, one push every 5 s with quietMs 8000 / maxWaitMs 30000 -> fires at t=30000, not later
});
it('a duplicate inbound does not schedule a turn', async () => { /* same wamid twice -> second 'duplicate', debouncer.push called once */ });
it('takeover or a paused conversation stores the message without replying', async () => { /* setTakeover(+1h) -> 'stored'; ai_enabled false -> 'stored' */ });
it('audio gets the canned reply once per five minutes', async () => { /* two audios 1 min apart -> one canned send */ });
it('sends text then queued materials and records them as sent', async () => { /* agent queues flyer; materials_position 'after' -> transport.sent kinds ['text','image']; one material_sent event */ });
it('a failed media send is not recorded as sent', async () => { /* transport.sendMedia throws -> text still sent; material_failed event; no material_sent */ });
it('a message arriving mid-turn supersedes the draft once', async () => { /* fake agent inserts a new customer message during its first call; runTurn re-runs once; only the second reply is sent */ });
it('a failed turn sends nothing and starts a takeover', async () => { /* agent returns failed REPLY_CHECK -> transport.sent empty; conversation under takeover; handoff event */ });
it('first message with a tag sets the project and source', async () => { /* '[ZTR-REELS] Halo' -> lead.currentProjectId zetira, sourceChannel instagram, sourceContentKind reels */ });
```

- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** In `index.ts`:
  - Build the Chakra client, Anthropic client and VLES client.
  - Create one debouncer whose `onFire` calls `runTurn` with `chakraTransport(client, conversation.wa_phone_number_id)`.
  - Register `webhookRoutes({ onInbound: (m) => handleInbound(m, deps) })`.
  - Log, never throw, from `onFire`.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit:** `Route WhatsApp messages through debounced turns with takeover and supersede`

---

### Task 11: Detect replies staff type in Chakra's inbox

The spec (5.5) says staff replies are "detected by the webhook". vinindo found that Chakra's webhook never carries them; they can only be found by polling Chakra's chat history and finding outbound messages whose wamid we did not send. This task implements that. It is a ruling against the spec's mechanism, not its intent.

**Files:**
- Create: `api/src/chakra/staffSync.ts`
- Modify: `api/src/chakra/client.ts` (add `findChatId(waPhone)` and `listChatMessages(chatId, limit)`), `api/src/index.ts` (pass `staffSync` into `TurnDeps`)
- Test: `api/tests/staff-sync.test.ts`

**Port reference:** vinindo `services/chakraClient.ts:144-165` (`POST {base}/v1/ext/chat` with `{orderField:'updatedAt', limit, page}`, and `POST /v1/ext/chat/{chatId}/message` with `{limit, page}`), and `services/chakraSync.ts:155-203` (`syncContactChat`: finding the contact's chat, 5 s cap, hold-backs) and `:282-343` (`importMessage`: direction, text, wamid). Read those lines before writing; match their request and response field names exactly.

**Interfaces:**
- `syncStaffReplies(conversationId: string, deps: { client: ChakraClient; now: () => Date; timeoutMs?: number /*5000*/ }): Promise<boolean>`
  - Fetches the contact's last 20 Chakra messages.
  - Each outbound message whose wamid is not in our `messages` table, and which is newer than our last outbound, is stored as `sender 'staff'` with its text and wamid.
  - Returns true when at least one such message was found; the caller then sets a takeover.
  - Any error or timeout returns false and logs, so the bot still answers when Chakra is slow.

- [ ] **Step 1: Write the failing tests** with fake Chakra responses shaped like vinindo's:
  - an unknown outbound text → stored as staff, returns true, and `runTurn` returns `skipped` with a takeover set
  - an outbound whose wamid we stored → false
  - a request hanging longer than `timeoutMs` → false
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement.** In `runTurn`, when `staffSync` returns true, call `setTakeover(now + takeoverHours, 'system', 'balasan staf di ChakraHQ')` before returning `skipped`.
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit:** `Pause Moni when staff reply from the ChakraHQ inbox`

---

### Task 12: Dashboard — Projects & materials and KPR settings

**Files:**
- Create: `dashboard/app/(dashboard)/projects/page.tsx`, `projects/[id]/page.tsx` (+ client components), `dashboard/app/(dashboard)/kpr/page.tsx` (+ client), `dashboard/app/api/upload/route.ts`, `dashboard/lib/api/catalog.ts`, `dashboard/lib/api/kpr.ts`, `dashboard/actions/catalogActions.ts`, `dashboard/actions/kprActions.ts`
- Modify: `dashboard/components/layout/Sidebar.tsx`, `dashboard/proxy.ts` (`ADMIN_ONLY_PATHS` adds `/projects`, `/kpr`, `/leads`, `/test-chat`, `/settings`)

**Interfaces:**
- Consumes the Task 3 and 4 routes.
- `POST /api/upload` (route handler):
  - Admin-only (`requireAdmin`).
  - Reads `request.formData()` and forwards the file as multipart to `POST /api/v1/media` with the bearer secret.
  - Returns the API's JSON. Uploads go through a route handler because a server action's body limit is 1 MB.
- Sidebar adds "Proyek & Materi" (`/projects`), "Asumsi KPR" (`/kpr`), "Leads" (`/leads`), "Uji Chat" (`/test-chat`) and "Pengaturan" (`/settings`), all admin-only.

**Pages:**
- **`/projects`:** one card per project with name, location, VLES areas, and how many materials, priced types and active tags it has, linking to the detail page.
- **`/projects/[id]`:** tabbed sections:
  - **"Profil":** form for nama tampilan, nama persona (`tim …`), lokasi, link Maps, catatan akses, jam galeri (7 rows of open/close or "Tutup"), durasi kunjungan, minimal pemberitahuan, area VLES (comma list of ids), catatan subsidi, aktif.
  - **"Tipe":** the house types from `GET /projects/:id/types`, each with nama pemasaran, kamar tidur, kamar mandi, lantai, keunggulan, aktif. A type without bedrooms shows "Kamar tidur belum diisi — Moni tidak bisa menyaring tipe ini".
  - **"Materi":** list by kind with preview (image thumbnail, video/pdf link), masa berlaku, urutan, Nonaktifkan. "Unggah materi" takes jenis (flyer/video/promo/denah/brosur/foto), tipe (optional), file, berlaku dari/sampai, urutan; it uploads via `/api/upload`, then calls the materials POST.
  - **"Promo":** usable VLES promos with name, benefit, period, and an editable "Kalimat untuk pelanggan" and "Syarat". A usable promo without copy shows "Belum ada kalimat — Moni hanya menyebut nama dan nilai promo".
  - **"Tag iklan":** table of tag, kanal, jenis konten, add and delete. Help text: "Tambahkan tag di teks pesan otomatis iklan, contoh: `[ZTR-REELS] Halo, saya mau info promo`."
- **`/kpr`:** per project:
  - The default row: bunga tetap %, lama bunga tetap (tahun), bunga floating %, pilihan tenor (comma list), pilihan DP % (comma list), catatan.
  - Optional bank rows chosen from that project's `vles_mortgage_banks`.
  - A table of VLES scheme names seen in `vles_unit_schemes`, with the parsed DP and an override field.

- [ ] **Step 1: Implement the pages, actions and route handler.** Every server action calls `requireAdmin()` and `revalidatePath`.
- [ ] **Step 2: Verify:** `npm --prefix dashboard run type-check && npm --prefix dashboard run build` → exit 0.
- [ ] **Step 3: Manual check:**
  - Upload a flyer jpg and an mp4 to Zetira. Both preview, and `GET <url>` from the API returns 200.
  - Set bedrooms on ZETIRA BELVIA.
  - Add copy to a usable promo.
  - Add tag `ZTR-REELS` (instagram, reels).
  - Save KPR defaults (5 / 3 / 11, tenors 10,15,20, DP 5).
  - A sales user is redirected away from `/projects` and `/kpr`.
- [ ] **Step 4: Commit:** `Add the Proyek & Materi and Asumsi KPR pages`

---

### Task 13: Dashboard — Leads list and lead detail

**Files:**
- Create: `api/src/routes/leads.ts` (+ tests), `dashboard/app/(dashboard)/leads/page.tsx`, `leads/[id]/page.tsx` (+ client components), `dashboard/lib/api/leads.ts`, `dashboard/actions/leadActions.ts`
- Modify: `dashboard/lib/api/client.ts` (optional `staffId` → `X-Staff-Id` header)
- Test: `api/tests/leads-routes.test.ts`

**Interfaces:**
- API routes (`requireApiSecret`; `X-Staff-Id` is recorded as `staff:<id>` in events):
  - **List:** `GET /api/v1/leads?stage=&projectId=&channel=&from=&to=&q=&page=&limit=`
    - Rows: `{ id, name, waPhone, stage, project: {id, displayName} | null, sourceChannel, sourceContentKind, budgetPrice, budgetMonthly, bedroomsWanted, typeInterest: string[], hotCold, lastCustomerMsgAt, underTakeover: boolean, needsAttention: boolean }`.
    - `needsAttention` means a takeover is active and no staff message has been sent since it began.
    - `from`/`to` are WIB dates on `leads.created_at`. `q` matches name or phone.
    - Test contacts are excluded.
    - Ordered by `last_customer_msg_at desc`.
    - `meta: {page, total, limit, totalPages}`.
  - **Detail:** `GET /api/v1/leads/:id` → `{ lead, contact, conversation: {aiEnabled, humanTakeoverUntil}, messages (last 200, oldest first), events (newest first) }`
  - **Edit:** `PATCH /api/v1/leads/:id` → `updateLeadFacts` with staff actor; `stage` uses `setLeadStage` with `force: true`
  - **Takeover:** `POST /api/v1/leads/:id/takeover` with `{ on: boolean }`. `on` sets takeover until `now + takeoverHours`; off sets null.
  - **AI toggle:** `POST /api/v1/leads/:id/ai` with `{ enabled: boolean }` → `conversation.ai_enabled`
  - **Send as staff:** `POST /api/v1/leads/:id/messages` with `{ body }`. Sends through Chakra as staff, stores `sender 'staff'` with `staff_user_id`, and starts a takeover. Refused with 409 `TEST_CONTACT` for test contacts.

**Pages:**
- **`/leads`:**
  - Filters: tahap, proyek, kanal, tanggal (dari/sampai), cari (nama/no. WA).
  - Table columns: Nama, Proyek, Kanal, Budget/Cicilan, Minat, Tahap (badge), Hot/Cold, Terakhir chat (WIB).
  - A red "Perlu ditangani" badge when `needsAttention`.
  - Pagination of 25.
- **`/leads/[id]`:**
  - **Left:** the WhatsApp transcript. Customer on the left, Moni and staff on the right with labels "Moni" / "Staf: <nama>", media shown as links, timestamps in WIB. A reply box "Balas sebagai staf" sends and starts a takeover.
  - **Right:**
    - The fact card (all lead facts, editable inline) and a stage selector.
    - Toggles "Moni aktif" and "Ambil alih" (shows "Diambil alih sampai <WIB>").
    - The event timeline with materials, simulations, stage changes and handoffs (with reasons).

- [ ] **Step 1: Write the failing API tests:**
  - the list excludes test contacts and filters by stage and project
  - detail returns messages oldest first
  - send-as-staff stores a staff message and starts a takeover (fake Chakra client)
  - send-as-staff on a test contact → 409
  - `needsAttention` is true after a failed turn and false after a staff reply
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** the routes, then the pages.
- [ ] **Step 4: Verify:** `npm test` → PASS; dashboard type-check and build → exit 0.
- [ ] **Step 5: Commit:** `Add the Leads list and lead detail with takeover and staff replies`

---

### Task 14: Test chat, Settings, and a live rehearsal

**Files:**
- Create: `api/src/routes/testChat.ts`, `api/src/routes/settings.ts` (+ tests), `dashboard/app/(dashboard)/test-chat/page.tsx` (+ client), `dashboard/app/(dashboard)/settings/page.tsx` (+ client), `dashboard/lib/api/testChat.ts`, `dashboard/lib/api/settings.ts`, `dashboard/actions/testChatActions.ts`, `dashboard/actions/settingsActions.ts`
- Modify: `README.md` (ChakraHQ webhook setup, env, how to rehearse)
- Test: `api/tests/test-chat.test.ts`, `api/tests/settings-routes.test.ts`

**Interfaces:**
- **Test chat:**
  - `POST /api/v1/test-chat/:staffId/messages` with `{ text }`:
    - Builds an `InboundMessage` for contact `wa_phone = 'test-' + staffId` (`is_test`, kind `text`, `phoneNumberId` `'test'`, `waMessageId` `'test-' + uuid`).
    - Calls `handleInbound`, bypassing the debouncer by calling `runTurn` directly, with `recordingTransport()`.
    - Returns `{ outbound: [{kind, body?, link?}], outcome: TurnOutcome['kind'], trace: TraceEntry[], lead }`.
  - `DELETE /api/v1/test-chat/:staffId` deletes that test contact; the conversation, messages, lead and events cascade.
- **Settings:**
  - `GET /api/v1/settings` → `AppSettings`
  - `PUT /api/v1/settings` with `{aiEnabled?, personaGroupName? (3–40 chars), takeoverHours? (1–168)}`
  - `GET /api/v1/prompt-versions` → the last 10, newest first
  - `POST /api/v1/prompt-versions` with `{ text }` (min 200 chars) creates a version, which becomes current

**Pages:**
- **`/test-chat`:**
  - A WhatsApp-style chat for the signed-in admin, with media shown as cards labelled with the material file name.
  - A collapsible "Langkah Moni" panel showing the trace (tool, input, output, errors).
  - A side card with the current lead facts and stage.
  - A "Mulai ulang" button.
  - Help text: "Ketik tag iklan di pesan pertama untuk mensimulasikan kanal, contoh `[ZTR-REELS] Halo`."
- **`/settings`:**
  - "Moni aktif" (global switch), "Nama tim untuk proyek yang belum diketahui", "Lama ambil alih (jam)".
  - "Prompt FLOW MONI": a textarea with the current version, Simpan as a new version, and the version history list (WIB time, author).

- [ ] **Step 1: Write the failing API tests:**
  - a test-chat message runs a turn with a fake agent and returns the recorded outbound without calling Chakra
  - reset removes the test lead
  - test leads never appear in `GET /leads`
  - settings validate their ranges
  - a new prompt version becomes the one `currentPrompt()` returns
- [ ] **Step 2: Run to verify failure** → FAIL.
- [ ] **Step 3: Implement** the routes and pages, and update the README.
- [ ] **Step 4: Verify:** `npm test` → PASS; dashboard type-check and build → exit 0.
- [ ] **Step 5: Live rehearsal against the real model. This spends Anthropic API credit: ask the user for approval before running it.** With `ANTHROPIC_API_KEY` set, the seed run, VLES synced and Task 12's materials in place, run these five scenarios in `/test-chat`. Record each transcript and trace in the commit message body as pass/fail.
  1. `[ZTR-REELS] Halo kak, mau tanya promo` → greets as "Moni dari tim Zetira", mentions Cibitung, sends flyer/video/promo without captions, asks the name.
  2. "Budget sekitar 3 juta per bulan, 2 kamar" → calls `search_units` and `simulate_kpr`. Every amount passes the reply check and matches the trace.
  3. "Unit yang hadap timur masih ada?" → calls `check_availability` before naming any unit.
  4. "Pasti di-ACC kan KPR-nya?" → no promise; says approval follows the bank's assessment.
  5. "Kalau Sabtu jam 10 bisa lihat rumah?" → saves the timeline and stage `visit_proposed`, hands off, and tells the customer the team will confirm.
- [ ] **Step 6: Commit:** `Add the test chat and settings, and rehearse Moni live`

---

## Next milestones

- **Milestone 3, Visits:**
  - roster, slot finder, assignment
  - the `find_visit_slots` / `book_visit` / `reschedule_visit` / `cancel_visit` tools, which replace Task 9's interim hand-off for visits
  - the Schedule page
  - sales alerts (WhatsApp + push)
  - the lead summary refresh
  - sales-role access to their own leads
- **Milestone 4, Outbound and reporting:**
  - templates, the H-1 reminder, the follow-up
  - the Funnel page
  - the 25-scenario conversation suite with an LLM judge

They depend on these names from this milestone: `runTurn`, `TurnDeps`, `Transport`, `handleInbound`, `runAgentTurn`, `MONI_TOOLS`, `TurnContext`, `setTakeover`, `setLeadStage` (with `force`), `recordEvent`, `buildLeadState`, `buildProjectFacts`, `getAppSettings`, `createChakraClient`.
