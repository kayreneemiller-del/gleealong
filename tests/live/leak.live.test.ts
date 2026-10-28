/**
 * Opt-in end-to-end leak check against a REAL Supabase project, over the real REST API (PostgREST),
 * with two real signed-in users. Skipped unless these are set:
 *   LIVE_SUPABASE_URL, LIVE_SUPABASE_KEY (publishable), LIVE_SUPABASE_SECRET (secret key)
 * Use a throwaway/staging project: it creates and then deletes two users (and their pair/reviews).
 * Run: npm run test:live
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const { LIVE_SUPABASE_URL: URL_, LIVE_SUPABASE_KEY, LIVE_SUPABASE_ANON_KEY, LIVE_SUPABASE_SECRET, LIVE_SUPABASE_SERVICE_ROLE_KEY } = process.env
const ANON = LIVE_SUPABASE_KEY ?? LIVE_SUPABASE_ANON_KEY
const SERVICE = LIVE_SUPABASE_SECRET ?? LIVE_SUPABASE_SERVICE_ROLE_KEY
const enabled = Boolean(URL_ && ANON && SERVICE)

const body = (notes: string) => ({
  overall_gleeks: 4, notes,
  ratings: { sue_c: 4, schue_cringe: 4, rachel_extra: 4 },
  counters: { schue_creep: 1, schue_rap: 2, rachel_cries: 3, brittana: 4, sue_nicknames: 5 },
})

describe.skipIf(!enabled)('live: reveal rule over the real REST API', () => {
  const admin = createClient(URL_ ?? 'http://x', SERVICE ?? 'x', { auth: { persistSession: false } })
  const stamp = Date.now()
  const creds = [`leak-a-${stamp}@example.com`, `leak-b-${stamp}@example.com`].map((email) => ({ email, password: `pw-${stamp}-Xy!` }))
  const ids: string[] = []
  let a: SupabaseClient, b: SupabaseClient

  async function signIn(i: number) {
    const c = createClient(URL_!, ANON!, { auth: { persistSession: false } })
    const { error } = await c.auth.signInWithPassword(creds[i])
    if (error) throw error
    return c
  }

  beforeAll(async () => {
    for (const c of creds) {
      const { data, error } = await admin.auth.admin.createUser({ ...c, email_confirm: true })
      if (error) throw error
      ids.push(data.user.id)
    }
    a = await signIn(0); b = await signIn(1)
    const { data: pair, error } = await a.rpc('create_pair', { p_display_name: 'LeakA' })
    if (error) throw error
    const j = await b.rpc('join_pair', { p_code: pair.invite_code, p_display_name: 'LeakB' })
    if (j.error) throw j.error
  })
  afterAll(async () => { for (const id of ids) await admin.auth.admin.deleteUser(id) })

  it('A sees nothing of B until A submits; then sees exactly B\'s submitted episode', async () => {
    expect((await b.rpc('submit_review', { p_episode_id: 1, p_payload: body('LIVE-SECRET') })).error).toBeNull()
    await b.rpc('save_draft', { p_episode_id: 2, p_payload: body('LIVE-DRAFT') })

    const probe = async () => ({
      reviews: (await a.from('reviews').select('*').neq('user_id', ids[0])).data,
      notes: (await a.from('notes').select('*')).data,
      counters: (await a.from('counters').select('*')).data,
      ratings: (await a.from('ratings').select('*')).data,
      embedded: (await a.from('reviews').select('*, ratings(*), counters(*), notes(*)')).data,
    })
    const before = await probe()
    expect(before).toEqual({ reviews: [], notes: [], counters: [], ratings: [], embedded: [] })
    expect((await a.rpc('season_stats', { p_subject: ids[1] })).data.episodes_counted).toBe(0)

    expect((await a.rpc('submit_review', { p_episode_id: 1, p_payload: body('mine') })).error).toBeNull()
    const after = await probe()
    expect(after.reviews).toHaveLength(1)
    expect(after.notes?.map((n) => n.body).sort()).toEqual(['LIVE-SECRET', 'mine'])
    expect(JSON.stringify(after)).not.toContain('LIVE-DRAFT')
  })

  it('anonymous (no JWT) requests get nothing', async () => {
    const anon = createClient(URL_!, ANON!, { auth: { persistSession: false } })
    const r = await anon.from('reviews').select('*')
    expect(r.data ?? []).toEqual([])
  })
})
