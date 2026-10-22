import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const root = join(import.meta.dirname, '..', '..')

export const url = process.env.TEST_DATABASE_URL

/** Fresh database with the shim, every migration, and the episode seed applied. */
export async function freshDb(name: string): Promise<pg.Client> {
  const admin = new pg.Client({ connectionString: url })
  await admin.connect()
  await admin.query(`drop database if exists ${name} with (force)`)
  await admin.query(`create database ${name}`)
  await admin.end()

  const u = new URL(url!)
  u.pathname = `/${name}`
  const c = new pg.Client({ connectionString: u.toString() })
  await c.connect()
  await c.query(readFileSync(join(import.meta.dirname, 'supabase-shim.sql'), 'utf8'))
  const dir = join(root, 'supabase', 'migrations')
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort())
    await c.query(readFileSync(join(dir, f), 'utf8'))
  await c.query(readFileSync(join(root, 'supabase', 'seed.sql'), 'utf8'))
  return c
}

/** Create an auth user (the Supabase signup step) as superuser. */
export async function makeUser(c: pg.Client, email: string): Promise<string> {
  const r = await c.query('insert into auth.users (email) values ($1) returning id', [email])
  return r.rows[0].id
}

/**
 * Run `fn` exactly as PostgREST would for a request carrying this user's JWT:
 * switch to the `authenticated` role (RLS applies) and set the claims auth.uid() reads.
 * Pass null for an anonymous request. Always rolled back unless commit=true.
 */
export async function asUser<T>(
  c: pg.Client,
  uid: string | null,
  fn: (q: (sql: string, params?: unknown[]) => Promise<pg.QueryResult>) => Promise<T>,
  commit = true,
): Promise<T> {
  await c.query('begin')
  try {
    await c.query(`set local role ${uid ? 'authenticated' : 'anon'}`)
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify(uid ? { sub: uid, role: 'authenticated' } : { role: 'anon' }),
    ])
    const out = await fn((sql, params) => c.query(sql, params as never))
    await c.query(commit ? 'commit' : 'rollback')
    return out
  } catch (e) {
    await c.query('rollback')
    throw e
  }
}

/** Run a statement expecting an error; returns the message. */
export async function expectError(
  c: pg.Client,
  uid: string | null,
  sql: string,
  params: unknown[] = [],
): Promise<string> {
  try {
    await asUser(c, uid, (q) => q(sql, params))
  } catch (e) {
    return (e as Error).message
  }
  throw new Error(`expected error but succeeded: ${sql}`)
}
