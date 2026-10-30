# Moni — WhatsApp AI sales agent for Vista Land

Date: 2026-10-30
Status: design approved in conversation, awaiting written-spec review

## 1. Purpose

Moni is an AI sales agent that answers Vista Land's ad leads on WhatsApp, following the
"FLOW MONI" playbook (from ad to site visit): greet by channel, send flyer/video/promo, ask
budget or monthly instalment, recommend a type, invite to visit, confirm the schedule and the
assigned sales person ("sales pendamping"), and remind the customer the day before.

A web dashboard lets marketing and sales track every lead and the visit schedule, so a sales
person meets a customer who never has to explain themselves twice.

**Success means:** an ad lead becomes a confirmed site visit with an assigned sales person and a
complete handover summary, using only verified prices, promos and stock.

### 1.1 Decisions taken

| Topic | Decision |
|---|---|
| Channel | WhatsApp via ChakraHQ (same provider as vinindo-app) |
| WhatsApp numbers | One shared number for all projects |
| Projects in scope | All projects the VLES key can read: Zetira, the rest of Gran Harmoni Cibitung, Grand Harmoni Park |
| Visit assignment | Automatic from a roster kept in the dashboard; admin can reassign |
| Sales notification | WhatsApp message to the sales person **and** dashboard push, with a link to the visit page |
| KPR simulation | Computed by our app from admin-set rate assumptions and live VLES prices |
| Hosting | Cloud VM, Docker Compose |
| Build approach | New repo; port the proven WhatsApp/agent parts of vinindo-app, write the property domain new |

### 1.2 Out of scope

- Writing anything to VLES (the integration is read-only; booking/hold is not available).
- Closing, SPR, payments, KPR application tracking (the key cannot read transactions).
- Instagram/Facebook/TikTok DMs. Those channels only matter as *where the lead came from*.
- Ad-spend, CPL or ROI reporting (no spend data in this system).

## 2. Source facts this design rests on

### 2.1 FLOW MONI (client playbook)

The 11 steps and the general rules in `FLOW MONI.docx` are the behaviour spec for the agent.
Section 5.4 maps each step to the system. Rules the code must enforce, not just the prompt:

- Introduce as "Moni dari tim <project>", say the location early.
- Send flyer, video and promo without captions.
- Answer the customer's question before continuing the flow; the flow is a guide, not a script.
- Never repeat a question already answered or a material already sent.
- Use only current price, promo, stock, legality, access and simulation data.
- A simulation states its DP, tenor, interest and bank terms.
- Never promise KPR approval; no scarcity claims without data.
- Answer honestly when asked whether Moni is an AI.
- Stop follow-ups when the customer asks not to be contacted.

### 2.2 VLES integration (checked live on 2026-10-30)

- Contract v0.9.1, read-only, bearer API key.
- **The key stored in the keychain as `vles-api-key-dev` is a production key.** The dev server
  (`vles-dev-vistaland.fural.space`) returns 401 for it; production
  (`vles.vistalandapp.com`) returns 200.
- Project scope of the key: VLES projects **5** (Gran Harmoni Cibitung) and **25** (Grand Harmoni Park).
- Endpoints the key may read: `GET /catalog`, `/units`, `/units/{id}`, `/unit-types`, `/promos`,
  `/mortgage-banks`. Every other endpoint (projects, areas, payment-schemes, price-lists,
  unit-schemes, sales-agents, transactions, customers, siteplan, …) returns 401.
- Rate limit 120 requests/minute; list `limit` max 500; cursor pagination; `updated_since` with a
  7-hour server-side lookback, so rows repeat and must be upserted by id; deletions arrive as
  `deleted: true` tombstones when `updated_since` is used.
- Zetira is **area `ZETIRA` inside VLES project 5** (303 units). On 2026-10-30 there were 2,246
  units in scope, 193 `is_available_for_sale`, of which 55 in Zetira across ZETIRA ARIA, BELVIA,
  FREYA, JUNA and their HOOK variants, priced Rp384–466 jt. Grand Harmoni Park sells subsidi
  TYPE 28/60 (Rp195–200 jt) and RUKO.
