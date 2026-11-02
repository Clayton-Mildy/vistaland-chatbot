# Handoff: where Moni stands (2026-11-02)

Read this first if you are picking the work up in a new session or account.

## Background

- **Spec:** `docs/superpowers/specs/2026-10-30-moni-sales-agent-design.md`
- **Plans:**
  - `docs/superpowers/plans/2026-10-30-m1-foundation.md` (done, pushed)
  - `docs/superpowers/plans/2026-10-31-m2-moni-answers.md` (done, **not pushed**)
- **Port reference:** `/Users/claytonmildy/WidaProject/FDE Projects/vinindo-app`
- **Run and deploy instructions:** `README.md`, including the "Moni on WhatsApp" section.

## Status

- **Milestone 1** (foundation: VLES sync, staff, dashboard login, stock) is on `origin/main`.
- **Milestone 2** (Moni answers on WhatsApp) is complete on local `main`, 15 commits ahead of `origin/main`.
  - Last commit: `5e1f8ad Close gaps in reply checks, takeover timing and unanswered messages`.
  - Tests: 161 API and 7 dashboard tests pass, and `npm run build` in `api/` passes.
  - A whole-branch review was run. All its critical and important findings are fixed, each with a test that failed first.
- **Not done:** the live rehearsal against the real Claude model. Nothing has called the real Anthropic API yet.
- **Implementation ledger:** `.superpowers/sdd/2026-10-31-m2-moni-answers/` (gitignored). It records every task, every fix, 39 rulings and 9 deferred minors. Keep it until the rehearsal is done.

## Next steps, in order

1. **Add the key.** Put `ANTHROPIC_API_KEY=...` in `api/.env`. There is none yet.
   - The model is `claude-opus-5-5` (`MONI_MODEL`) and the effort is `medium` (`MONI_EFFORT`).
   - The rehearsal should cost well under a dollar.
2. **Upload Zetira's materials** in the dashboard (Proyek & Materi → Zetira → Materi): the latest flyer, the house video and a promo image.
   - So far only Belvia's bedroom count, the `ZTR-REELS` tag and the KPR defaults are filled in.
3. **Start the API and the dashboard** (see `README.md`). The API runs on port 50060.
4. **Run the five rehearsal chats** in `/test-chat` (Uji Chat). Reset between chats if needed.
   1. `[ZTR-REELS] Halo kak, mau tanya promo`: Zetira is detected, Moni greets, and the materials go out.
   2. `Budget sekitar 3 juta per bulan, 2 kamar`: `search_units` and `simulate_kpr` are used, and every amount comes from a tool.
   3. `Unit yang hadap timur masih ada?`: `check_availability` is called before any claim about stock.
   4. `Pasti di-ACC kan KPR-nya?`: Moni makes no promise of approval.
   5. `Kalau Sabtu jam 10 bisa lihat rumah?`: a visit is handled or handed to staff without Moni promising a slot.

   For each chat, check the reply and the trace, and note `usage.cache_read_input_tokens` (prompt caching should kick in from turn 2). Record pass or fail for each chat in a commit message, and fix any tone problems in `api/src/agent/prompts/`.
5. **Clean up.** Delete `.superpowers/sdd/2026-10-31-m2-moni-answers/`, then run the superpowers `finishing-a-development-branch` skill.
6. **Push** `main` to `origin` (`git@github.com:Clayton-Mildy/vistaland-chatbot`). Ask the user first.
7. **Milestone 3.** Write its plan from the spec:
   - assigned sales and next visit on leads
   - sales users seeing their own leads
   - admin alerts on failures
   - possibly a rate limit on the public `/webhook` and `/media`

   Milestone 4 then covers follow-ups, the opt-out block on outbound messages, and the scored conversation suite.

## Deferred minors (from the Milestone 2 review)

- `api/src/catalog/typeProfiles.ts`: `listProjectTypes` uses `sql.raw` for the area array. Switch it to `intArray`. The values are integers, so it isn't exploitable today.
- Lead facts the customer controls (name, timing, concerns) go into Moni's system block unmarked. Mark or escape them.
- A reply cut off at `max_tokens` isn't logged differently from a plain-text answer.
- First-contact webhooks arriving at the same moment can write duplicate stage events or send two canned voice-note replies.
- The test chat's recording transport drops the original filename, so media show UUID names.
- If Moni switches project mid-turn, it keeps the old project's facts until the next turn.
- A ChakraHQ staff-reply check slower than 5 seconds is skipped without a log line.
- A superseded first run keeps its side effects, such as a project switch or opt-out.
- Project facts are recomputed for every project on every turn. That's fine at three projects.

## Gotchas

- **Settings names.** Claude Code exports `CLAUDE_EFFORT=xhigh` into the shell, which is why the API's settings are named `MONI_MODEL` and `MONI_EFFORT`. Don't rename them back.
- **Disk space.** The disk has run full twice. Check free space before Docker or npm work.
- **macOS.** There is no `timeout` command, so poll with until-loops. Process substitution doesn't work with `docker compose --env-file`, so write a temporary file instead.
- **Dev data.** The dev database has a fake lead `6281234567890` from a webhook test, and `api/media/` holds a few test uploads.
- **Unconfirmed.** It's still unknown whether ChakraHQ passes Meta's ad-referral data through. Project detection falls back to the `[TAG]` in the first message.
