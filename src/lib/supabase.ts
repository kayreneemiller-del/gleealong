import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
// VITE_SUPABASE_KEY is the publishable key (sb_publishable_..., the old "anon" key). The older names still work.
// Names are case-sensitive and must start with VITE_. NEVER put the secret key in a VITE_ variable.
const env = import.meta.env
const key = (env.VITE_SUPABASE_KEY ??
  env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  env.VITE_SUPABASE_ANON_KEY ??
  env.VITE_SUPABASE_PUBLISHABLE) as
  | string
  | undefined

export const isConfigured = Boolean(url && key)

// Placeholder values keep module load from throwing; <ConfigGate/> blocks the app when unconfigured.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})
