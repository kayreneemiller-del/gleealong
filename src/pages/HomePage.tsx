import { useSession } from '../lib/session'

const fmtCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`

export default function HomePage() {
  const { me, partner, pair, signOut } = useSession()
  return (
    <main className="card-page">
      <h1>Hi, {me?.display_name}!</h1>
      {partner ? (
        <p>You and <strong>{partner.display_name}</strong> are officially a duet. 🎶</p>
      ) : (
        <div className="invite">
          <p>Waiting for your partner. Send them this code:</p>
          <button
            className="code-chip"
            onClick={() => pair && navigator.clipboard?.writeText(fmtCode(pair.invite_code))}
          >
            {pair ? fmtCode(pair.invite_code) : '…'}
          </button>
          <small>Tap to copy. It works for exactly one other person.</small>
        </div>
      )}
      <button className="link" onClick={() => void signOut()}>Sign out</button>
    </main>
  )
}
