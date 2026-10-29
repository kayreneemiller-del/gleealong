import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { asUser, expectError, freshDb, makeUser, url } from './helpers'

const review = (o: number, s: number, c: number, r: number, counters = {}) => ({
  overall_gleeks: o, notes: '',
  ratings: { sue_c: s, schue_cringe: c, rachel_extra: r },
  counters: { schue_creep: 0, schue_rap: 0, rachel_cries: 0, brittana: 0, sue_nicknames: 0, ...counters },
})

describe.skipIf(!url)('three-person club: pairwise reveal + collective season stats', () => {
  let db: pg.Client
  let A: string, B: string, C: string, X: string
  let s1: number[] // season 1 episode ids

  const submit = (uid: string, ep: number, p: object) =>
    asUser(db, uid, (q) => q('select * from submit_review($1, $2)', [ep, JSON.stringify(p)]))
  const progress = (uid: string, season: number) =>
    asUser(db, uid, async (q) => (await q('select season_progress($1) as p', [season])).rows[0].p)
  const collective = (uid: string, season: number) =>
    asUser(db, uid, async (q) => (await q('select collective_stats($1) as s', [season])).rows[0].s)
  const visibleFrom = (uid: string, otherId: string) =>
    asUser(db, uid, async (q) => (await q('select id from reviews where user_id = $1', [otherId])).rows.length)

  beforeAll(async () => {
    db = await freshDb('glee_collective')
    A = await makeUser(db, 'a@example.com'); B = await makeUser(db, 'b@example.com')
    C = await makeUser(db, 'c@example.com'); X = await makeUser(db, 'x@example.com')
    const p = await asUser(db, A, async (q) => (await q(`select * from create_pair('Alpha')`)).rows[0])
    await asUser(db, B, (q) => q(`select * from join_pair($1, 'Beta')`, [p.invite_code]))
    await asUser(db, C, (q) => q(`select * from join_pair($1, 'Gamma')`, [p.invite_code]))
    s1 = (await db.query('select id from episodes where season = 1 order by episode')).rows.map((r) => r.id)
  })
  afterAll(() => db.end())

  it('holds three people and refuses a fourth', async () => {
    const code = (await db.query('select invite_code from pairs')).rows[0].invite_code
    expect(await expectError(db, X, `select * from join_pair($1, 'Xena')`, [code])).toMatch(/did not work/)
    expect((await db.query('select count(*)::int n from users')).rows[0].n).toBe(3)
  })

  it('reveals each partner independently: A sees B once A and B have submitted, C stays hidden until C submits', async () => {
    const ep = s1[0]
    await submit(B, ep, review(4, 3, 3, 3))
    expect(await visibleFrom(A, B)).toBe(0) // A hasn't submitted yet
    await submit(A, ep, review(2, 2, 2, 2))
    expect(await visibleFrom(A, B)).toBe(1) // B revealed
    expect(await visibleFrom(A, C)).toBe(0) // C hasn't submitted: nothing to see
    expect(await visibleFrom(B, C)).toBe(0)
    await submit(C, ep, review(5, 5, 5, 5))
    expect(await visibleFrom(A, C)).toBe(1)
    expect(await visibleFrom(C, A)).toBe(1)
    expect(await visibleFrom(C, B)).toBe(1)
  })

  it('biggest_disagreements is per partner (no duplicate episodes)', async () => {
    const vsB = await asUser(db, A, async (q) => (await q('select * from biggest_disagreements($1, 5)', [B])).rows)
    const vsC = await asUser(db, A, async (q) => (await q('select * from biggest_disagreements($1, 5)', [C])).rows)
    expect(vsB).toHaveLength(1)
    expect(vsC).toHaveLength(1)
    expect(Number(vsB[0].score)).toBe(1.25) // gaps of 1, 1, 1 and 2 across the four scales
  })

  it('season stays locked until every member has submitted every episode', async () => {
    // A, B, C have all submitted s1[0]. Fill the rest for A and B only.
    for (const ep of s1.slice(1)) {
      await submit(A, ep, review(3, 3, 3, 3))
      await submit(B, ep, review(3, 3, 3, 3))
    }
    const p = await progress(A, 1)
    expect(p).toMatchObject({ members: 3, total_episodes: s1.length, done_by_all: 1, unlocked: false })
    expect(await expectError(db, A, 'select collective_stats(1)')).toMatch(/isn't unlocked yet/)
    // Progress is counts only: a member with nothing in a season learns nothing but the numbers.
    expect(Object.keys(p).sort()).toEqual(['done_by_all', 'members', 'season', 'total_episodes', 'unlocked'])
  })

  it('unlocks when the last member finishes the last episode, and the stats add up', async () => {
    for (const ep of s1.slice(1)) await submit(C, ep, review(3, 3, 3, 3, ep === s1[1] ? { brittana: 4 } : {}))
    expect(await progress(B, 1)).toMatchObject({ done_by_all: s1.length, unlocked: true })

    const stats = await collective(A, 1)
    expect(stats.members).toBe(3)
    expect(stats.episodes_counted).toBe(s1.length)
    expect(stats.counters.brittana).toBe(4)
    expect(stats.per_member.map((m: { display_name: string }) => m.display_name)).toEqual(['Alpha', 'Beta', 'Gamma'])
    // ep1 overall scores were 2, 4, 5 => biggest spread; it tops the disagreements list.
    expect(stats.disagreements[0].episode_id).toBe(s1[0])
    expect(stats.disagreements[0].ranges.overall_gleeks).toEqual({ min: 2, max: 5 })
    // Everyone else gave 3s, so the best episode by group average is ep1 (avg 3.67).
    expect(stats.favorite.episode_id).toBe(s1[0])
    // Same answer for every member.
    expect((await collective(C, 1)).averages).toEqual(stats.averages)
  })

  it('other seasons stay locked, and outsiders / strangers cannot read the club', async () => {
    expect(await progress(A, 2)).toMatchObject({ done_by_all: 0, unlocked: false })
    expect(await expectError(db, A, 'select collective_stats(2)')).toMatch(/isn't unlocked yet/)
    expect(await expectError(db, X, 'select collective_stats(1)')).toMatch(/Join a club first/)
    expect(await expectError(db, A, 'select collective_stats(9)')).toMatch(/Pick a season/)
    expect(await expectError(db, null, 'select collective_stats(1)')).toMatch(/permission denied/)
  })

  it('a member who joins later relocks the season until they catch up', async () => {
    // Free the cap by simulating the fourth seat as a superuser-level change: raise it for this test db only.
    await db.query('create or replace function public.pair_max_size() returns integer language sql immutable as $$ select 4 $$')
    const code = (await db.query('select invite_code from pairs')).rows[0].invite_code
    await asUser(db, X, (q) => q(`select * from join_pair($1, 'Xena')`, [code]))
    expect(await progress(A, 1)).toMatchObject({ members: 4, unlocked: false })
    expect(await expectError(db, A, 'select collective_stats(1)')).toMatch(/isn't unlocked yet/)
  })
})