- `/units/{id}` returns `schemes[]` (e.g. "KPR 95% BF 1JT", "CASH KERAS", "CASH 3X", "CASH 6X",
  "BCA KPR 99%"). Scheme prices can differ from the unit's list price (BCA KPR 99%: 381 jt vs
  400 jt). The list endpoint does not include schemes.
- **Not in VLES, so our app holds it:** bedrooms/bathrooms/floors (VLES says it does not store
  them), floor plans, flyers, videos, Maps links, access notes, customer-facing promo wording and
  terms (`description_customer` and `terms` are null), KPR rates/tenors/min DP (null on every
  mortgage bank), the sales roster.

## 3. Architecture

```
Customer WhatsApp ─▶ ChakraHQ ─▶ POST /webhook ─▶ router ─▶ agent (Moni, Claude Agent SDK)
                                                     │          │ tools: search_units, simulate_kpr,
                                                     │          │ send_materials, book_visit, …
                                                     │          ▼
                                                     │   respond_to_customer ─▶ Chakra send (text + media)
                                                     ▼
                                                 Postgres ◀── VLES sync (15 min) ◀── VLES API
                                                     ▲
                                outbound poller (1 min): H-1 reminders, follow-ups, sales alerts
                                                     ▲
                                         dashboard (Next.js) ── staff browsers / PWA push
```

### 3.1 Repository

`vistaland-chatbot/` with two independent packages, each with its own lockfile (as in vinindo-app):

- `api/` — Fastify 5, Drizzle ORM, PostgreSQL 17, Node 24, `@anthropic-ai/claude-agent-sdk`
  and `@anthropic-ai/sdk`, zod, vitest.
- `dashboard/` — Next.js (App Router), NextAuth v5, Tailwind, PWA manifest + web push.
- `deploy/` — `docker-compose.yml` (api, dashboard, postgres, caddy), `Caddyfile`, env examples.

### 3.2 API modules

Each module has one job and is used through its exported functions only.

| Module | Job | Origin |
|---|---|---|
| `chakra` | Webhook parsing; send text, media and approved templates; message-id dedupe | Port from vinindo `chakraClient`, `whatsappSender`, `routes/webhooks` |
| `router` | Upsert contact and conversation, merge message bursts, check human takeover and AI toggle, detect project, call the agent | Port and trim vinindo `messageRouter`, `humanTakeover` |
| `agent` | Build Moni's prompt (flow + project facts + lead state), run the tool loop, enforce reply checks, deliver the reply | Tool-loop and failsafe pattern ported from vinindo `aiLayer`/`claude`; prompt, tools and checks new |
| `vles` | HTTP client, sync job, live single-unit check | New |
| `catalog` | Projects, type profiles, materials, promo copy — the knowledge VLES lacks | New |
| `kpr` | Pure instalment calculator | New |
| `scheduling` | Roster, slot finder, assignment, visit lifecycle | New |
| `outbound` | `scheduled_messages` table and the poller that sends reminders, follow-ups and sales alerts | New |
| `leads` | Lead record, stage transitions, handover summary, funnel queries | New (schema ideas from vinindo `leads`) |
| `notify` | Web push to staff | Port vinindo `staffNotify` + push subscriptions |
| `routes/dashboard/*` | REST API for the dashboard, API-key + session auth | Pattern from vinindo |

Background jobs run inside the API process on intervals, configurable by env and disable-able
with `0`: VLES sync (15 min), outbound poller (1 min), lead-summary refresh (10 min). The
summary refresh reads conversations whose customer has been quiet 5 minutes since the last
refresh and asks the model to fill blank lead facts and rewrite `leads.summary`; it never
changes stage, visits or assignment (same idea as vinindo `leadInsights`).

## 4. Data model

Times are stored as `timestamptz`; all user-facing dates and "today" are computed in
Asia/Jakarta (WIB).

