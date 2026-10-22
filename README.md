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
