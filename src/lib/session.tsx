import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Member, Pair } from './types'

interface Ctx {
  session: Session | null
  loading: boolean
  me: Member | null
  /** Everyone else in my club (0–2 people). */
  partners: Member[]
  pair: Pair | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionCtx = createContext<Ctx | null>(null)

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [me, setMe] = useState<Member | null>(null)
  const [partners, setPartners] = useState<Member[]>([])
  const [pair, setPair] = useState<Pair | null>(null)

  const loadProfile = useCallback(async (uid: string | null) => {
    if (!uid) {
      setMe(null); setPartners([]); setPair(null)
      return
    }
    // RLS returns my row plus my clubmates' rows (whoever has joined).
    const { data: members } = await supabase.from('users').select('id, pair_id, display_name')
    const mine = members?.find((m) => m.id === uid) ?? null
    setMe(mine)
    setPartners((members ?? []).filter((m) => m.id !== uid).sort((a, b) => a.display_name.localeCompare(b.display_name)))
    if (mine) {
      const { data: p } = await supabase.from('pairs').select('id, invite_code').maybeSingle()
      setPair(p ?? null)
    } else {
      setPair(null)
    }
  }, [])

  useEffect(() => {
    let active = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      await loadProfile(data.session?.user.id ?? null)
      if (active) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      // Defer: calling supabase inside this callback can deadlock the auth lock.
      setTimeout(() => void loadProfile(s?.user.id ?? null), 0)
    })
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [loadProfile])

  const refresh = useCallback(() => loadProfile(session?.user.id ?? null), [loadProfile, session])
  const signOut = useCallback(async () => { await supabase.auth.signOut() }, [])

  return (
    <SessionCtx.Provider value={{ session, loading, me, partners, pair, refresh, signOut }}>
      {children}
    </SessionCtx.Provider>
  )
}

export function useSession() {
  const c = useContext(SessionCtx)
  if (!c) throw new Error('useSession outside SessionProvider')
  return c
}