### 4.1 VLES copy (written only by the sync)

- `vles_units` — id (VLES id, PK), project_id, area_id, area_name, unit_number, block,
  house_type_id, house_type_name, land_size, building_size, stage, marketing_stock_stage,
  is_available_for_sale, selling_price, price_list_in_period, facing, strategic_position,
  sales_category, business_group_label, ready, deleted, vles_updated_at, raw jsonb, synced_at.
- `vles_unit_types` — id, project_id, name, land_size, building_size, electric_power,
  sales_category, deleted, raw, synced_at.
- `vles_unit_schemes` — (unit_id, scheme_id) PK, name, selling_price, booking_fee, deposit,
  ppn, raw, synced_at. Rows for units no longer for sale are deleted on refresh.
- `vles_promos` — id, project_id, name, sales_category, benefit_type, benefit_amount,
  benefit_percent, valid_from, valid_to, is_usable, deleted, raw, synced_at.
- `vles_mortgage_banks` — id, project_id, bank_id, bank_name, branch_name, deleted, raw, synced_at.
- `vles_sync_state` — endpoint PK, last_server_time, last_run_at, last_ok_at, last_error.

### 4.2 Our knowledge (edited in the dashboard)

- `projects` — id, slug, display_name ("Zetira"), persona_team_name ("tim Zetira"),
  location_label ("Cibitung"), maps_url, access_notes, gallery_hours (jsonb per weekday),
  visit_minutes (default 60), same_day_min_notice_minutes (default 120), vles_project_id,
  vles_area_ids int[], subsidi_notes, active.
  Seed (VLES area ids checked 2026-10-30): Zetira (project 5, areas [37]),
  Gran Harmoni Cibitung (project 5, areas [5]), Grand Harmoni Park (project 25, areas [25]).
  A unit belongs to the project whose `vles_area_ids` contains its `area_id`; a new VLES area
  that no project lists is shown in the dashboard as unassigned and is not sold by Moni.
- `type_profiles` — vles_house_type_id PK, project_id, marketing_name, bedrooms, bathrooms,
  floors, highlights text, floor_plan_material_id, active.
- `materials` — id, project_id, type_profile_id nullable, kind
  (`flyer|video|promo|floor_plan|simulation_sheet|photo|brochure`), file_url / chakra_media_url,
  mime, valid_from, valid_to, sort, active.
- `promo_copy` — vles_promo_id PK, customer_text, terms_text (customer-facing wording for a
  VLES promo).
- `kpr_settings` — project_id, bank_id nullable (null = project default), fixed_rate_pct,
  fixed_years, floating_rate_pct, tenor_options int[] (years), dp_options_pct numeric[],
  notes. `scheme_dp_overrides` — scheme_name → dp_pct, for schemes whose DP cannot be read from
  the name.
- `channel_tags` — tag (e.g. `ZTR-REELS`), project_id, channel (`instagram|facebook|tiktok|other`),
  content_kind (`promo|reels|general`). Marketing adds the tag to each ad's prefilled text.

### 4.3 Conversations and leads

- `contacts` — id, wa_phone (unique, 62…), display_name, opted_out_at, created_at.
- `conversations` — id, contact_id, ai_enabled, human_takeover_until, last_customer_msg_at,
  last_bot_msg_at, summary_refreshed_at.
- `messages` — id, conversation_id, chakra_message_id (unique), direction, sender
  (`customer|moni|staff|system`), staff_user_id, type, body, media_url, created_at.
- `leads` — one per contact: id, contact_id, current_project_id, projects_of_interest int[],
  source_channel, source_content_kind, source_ref (ad referral/tag), stage, name, budget_price,
  budget_monthly, dp_budget, bedrooms_wanted, purpose (`own_use|investment`), timeline,
  domicile_area, concerns text[], type_interest int[] (house_type ids), hot_cold, lost_reason,
  assigned_sales_id, summary jsonb (the step-9 handover fields), created_at, updated_at.
