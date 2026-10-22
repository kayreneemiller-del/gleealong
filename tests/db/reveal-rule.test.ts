/**
 * THE leak test. Every probe below runs exactly the way PostgREST runs a client request:
 * `SET LOCAL ROLE authenticated` + the caller's JWT claims (so auth.uid() resolves), RLS fully enforced.
 * That is what "direct API access" boils down to; there is no UI in the loop.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { asUser, expectError, freshDb, makeUser, url } from './helpers'

type Q = (sql: string, params?: unknown[]) => Promise<pg.QueryResult>
const review = (o: number, s: number, c: number, r: number, notes: string, counters = {}) => ({
  overall_gleeks: o, notes,
  ratings: { sue_c: s, schue_cringe: c, rachel_extra: r },
  counters: { schue_creep: 0, schue_rap: 0, rachel_cries: 0, brittana: 0, sue_nicknames: 0, ...counters },
})

describe.skipIf(!url)('reveal rule: no leaks via direct API access', () => {
  let db: pg.Client
  let A: string, B: string, X: string, Y: string // A,B = pair 1; X,Y = pair 2 (outsiders)

  const save = (uid: string, ep: number, p: object) => asUser(db, uid, (q) => q('select * from save_draft($1, $2)', [ep, JSON.stringify(p)]))
  const submit = (uid: string, ep: number, p: object) => asUser(db, uid, (q) => q('select * from submit_review($1, $2)', [ep, JSON.stringify(p)]))

  /** Everything the user can read, from every table/view that could carry review data. */
  const everythingVisible = (uid: string) =>
    asUser(db, uid, async (q: Q) => ({
      reviews: (await q('select * from reviews')).rows,
      ratings: (await q('select * from ratings')).rows,
      counters: (await q('select * from counters')).rows,
      notes: (await q('select * from notes')).rows,
      scores: (await q('select * from review_scores')).rows,
    }))
  const theirStuff = async (uid: string, otherId: string) => {
    const v = await everythingVisible(uid)
    const theirReviewIds = new Set((await db.query('select id from reviews where user_id = $1', [otherId])).rows.map((r) => r.id))
    return {
      reviews: v.reviews.filter((r) => r.user_id === otherId),
      ratings: v.ratings.filter((r) => theirReviewIds.has(r.review_id)),
      counters: v.counters.filter((r) => theirReviewIds.has(r.review_id)),
      notes: v.notes.filter((r) => theirReviewIds.has(r.review_id)),
      scores: v.scores.filter((r) => r.user_id === otherId),
    }
  }
  const nothing = { reviews: [], ratings: [], counters: [], notes: [], scores: [] }

  beforeAll(async () => {
    db = await freshDb('glee_reveal')
    A = await makeUser(db, 'a@example.com'); B = await makeUser(db, 'b@example.com')
    X = await makeUser(db, 'x@example.com'); Y = await makeUser(db, 'y@example.com')
    const p1 = await asUser(db, A, async (q) => (await q(`select * from create_pair('Alpha')`)).rows[0])
    await asUser(db, B, (q) => q(`select * from join_pair($1, 'Beta')`, [p1.invite_code]))
    const p2 = await asUser(db, X, async (q) => (await q(`select * from create_pair('Xena')`)).rows[0])
    await asUser(db, Y, (q) => q(`select * from join_pair($1, 'Yara')`, [p2.invite_code]))
  })
  afterAll(() => db.end())

  it('B submitted ep1 + ep3, drafted ep2; A has submitted NOTHING => A sees none of B, in any table', async () => {
    await submit(B, 1, review(5, 5, 5, 5, 'B-SECRET-ep1', { brittana: 7 }))
    await save(B, 2, review(1, 1, 1, 1, 'B-SECRET-draft-ep2'))
    await submit(B, 3, review(2, 2, 2, 2, 'B-SECRET-ep3'))
    expect(await theirStuff(A, B)).toEqual(nothing)
    // Direct lookups by guessable keys also come back empty (not "forbidden": the rows simply don't exist for A).
    const bIds = (await db.query('select id, episode_id from reviews where user_id = $1', [B])).rows
    await asUser(db, A, async (q: Q) => {
      for (const r of bIds) {
        expect((await q('select * from reviews where id = $1', [r.id])).rowCount).toBe(0)
        expect((await q('select * from ratings where review_id = $1', [r.id])).rowCount).toBe(0)
        expect((await q('select * from counters where review_id = $1', [r.id])).rowCount).toBe(0)
        expect((await q('select * from notes where review_id = $1', [r.id])).rowCount).toBe(0)
      }
      expect((await q('select * from reviews where episode_id = 1 and user_id <> auth.uid()')).rowCount).toBe(0)
      // PostgREST-style embedded select: reviews + children in one go.
      const emb = await q(`select r.*, (select json_agg(x) from ratings x where x.review_id = r.id) ratings from reviews r`)
      expect(emb.rowCount).toBe(0)
      // Text search over notes can't find the secret either.
      expect((await q(`select * from notes where body like '%SECRET%'`)).rowCount).toBe(0)
    })
  })

  it('stats RPCs give A nothing about B while A has submitted nothing', async () => {
    const s = await asUser(db, A, async (q) => (await q('select season_stats($1) s', [B])).rows[0].s)
    expect(s.episodes_counted).toBe(0)
    expect(s.averages).toEqual({ sue_c: null, schue_cringe: null, rachel_extra: null, overall_gleeks: null })
    expect(s.favorite).toBeNull()
    expect(s.counters.brittana).toBe(0)
    const d = await asUser(db, A, (q) => q('select * from biggest_disagreements(10)'))
    expect(d.rowCount).toBe(0)
  })

  it('A DRAFTING ep1 (not submitted) unlocks nothing', async () => {
    await save(A, 1, review(3, 3, 3, 3, 'A-ep1-draft'))
    expect(await theirStuff(A, B)).toEqual(nothing)
    // ...and B (who submitted) can't see A's draft either: drafts are private to the author.
    expect(await theirStuff(B, A)).toEqual(nothing)
  })

  it('submitting ep1 reveals ONLY ep1 of B (not ep2 draft, not ep3), and B sees A too', async () => {
    await submit(A, 1, review(3, 1, 2, 5, 'A-SECRET-ep1', { sue_nicknames: 4 }))
    const t = await theirStuff(A, B)
    expect(t.reviews.map((r) => r.episode_id)).toEqual([1])
    expect(t.notes.map((n) => n.body)).toEqual(['B-SECRET-ep1'])
    expect(t.counters.find((c) => c.counter === 'brittana')?.count).toBe(7)
    expect(t.ratings).toHaveLength(3)
    expect(JSON.stringify(t)).not.toMatch(/ep2|ep3/)
    const back = await theirStuff(B, A)
    expect(back.reviews.map((r) => r.episode_id)).toEqual([1])
    expect(back.notes.map((n) => n.body)).toEqual(['A-SECRET-ep1'])
  })

  it("B's draft on ep2 stays hidden even after A submits ep2", async () => {
    await submit(A, 2, review(4, 4, 4, 4, 'A-ep2'))
    const t = await theirStuff(A, B)
    expect(t.reviews.map((r) => r.episode_id)).toEqual([1]) // B's ep2 is still only a draft
    expect(JSON.stringify(t)).not.toContain('draft-ep2')
  })

  it("'their season' stats use ONLY mutually submitted episodes", async () => {
    const their = await asUser(db, A, async (q) => (await q('select season_stats($1) s', [B])).rows[0].s)
    // Mutual = ep1 only (B's ep3 is not mutual; ep2 is B's draft). So it must equal B's ep1 numbers exactly,
    // NOT the average of ep1+ep3 (which would be 3.5).
    expect(their.episodes_counted).toBe(1)
    expect(their.averages).toEqual({ sue_c: 5, schue_cringe: 5, rachel_extra: 5, overall_gleeks: 5 })
    expect(their.favorite.episode_id).toBe(1)
    expect(their.worst.episode_id).toBe(1)
    expect(their.counters.brittana).toBe(7)
  })

  it("B's later submissions on non-mutual episodes don't change what A sees (no inference by differencing)", async () => {
    const before = await asUser(db, A, async (q) => ({
      s: (await q('select season_stats($1) s', [B])).rows[0].s,
      d: (await q('select * from biggest_disagreements(10)')).rows,
      v: (await q('select * from review_scores')).rows.length,
    }))
    await submit(B, 4, review(1, 1, 1, 1, 'B-ep4', { schue_rap: 99 }))
    await submit(B, 5, review(5, 5, 5, 5, 'B-ep5', { schue_rap: 99 }))
    const after = await asUser(db, A, async (q) => ({
      s: (await q('select season_stats($1) s', [B])).rows[0].s,
      d: (await q('select * from biggest_disagreements(10)')).rows,
      v: (await q('select * from review_scores')).rows.length,
    }))
    expect(after).toEqual(before)
  })

  it('biggest disagreements: ranked, mutual-only', async () => {
    // Mutual: ep1 (A 3,1,2,5 vs B 5,5,5,5 -> diffs 2,4,3,0 => 2.25) and ep2? B only drafted ep2: not mutual.
    const d = await asUser(db, A, async (q) => (await q('select * from biggest_disagreements(10)')).rows)
    expect(d.map((r) => r.episode_id)).toEqual([1])
    expect(Number(d[0].score)).toBe(2.25)
    // Make ep2 mutual and far apart -> it should outrank ep1.
    await submit(B, 2, review(1, 1, 5, 1, 'B-ep2-final'))
    const d2 = await asUser(db, A, async (q) => (await q('select * from biggest_disagreements(10)')).rows)
    expect(d2.map((r) => r.episode_id)).toEqual([2, 1])
    expect(d2[0].scales.schue_cringe).toEqual({ mine: 4, theirs: 5 })
  })

  it('outsiders (other pair) see nothing of A or B, even with their own submissions', async () => {
    await submit(X, 1, review(3, 3, 3, 3, 'X-ep1'))
    await submit(Y, 1, review(3, 3, 3, 3, 'Y-ep1'))
    for (const other of [A, B]) {
      expect(await theirStuff(X, other)).toEqual(nothing)
      expect(await theirStuff(Y, other)).toEqual(nothing)
      expect(await theirStuff(other, X)).toEqual(nothing)
    }
    expect(await expectError(db, X, 'select season_stats($1)', [A])).toMatch(/only look at your own/)
    expect(await expectError(db, A, 'select season_stats($1)', [X])).toMatch(/only look at your own/)
    const xs = await asUser(db, X, async (q) => (await q('select season_stats($1) s', [Y])).rows[0].s)
    expect(xs.episodes_counted).toBe(1)
  })

  it('anonymous requests get nothing', async () => {
    for (const t of ['reviews', 'ratings', 'counters', 'notes', 'review_scores', 'users', 'pairs'])
      expect(await expectError(db, null, `select * from ${t}`)).toMatch(/permission denied/)
    expect(await expectError(db, null, 'select season_stats($1)', [A])).toMatch(/permission denied/)
  })

  it('A cannot write into B\'s reviews, or forge reviews as B', async () => {
    const bRev = (await db.query(`select id from reviews where user_id = $1 and episode_id = 1`, [B])).rows[0].id
    expect(await expectError(db, A, `insert into reviews (user_id, episode_id) values ($1, 10)`, [B])).toMatch(/row-level security/)
    expect(await expectError(db, A, `insert into ratings (review_id, scale, value) values ($1, 'sue_c', 1)`, [bRev])).toMatch(/row-level security|final/)
    const before = (await db.query('select md5(string_agg(r::text, \',\' order by id)) h from reviews r')).rows[0].h
    await asUser(db, A, (q) => q(`update reviews set overall_gleeks = 1 where user_id = $1`, [B]))
    await asUser(db, A, (q) => q(`delete from reviews where user_id = $1`, [B]))
    await asUser(db, A, (q) => q(`update notes set body = 'pwned'`))
    expect((await db.query('select md5(string_agg(r::text, \',\' order by id)) h from reviews r')).rows[0].h).toBe(before)
    expect((await db.query(`select count(*)::int n from notes where body = 'pwned'`)).rows[0].n).toBe(0)
  })

  it("A can't flip a draft to submitted without rating everything (no cheap unlock)", async () => {
    await save(A, 6, { notes: 'half-baked', ratings: { sue_c: 3 } })
    expect(await expectError(db, A, `update reviews set status = 'submitted' where episode_id = 6`)).toMatch(/Rate everything/)
    expect(await expectError(db, A, `select * from submit_review(6)`)).toMatch(/Rate everything/)
  })

  it('RLS is enabled on every table that holds pair or review data', async () => {
    const r = await db.query(`select relname, relrowsecurity from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace order by 1`)
    expect(r.rows.map((x) => x.relname)).toEqual(['counters', 'episodes', 'notes', 'pairs', 'ratings', 'reviews', 'users'])
    expect(r.rows.filter((x) => !x.relrowsecurity)).toEqual([])
  })
})
