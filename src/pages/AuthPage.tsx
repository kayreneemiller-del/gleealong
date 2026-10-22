import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthPage() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setMsg(null)
    const { data, error } =
      mode === 'signup'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) return setMsg({ kind: 'error', text: error.message })
    if (mode === 'signup' && !data.session)
      setMsg({ kind: 'ok', text: 'Check your email to confirm, then sign in. Standing by for applause.' })
  }

  return (
    <main className="card-page">
      <div className="logo">G</div>
      <h1>Glee-Along</h1>
      <p className="tagline">Two people. One rewatch. Zero chill about Sue Sylvester.</p>

      <form onSubmit={submit} className="stack">
        <label>
          Email
          <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input
            type="password" required minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password} onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {msg && <p className={msg.kind === 'error' ? 'error' : 'ok'} role="status">{msg.text}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Hitting the high note…' : mode === 'signup' ? 'Join the glee club' : 'Back to rehearsal'}
        </button>
      </form>
      <button className="link" onClick={() => { setMode(mode === 'signup' ? 'signin' : 'signup'); setMsg(null) }}>
        {mode === 'signup' ? 'Already in the club? Sign in' : 'New here? Make an account'}
      </button>
    </main>
  )
}