- `lead_events` — id, lead_id, kind (`stage_changed|fact_updated|material_sent|simulation_sent|
  visit_*|handoff|opt_out|note`), payload jsonb, actor (`moni|staff:<id>|system`), created_at.
  Materials and simulations already sent are read from here.

Lead stages: `new → engaged → qualified → recommended → visit_proposed → visit_scheduled →
visit_confirmed → visited`, plus terminal or side states `no_show`, `cancelled`, `lost`,
`opted_out`.

### 4.4 Scheduling and outbound

- `sales_agents` — id, name, wa_phone, staff_user_id, active.
- `sales_agent_projects` — (sales_agent_id, project_id).
- `sales_availability` — sales_agent_id, project_id, weekday, start_time, end_time.
- `sales_time_off` — sales_agent_id, starts_at, ends_at, reason.
- `visits` — id, lead_id, project_id, sales_agent_id, starts_at, ends_at, status
  (`scheduled|confirmed|awaiting_confirmation|rescheduled|cancelled|visited|no_show`),
  type_interest, topics (what the customer wants to discuss), created_by, timestamps.
  **Exclusion constraint:** no two active visits for the same sales_agent_id with overlapping
  `tstzrange(starts_at, ends_at)` (btree_gist).
- `scheduled_messages` — id, kind (`h1_reminder|followup|sales_alert|reassign_notice|
  waiting_notice`), to_phone, lead_id, visit_id, template_name, params jsonb, due_at, status
  (`pending|sent|failed|cancelled`), attempts, last_error, sent_at. Idempotency: a partial unique
  index on (kind, visit_id) where status in (pending, sent) for visit messages, and a unique
  index on (kind, lead_id, (due_at at time zone 'Asia/Jakarta')::date) for follow-ups.

### 4.5 System

`staff_users` (role `admin|sales`), `push_subscriptions`, `app_settings` (AI global toggle,
reminder time, follow-up time, group persona name "tim Vista Land", Chakra number id).

## 5. Moni (the agent)

### 5.1 Project detection with one shared number

The router resolves the conversation's project on the first inbound message, in this order:

1. ChakraHQ's Click-to-WhatsApp referral data on the message, if present (headline, source URL)
   matched against `channel_tags` and project names.
2. A `[TAG]` in the prefilled text matched against `channel_tags` — also gives channel and
   content kind (promo / reels / general), which selects the step-1 greeting variant.
3. Otherwise unknown. Moni greets as "Moni dari tim Vista Land" (configurable) and asks which
   area the customer is interested in; the answer sets the project via `update_lead`.

A customer may switch project mid-chat; `current_project_id` changes and the project is added to
`projects_of_interest`. Materials, Maps link and stock always follow the current project.

### 5.2 Prompt

Built per turn from:

- The FLOW MONI playbook (stored as a versioned prompt in `app_settings`, editable by admins,
  seeded from the docx text).
- The current project's facts: name, location, Maps link, access notes, gallery hours, active
  promos with `promo_copy`, type list with bedrooms and price ranges from the VLES copy.
- The lead state: stage, known facts, open concerns, **materials and simulations already sent**,
  upcoming visit.
- The last N messages of the conversation.

The model must reply through `respond_to_customer`; free text is dropped. The vinindo failsafe
applies: if a run ends without that tool, ask once more offering only that tool.

### 5.3 Tools

