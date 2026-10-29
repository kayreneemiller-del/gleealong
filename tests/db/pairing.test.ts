import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { asUser, expectError, freshDb, makeUser, url } from './helpers'

describe.skipIf(!url)('pairing', () => {
  let c: pg.Client
  let a: string, b: string, g: string, x: string
  beforeAll(async () => {
    c = await freshDb('glee_pairing')
    a = await makeUser(c, 'a@example.com')
    b = await makeUser(c, 'b@example.com')
    g = await makeUser(c, 'g@example.com')
    x = await makeUser(c, 'x@example.com')
  })
  afterAll(() => c.end())

  it('seeds all 121 episodes across 6 seasons', async () => {
    const r = await c.query('select count(*)::int n, count(distinct season)::int s from episodes')
    expect(r.rows[0]).toEqual({ n: 121, s: 6 })
  })

  it('creates a pair, joins with a code (any casing/dashes), and caps at three', async () => {
    const pair = await asUser(c, a, async (q) => (await q(`select * from create_pair('Alpha')`)).rows[0])
    expect(pair.invite_code).toMatch(/^[A-HJKMNP-Z2-9]{8}$/)
    const dashed = `${pair.invite_code.slice(0, 4)}-${pair.invite_code.slice(4)}`.toLowerCase()
    await asUser(c, b, (q) => q(`select * from join_pair($1, 'Beta')`, [dashed]))
    await asUser(c, g, (q) => q(`select * from join_pair($1, 'Gamma')`, [pair.invite_code]))
    const msg = await expectError(c, x, `select * from join_pair($1, 'Xavier')`, [pair.invite_code])
    expect(msg).toMatch(/invite code did not work/)
  })

  it('bad codes and double joins fail with the same generic message', async () => {
    expect(await expectError(c, x, `select * from join_pair('NOPE1234', 'X')`)).toMatch(/did not work/)
    expect(await expectError(c, a, `select * from create_pair('Again')`)).toMatch(/already in a pair/)
  })

  it('members see each other; outsiders see nobody and no codes', async () => {
    const seenByA = await asUser(c, a, async (q) => (await q('select display_name from users order by 1')).rows)
    expect(seenByA.map((r) => r.display_name)).toEqual(['Alpha', 'Beta', 'Gamma'])
    const seenByX = await asUser(c, x, async (q) => ({
      users: (await q('select * from users')).rows,
      pairs: (await q('select * from pairs')).rows,
    }))
    expect(seenByX).toEqual({ users: [], pairs: [] })
  })

  it('clients cannot write pairs/users directly', async () => {
    expect(await expectError(c, x, `insert into users (id, pair_id, display_name) select $1, id, 'Sneak' from pairs limit 1`, [x])).toMatch(/permission denied/)
    expect(await expectError(c, a, `update users set display_name = 'Hax'`)).toMatch(/permission denied/)
  })
})
