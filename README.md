# Glee-Along 🎶

A private two-person Glee rewatch app. React + Vite + TypeScript PWA, Supabase (auth, Postgres, RLS), deployed on Vercel.

## Setup
1. Create a Supabase project. In the SQL editor (or `supabase db push`), run `supabase/migrations/*.sql` in order, then `supabase/seed.sql`.
2. Auth → Providers → Email. For a two-person app, turn **off** "Confirm email" (or the sign-up flow will ask you to confirm first).
3. `cp .env.example .env.local` and fill in the project URL + anon key.
4. `npm i && npm run dev`
5. Vercel: import the repo, set the same two `VITE_` env vars. `vercel.json` handles SPA routing.

## Pairing
One person signs up, picks "Start a club", and shares the 8-character code. The other picks "I have a code". A pair holds exactly two people.

## Episodes
`data/episodes.txt` is the source; `npm run gen:episodes` regenerates `supabase/seed.sql` (idempotent upserts). Rows with a `verify_note` need a human check. **See "Episode list" below.**

## The reveal rule (and how it's enforced)
You can read your partner's notes/ratings/counters for an episode **only after you've submitted your own review of that episode**. This lives in Postgres RLS (`supabase/migrations/0002_*.sql`, policy `reviews_select`); the UI does no filtering. Drafts are visible only to their author. `ratings`, `counters`, and `notes` are readable iff their parent review is readable. Submitted reviews are immutable (RLS + triggers, so even service-role writes are refused).

Stats (`season_stats`, `biggest_disagreements`) are SQL functions with `security invoker`, so RLS applies beneath them, plus an explicit "both submitted" join for the partner's numbers.

Known by-design property: anyone can unlock the reveal by submitting. Submit requires all four ratings, but not honest ones.

## Tests
- `npm test`: unit tests (draft autosave engine). DB tests are skipped unless a database is available.
- `npm run test:rls`: spins up a throwaway local Postgres (no Docker needed), applies a small Supabase shim + all migrations + seed, and runs the leak tests. Each probe runs as PostgREST does: `SET ROLE authenticated` plus the caller's JWT claims, with RLS enforced. Set `TEST_DATABASE_URL` to use your own server.
- `npm run test:live`: **opt-in** end-to-end check against a real Supabase project over the real REST API (two real users, created and deleted). Needs `LIVE_SUPABASE_URL`, `LIVE_SUPABASE_ANON_KEY`, `LIVE_SUPABASE_SERVICE_ROLE_KEY`. Use a staging project.

## Episode list: please verify
I had no network access to a reference source, so all 121 rows were written from memory (target: 22/22/22/22/20/13).
- **Seasons 1 and 2, and S3 E1-9**: high confidence.
- **S3 E10-22, S4, S5, S6**: titles are real Glee episodes as far as I recall, but *order within the season* is unverified (flagged `order unverified`).
- **S4 E19, S5 E14-15**: title and order both uncertain.
- **S4 E21 and S5 E16-20**: titles I couldn't recall, seeded as `Season N, Episode M (title TBD)`.
- Season episode counts for S4/S5 (22/20) are also from memory.

Flagged rows show a ⚠️ in the app. To fix: edit `data/episodes.txt` (clear the note once verified), `npm run gen:episodes`, re-run `supabase/seed.sql` (idempotent upsert).

## PWA / mobile
Installable (manifest + service worker via vite-plugin-pwa), safe-area padding, 48px tap targets, dark mode, tap counters with undo. Supabase API calls are never cached by the service worker; offline resilience for drafts is the app's own local-first sync (see `src/lib/draftSync.ts`): edits persist to local storage instantly, sync as full idempotent snapshots, retry with backoff, and resume after reload or reconnect.