| Tool | Input | Output / effect |
|---|---|---|
| `search_units` | project, bedrooms?, max_price?, max_monthly?, sales_category? | Type-level options from `vles_units` for sale: type, LT/LB, bedrooms, from-price, count available, cheapest scheme price |
| `get_type_details` | project, type | Sizes, bedrooms, price range, schemes, usable promos with copy |
| `check_availability` | project, type, position hints? | Live `GET /units/{id}` for candidate units; returns confirmed-available units or "could not verify" |
| `simulate_kpr` | project, type or unit, dp_pct or dp_amount?, tenor_years[]? | Instalments per tenor with stated assumptions (5.6); recorded as `simulation_sent` when sent |
| `send_materials` | kind, project, type? | Sends media via Chakra with no caption; refuses (returns "already sent") for a material already sent unless the customer asked again; records `material_sent` |
| `update_lead` | any lead facts, stage | Persists facts and stage; validates stage transitions |
| `find_visit_slots` | project, date range, part_of_day? | Free slots (6.2) |
| `book_visit` | project, starts_at, type_interest, topics | Creates visit, assigns sales, schedules alerts and reminder; returns sales name |
| `reschedule_visit` / `cancel_visit` | visit_id, new starts_at? / reason | Updates visit, re-assigns if needed, reschedules or cancels messages, alerts sales |
| `handoff_to_human` | reason | Pauses AI for the conversation, alerts admins and the assigned sales person |
| `opt_out` | — | Sets `opted_out_at`, cancels pending follow-ups and reminders |
| `respond_to_customer` | message, no_reply? | The only reply path |

### 5.4 FLOW MONI step → system behaviour

| Step | Behaviour |
|---|---|
| 1 Greeting by channel | Variant chosen from `source_channel`/`source_content_kind`; channel named only if known; name used if given |
| 2 Information pack | `send_materials` flyer, video, promo for the project; skipped if already sent |
| 3 Budget / instalment | Asked once; stored via `update_lead`; if no idea, send price comparison + `simulate_kpr` for 2 and 3 bedroom types |
| 4 Recommend | `search_units` with budget/bedrooms; floor plan + simulation; follow-up questions one at a time |
| 5 Follow-up questions | Price, promo, specs, tenor, availability (`check_availability` before any claim), location (Maps link + access notes), other area → offer to close politely |
| 6 Invite to visit | Weekday/weekend → time → `find_visit_slots`; same-day allowed after notice period; skip qualifying when the customer asks to visit first |
| 7 Objections | Answer first; no repeated visit invitation until the customer is ready; concerns stored on the lead |
| 8 Confirm visit and sales | Restate date/time/place + Maps, ask "Sudah sesuai?"; on yes `book_visit`; then name the sales person; no extra handover message |
| 9 Summary to sales | `leads.summary` kept current; sent in the sales alert and shown on the lead page |
| 10 H-1 reminder | Outbound template; reply handled by Moni (confirm / reschedule / cancel); no reply → awaiting confirmation |
| 11 Next-day follow-up | One outbound message if the chat stalled without a visit; never after opt-out, location rejected or human takeover |

### 5.5 Guardrails (enforced in code before sending)

A `replyChecks` pass on every outgoing message, rewriting once via the model on failure and
handing off to a human on a second failure:

- Any rupiah amount in the reply must appear in a tool result from this turn, the project facts
  injected into this turn's prompt, or the lead's recorded simulations.
- No KPR approval promise (pattern list: "pasti disetujui", "dijamin ACC", …).
- No scarcity claim ("tinggal", "sisa", "hampir habis") unless `search_units`/`check_availability`
  returned the count this turn.
- No availability claim for a specific unit/position without a successful `check_availability`.
- Subsidi eligibility statements only from `projects.subsidi_notes`.
- Messages after `opted_out_at` are blocked (except replies to a customer who writes again).

Staff replies (from the Chakra inbox, detected by the webhook, or from the dashboard) start a
human takeover: AI paused for that conversation until a staff member resumes it or
`takeover_hours` passes (default 24, in `app_settings`).

### 5.6 KPR calculator

Pure function in `kpr`:

- Price = the chosen scheme's `selling_price` (falls back to the unit list price).
- DP = explicit input, else parsed from the scheme name (`KPR (\d+)%` → DP = 100 − n), else
  `scheme_dp_overrides`, else the project's default `dp_options_pct[0]`.
- Loan = price − DP. Monthly instalment during the fixed period = annuity(loan,
  fixed_rate_pct/12, tenor_months). After the fixed period, recompute on the remaining balance
  with floating_rate_pct for the remaining months.
