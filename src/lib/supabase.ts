import { createClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined
// VITE_SUPABASE_KEY is the publishable key (sb_publishable_..., the old "anon" key). The older names still work.
// Names are case-sensitive. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (from Vercel's Supabase
// integration) also work. NEVER put the secret key in a VITE_ variable.
const env = import.meta.env
const key = (env.VITE_SUPABASE_KEY ??
  env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  env.VITE_SUPABASE_ANON_KEY ??
  env.VITE_SUPABASE_PUBLISHABLE ??
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as
  | string
  | undefined

export const isConfigured = Boolean(url && key)

// Placeholder values keep module load from throwing; <ConfigGate/> blocks the app when unconfigured.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
})
