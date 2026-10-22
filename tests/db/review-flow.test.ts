import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type pg from 'pg'
import { asUser, expectError, freshDb, makeUser, url } from './helpers'

const full = {
  overall_gleeks: 4, notes: 'Sue was unhinged',
  ratings: { sue_c: 5, schue_cringe: 3, rachel_extra: 4 },
  counters: { schue_creep: 1, schue_rap: 0, rachel_cries: 2, brittana: 3, sue_nicknames: 4 },
}

describe.skipIf(!url)('review lifecycle', () => {
  let c: pg.Client
  let a: string
  beforeAll(async () => {
    c = await freshDb('glee_flow')
    a = await makeUser(c, 'a@example.com')
    await asUser(c, a, (q) => q(`select * from create_pair('Alpha')`))
  })
  afterAll(() => c.end())

  it('autosave is idempotent and absolute (retry-safe)', async () => {
    for (let i = 0; i < 3; i++)
      await asUser(c, a, (q) => q(`select * from save_draft(1, $1)`, [JSON.stringify(full)]))
    const r = await c.query(`select (select count(*) from reviews)::int rv, (select count(*) from ratings)::int rt,
      (select count(*) from counters)::int ct, (select count(*) from notes)::int nt, (select count from counters where counter='sue_nicknames') n`)
    expect(r.rows[0]).toEqual({ rv: 1, rt: 3, ct: 5, nt: 1, n: 4 })
  })

  it('partial drafts save; submit is refused until everything is rated', async () => {
    await asUser(c, a, (q) => q(`select * from save_draft(2, '{"notes":"wip"}')`))
    expect(await expectError(c, a, `select * from submit_review(2)`)).toMatch(/Rate everything/)
  })

  it('submitted reviews are final: no edits, deletes, or child writes', async () => {
    await asUser(c, a, (q) => q(`select * from submit_review(1)`))
    expect(await expectError(c, a, `select * from save_draft(1, $1)`, [JSON.stringify(full)])).toMatch(/final/)
    // RLS hides submitted rows from update/delete, so as the user these are silent no-ops. Assert nothing changed.
    await asUser(c, a, (q) => q(`update reviews set overall_gleeks = 1 where episode_id = 1`))
    await asUser(c, a, (q) => q(`delete from reviews where episode_id = 1`))
    await asUser(c, a, (q) => q(`update ratings set value = 1`))
    await asUser(c, a, (q) => q(`delete from notes`))
    const r = await c.query(`select overall_gleeks, status from reviews where episode_id = 1`)
    expect(r.rows[0]).toEqual({ overall_gleeks: 4, status: 'submitted' })
    expect((await c.query(`select count(*)::int n from ratings where value = 1`)).rows[0].n).toBe(0)
    expect((await c.query(`select count(*)::int n from notes`)).rows[0].n).toBe(1)
    // Even a superuser bypassing RLS hits the trigger.
    await expect(c.query(`update reviews set overall_gleeks = 1 where episode_id = 1`)).rejects.toThrow(/final/)
    await expect(c.query(`update ratings set value = 1`)).rejects.toThrow(/final/)
  })

  it('cannot insert an already-submitted review or forge ownership', async () => {
    const b = await makeUser(c, 'b@example.com')
    expect(await expectError(c, a, `insert into reviews (user_id, episode_id, status, overall_gleeks, submitted_at) values ($1, 5, 'submitted', 5, now())`, [a])).toMatch(/row-level security/)
    expect(await expectError(c, a, `insert into reviews (user_id, episode_id) values ($1, 5)`, [b])).toMatch(/row-level security|foreign key/)
  })
})