- Output always includes price, DP, loan, tenor, fixed rate and years, floating rate,
  instalment during and after the fixed period (labelled as an estimate), and the line
  "persetujuan KPR mengikuti penilaian bank".
- Budget search by monthly instalment uses the project's default tenor and DP.

## 6. Scheduling, reminders and follow-ups

### 6.1 Roster

Managed in the dashboard: sales agents, the projects each covers, weekly hours per project,
time off. Each project has gallery hours, visit length and same-day notice.

### 6.2 Slot finding

A slot `[t, t + visit_minutes)` is free when it is inside the project's gallery hours, at least
`same_day_min_notice_minutes` from now, and at least one active agent covering the project has
availability covering it, no time off overlapping it, and no overlapping active visit.
`find_visit_slots` returns up to 6 slots, preferring the requested part of day.

### 6.3 Assignment

`book_visit`, in one transaction: among free covering agents, pick the one with the fewest
visits in the last 7 days; ties go to the agent assigned longest ago. Insert the visit; the
exclusion constraint guarantees no double-booking — on conflict, retry with the next agent, and
if none is left, return "slot just taken" so Moni offers other times.

### 6.4 Notifications

On create, reschedule, cancel, reassign, awaiting-confirmation and confirmed:

- WhatsApp template to the sales agent's own number with the step-9 summary and a dashboard
  link to the visit.
- Web push to the agent's dashboard account; admins get push for handoffs and failures.

Admin reassignment notifies both agents and sends the customer one short message
("Kak [Nama], nanti Kakak dibantu Kak [Sales baru] ya") — free text if inside the 24-hour
window, otherwise the reassignment template.

### 6.5 H-1 reminder

Scheduled at booking for `reminder_time` (default 10:00 WIB) on the day before the visit, only
if that moment is still in the future at booking time; otherwise (including any visit booked for
the same day) there is no reminder and the step-8 confirmation is enough. Sent as an approved
WhatsApp template. Replies go to Moni, which confirms (`visit_confirmed`), reschedules or cancels. If
there is no reply by 08:00 WIB on the visit day, the visit becomes `awaiting_confirmation` and
the agent is alerted, without assuming the customer will come. Only Moni sends reminders.

### 6.6 Next-day follow-up

Each time Moni replies to a lead with no active visit, (re)schedule one follow-up for the next
day at `followup_time` (default 10:00 WIB) — "stalled" means the customer has not written since
that reply; use the "after discussing with your partner"
variant when that concern is on the lead. Cancelled if the customer writes first, opts out,
rejects the location, or a human takes over. Never more than one per stall. Uses a template
when outside the 24-hour window.

### 6.7 Visit outcome

The assigned agent (or an admin) marks `visited`, `no_show` or `rescheduled` on the visit page.

### 6.8 Client dependency

Four WhatsApp templates approved in ChakraHQ: H-1 reminder, follow-up (two variants),
sales alert, reassignment notice. Until approved, the outbound poller holds those rows and the
dashboard shows a warning.

## 7. Dashboard

Language: Bahasa Indonesia. Roles: **admin** (everything) and **sales** (own leads and visits,
reply in own chats, mark visit outcomes).

| Page | Content |
|---|---|
| Leads | List and board-by-stage; columns: name, project(s), channel/content, budget or instalment, type and bedrooms, hot/cold, assigned sales, next visit, last activity; filters by stage, project, channel, sales, date range (WIB) |
| Lead detail | Step-9 summary card, WhatsApp transcript, timeline of materials/simulations/stage changes, visits; pause/resume AI, send as staff, edit facts |
| Funnel | Per project and channel: leads → qualified → visit scheduled → confirmed → visited; no-show and cancel rates |
| Schedule | Day/week calendar by sales and project, visit status colours; reassign and move |
| Roster | Sales agents, project coverage, weekly hours, time off |
| Projects & materials | Project profiles, VLES mapping, type profiles, materials with validity, promo copy |
| Unit stock | Read-only VLES stock per project and type, price ranges, last sync time, stale warning |
| KPR settings | Rates, tenors, DP options per project and bank; scheme DP overrides |
| Test chat | Talk to Moni as a fake customer with a chosen project and channel tag; nothing is sent to WhatsApp |
| Settings | AI on/off, reminder and follow-up times, persona group name, Chakra number, staff accounts |

