# Glee-Along 🎶

A private two-person Glee rewatch app. React + Vite + TypeScript PWA, Supabase (auth, Postgres, RLS), deployed on Vercel.

## Setup
1. Create a Supabase project. In the SQL editor (or `supabase db push`), run `supabase/migrations/*.sql` in order, then `supabase/seed.sql`.
2. Auth → Providers → Email. For a two-person app, turn **off** "Confirm email" (or the sign-up flow will ask you to confirm first).
3. `cp .env.example .env.local` and fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (the publishable key, `sb_publishable_...`, from Project Settings → API Keys). Older names `VITE_SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_ANON_KEY` also work. The secret key never goes in the app. On Vercel with the Supabase integration, the `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` variables it creates are picked up automatically (`envPrefix` in `vite.config.ts` allows only `VITE_` and `NEXT_PUBLIC_`; never add `SUPABASE_` or `POSTGRES_`).
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
- `npm run test:live`: **opt-in** end-to-end check against a real Supabase project over the real REST API (two real users, created and deleted). Needs `LIVE_SUPABASE_URL`, `LIVE_SUPABASE_KEY` (publishable) and `LIVE_SUPABASE_SECRET` (secret key; run it on your own machine only). Use a staging project.

## Episode list
All 121 episodes (22/22/22/22/20/13) come from Wikipedia's "List of Glee episodes" and are numbered by in-season episode. `verify_note` support remains in the schema and UI (a ⚠️ shows on any row with a note) in case you want to flag something. To change the list: edit `data/episodes.txt`, `npm run gen:episodes`, then re-run `supabase/seed.sql` (idempotent upsert).

## PWA / mobile
Installable (manifest + service worker via vite-plugin-pwa), safe-area padding, 48px tap targets, dark mode, tap counters with undo. Supabase API calls are never cached by the service worker; offline resilience for drafts is the app's own local-first sync (see `src/lib/draftSync.ts`): edits persist to local storage instantly, sync as full idempotent snapshots, retry with backoff, and resume after reload or reconnect.
