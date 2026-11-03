# Handoff: where Moni stands (2026-11-03)

Read this first if you are picking the work up in a new session or account.

## Background

- **Spec:** `docs/superpowers/specs/2026-10-30-moni-sales-agent-design.md`
- **Plans:**
  - `docs/superpowers/plans/2026-10-30-m1-foundation.md` (done, pushed)
  - `docs/superpowers/plans/2026-10-31-m2-moni-answers.md` (done, pushed)
  - `docs/superpowers/plans/2026-11-02-m3-visits.md` (done on branch `m3-visits`, not pushed)
- **Port reference:** `/Users/claytonmildy/WidaProject/FDE Projects/vinindo-app`
- **Run, configure and deploy instructions:** `README.md`: "Moni on WhatsApp" covers the roster, WhatsApp templates, Web Push and the new settings.

## Status

- **Milestone 1** (foundation: VLES sync, staff, dashboard login, stock) is on `origin/main`.
- **Milestone 2** (Moni answers on WhatsApp) is complete and on `origin/main`.
- **Milestone 3** (visits) is complete on branch `m3-visits`. It is **not pushed and not merged**.
  - Built task by task, with a review after each task.
  - It adds the sales roster, the slot finder, fair booking, Moni's visit tools (`find_visit_slots`, `book_visit`, `reschedule_visit`, `cancel_visit`), the outbound WhatsApp template queue, web push, sales users seeing their own leads, the Schedule (Jadwal) page, the lead summary refresh and the media rate limit.
  - Tests on 2026-11-03: 336 API and 14 dashboard tests pass.
  - A whole-branch final review is being run next.
- **Not done:** the live rehearsal against the real Claude model. Nothing has called the real Anthropic API yet, for Milestone 2 or 3.
- **Implementation ledgers** (gitignored): `.superpowers/sdd/2026-10-31-m2-moni-answers/` and `.superpowers/sdd/2026-11-02-m3-visits/`. Keep them until the rehearsal is done.

## Next steps, in order

1. **Add the key.** Put `ANTHROPIC_API_KEY=...` in `api/.env`.
   - It must be an API key from the **Claude Console**. Do not use a Claude Code subscription OAuth token for Moni: Anthropic's terms allow those only in Claude Code and Anthropic's own apps.
   - The model is `claude-opus-5-5` (`MONI_MODEL`) and the effort is `medium` (`MONI_EFFORT`).
   - **The rehearsal spends API credit. The user must approve the spend first.** It should cost well under a dollar.
2. **Set up the data the chats need.**
   - Sync VLES (set `VLES_API_KEY`, or use "Sinkronkan sekarang" on the Stok Unit page).
   - Fill Zetira's gallery hours (Proyek & Materi → Zetira), visit length and same-day notice.
   - Add one test sales agent covering Zetira with Saturday hours on **Roster Sales**.
   - Upload Zetira's materials (flyer, house video, promo image). So far only Belvia's bedroom count, the `ZTR-REELS` tag and the KPR defaults are filled in.
   - Start the API and the dashboard (see `README.md`). The API runs on port 50060.
3. **Run the five rehearsal chats** in `/test-chat` (Uji Chat). Chats 1 to 4 run in order in one conversation; chat 5 needs Zetira's roster emptied first.
   1. `[ZTR-REELS] Halo kak, mau lihat rumah Sabtu ini jam 10 bisa?`: Moni greets, calls `find_visit_slots` with the right Saturday, offers 10.00, restates the visit with the Maps link and asks "Sudah sesuai".
   2. `Iya sesuai kak`: `book_visit` is called, Moni names the agent from the tool and sends no extra handover message. The Schedule page shows a test visit. No `scheduled_messages` row exists.
   3. `Kak, bisa diganti Minggu jam 1 siang?`: `reschedule_visit` is called, or, if there are no Sunday hours, Moni offers what `find_visit_slots` returns.
   4. `Batal dulu ya kak`: `cancel_visit` is called, polite, no pressure.
   5. With Zetira's roster emptied: `Mau lihat rumah besok`: the tool returns `NO_ROSTER`, Moni saves the timeline, hands off, and an admin push arrives.

   For each chat, check the reply and the trace, and note `usage.cache_read_input_tokens` (prompt caching should kick in from turn 2). Record pass or fail for each chat in a commit message, and fix any tone problems in `api/src/agent/prompts/system.ts`.
4. **Template go-live.** Submit the two WhatsApp templates in ChakraHQ and fill **Pengaturan > WhatsApp keluar** (bodies are in `README.md`). If the first live template send fails, compare the payload with vinindo-app's template sender.
5. **Clean up and integrate.** Delete the two ledgers under `.superpowers/sdd/`, then run the superpowers `finishing-a-development-branch` skill (push and merge `m3-visits`).
6. **Milestone 4, Outbound and reporting** (the plan's "Not in this milestone" section):
   - The H-1 reminder, the 08:00 `awaiting_confirmation` switch and `visit_confirmed` from the reminder reply. The poller already holds the `h1_reminder` and `waiting_notice` kinds.
   - The next-day follow-up.
   - The opt-out block on every outbound customer kind (today only `reassign_notice` has it).
   - The confirmed and awaiting-confirmation sales alerts.
   - Board-by-stage on Leads, and the Funnel page.
   - The 25-scenario conversation suite with an LLM judge.

## Still deferred from Milestone 2

- First-contact webhooks arriving at the same moment can write duplicate stage events or send two canned voice-note replies.
- The test chat's recording transport drops the original filename, so media show UUID names.
- If Moni switches project mid-turn, it keeps the old project's facts until the next turn.
- A superseded first run keeps its side effects, such as a project switch or opt-out. Visits are covered by a rerun test.
- Project facts are recomputed for every project on every turn. That's fine at three projects.

## Milestone 3 open items

The final whole-branch review of `m3-visits` is the next thing to run. It will produce the real list of open items; copy them here when it does. The other Milestone 2 minors (customer-controlled lead facts unmarked in the system block, a `max_tokens` cut-off not logged differently, a staff-reply check slower than 5 seconds skipped silently) were not re-checked in Milestone 3; ask the review to confirm whether they are still open.

## Gotchas

- **Settings names.** Claude Code exports `CLAUDE_EFFORT=xhigh` into the shell, which is why the API's settings are named `MONI_MODEL` and `MONI_EFFORT`. Don't rename them back.
- **Disk space.** The disk has run full twice and was at 1.8 GB free (100% used) on 2026-11-03. Check free space before Docker or npm work.
- **Cloud sessions.** A plain Postgres 16 works for the tests: set `DATABASE_URL` and `TEST_DATABASE_URL` in `api/.env`. All 161 API and 7 dashboard tests (the Milestone 2 suite) passed that way on Node 22 on 2026-11-02, although `engines` asks for Node 24. Milestone 3 needs the `btree_gist` extension, which ships with Postgres.
- **macOS.** There is no `timeout` command, so poll with until-loops. Process substitution doesn't work with `docker compose --env-file`, so write a temporary file instead.
- **Dev data.** The dev database has a fake lead `6281234567890` from a webhook test, and `api/media/` holds a few test uploads.
- **Unconfirmed.** It's still unknown whether ChakraHQ passes Meta's ad-referral data through. Project detection falls back to the `[TAG]` in the first message.