## 8. Error handling

| Failure | Behaviour |
|---|---|
| VLES unreachable or 5xx | Agent uses the last synced data; dashboard flags data older than 2 hours; sync retries next interval |
| VLES 429 | Respect `Retry-After`; the scheme fetch is throttled to stay under 100 req/min |
| `check_availability` fails | Moni says it is checking and alerts the assigned/any covering sales; never claims availability |
| Claude error or no tool call | One retry with only `respond_to_customer`; if still failing, alert admins, send nothing |
| Reply check fails twice | Hand off to a human; nothing sent |
| Chakra send fails | Retry 3 times with backoff; then `failed`, visible in the dashboard, admins pushed |
| Duplicate webhook | Ignored by unique `chakra_message_id` |
| Booking race | Exclusion constraint → next agent → "slot just taken" |
| Unapproved template | Outbound row held as `pending` with a dashboard warning |

## 9. Testing

- **Unit (vitest):** KPR calculator (annuity, fixed→floating, DP parsing); slot finder; assignment
  fairness; exclusion constraint (against a real Postgres in tests); VLES sync mapping using
  fixtures recorded from real responses (cursor, tombstones, schemes, repeated rows from the
  lookback); project detection; reply checks; stage transitions.
- **Integration:** webhook → router → stub agent → mocked Chakra; outbound poller with a fake
  clock (reminder, awaiting-confirmation, follow-up cancellation).
- **Conversation suite:** about 25 scripted scenarios from FLOW MONI run against the real model
  through the test-chat path, each graded against a checklist by Claude as judge: every greeting
  variant, budget known/unknown, each step-7 objection, visit today, reschedule and cancel after
  the H-1 reminder, opt-out, "kamu AI?", customer looking elsewhere, unknown project. Run before
  every prompt change.
- **Fixtures, not production, in tests.** The only working key is a production key; tests and CI
  use recorded fixtures. Local development may read production (read-only GETs) until a dev key
  is issued.

## 10. Build order

One spec, delivered in four milestones so each is usable on its own:

1. **Foundation** — repo, Docker Compose, schema and migrations, staff auth, VLES sync with
   recorded fixtures, Unit stock page.
2. **Moni answers** — Chakra webhook and send, router, agent with knowledge tools
   (`search_units`, `get_type_details`, `check_availability`, `simulate_kpr`, `send_materials`,
   `update_lead`, `handoff_to_human`, `opt_out`), reply checks, Projects & materials, KPR
   settings, Test chat, Leads list and detail.
3. **Visits** — roster, slot finder, assignment, visit tools, Schedule page, sales alerts
   (WhatsApp + push).
4. **Outbound and reporting** — H-1 reminder, awaiting-confirmation, next-day follow-up,
   reassignment notice, Funnel page, conversation suite in CI.

## 11. Open items needing the client

1. A working VLES **dev** key (the current "dev" key only works on production).
2. Approved WhatsApp templates in ChakraHQ (6.8).
3. Per project: Maps link, access notes, gallery hours, flyers, videos, promo materials and
   customer-facing promo wording.
4. Per type: bedrooms, bathrooms, floors, floor plan, photos.
5. KPR assumptions: rates, fixed years, tenors, DP options.
6. Sales roster with WhatsApp numbers and weekly hours.
7. Subsidi (FLPP) eligibility wording for Grand Harmoni Park.
8. Ad tagging: a short tag per ad in the prefilled WhatsApp text, plus confirmation of whether
   ChakraHQ forwards Click-to-WhatsApp referral data.
