import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useSession } from '../lib/session'

export default function PairPage() {
  const { refresh, signOut } = useSession()
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null)
    const { error } =
      mode === 'create'
        ? await supabase.rpc('create_pair', { p_display_name: name })
        : await supabase.rpc('join_pair', { p_code: code, p_display_name: name })
    if (error) { setBusy(false); return setError(error.message) }
    await refresh()
    setBusy(false)
  }

  return (
    <main className="card-page">
      <div className="logo">G</div>
      <h1>Find your Glee club</h1>
      <p className="tagline">Start a club (up to three people) and share the code, or join with the code you were handed.</p>

      <div className="seg" role="tablist">
        <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>Start a club</button>
        <button role="tab" aria-selected={mode === 'join'} onClick={() => setMode('join')}>I have a code</button>
      </div>

      <form onSubmit={submit} className="stack">
        <label>
          What should we call you?
          <input required maxLength={40} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Berry, Santana, Sue" />
        </label>
        {mode === 'join' && (
          <label>
            Invite code
            <input
              required value={code} onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters" autoComplete="off" spellCheck={false}
              className="code-input" placeholder="XXXX-XXXX"
            />
          </label>
        )}
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? 'Harmonizing…' : mode === 'create' ? 'Create my club' : 'Join the club'}
        </button>
      </form>
      <button className="link" onClick={() => void signOut()}>Sign out</button>
    </main>
  )
}
