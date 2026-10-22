import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'
import { fetchEpisodes, fetchMyStatuses } from '../lib/reviews'
import type { Episode } from '../lib/types'

const fmtCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`
const LABEL = { none: 'Not started', draft: 'Watching 👀', submitted: 'Submitted ✓' } as const

export default function HomePage() {
  const { session, me, partner, pair } = useSession()
  const [season, setSeason] = useState(() => Number(sessionStorage.getItem('glee:season')) || 1)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [statuses, setStatuses] = useState<Map<number, 'draft' | 'submitted'>>(new Map())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchEpisodes(), fetchMyStatuses(session!.user.id)])
      .then(([e, s]) => { setEpisodes(e); setStatuses(s) })
      .catch((e) => setError((e as Error).message))
  }, [session])

  const pick = (s: number) => { setSeason(s); sessionStorage.setItem('glee:season', String(s)) }
  const list = episodes.filter((e) => e.season === season)
  const done = list.filter((e) => statuses.get(e.id) === 'submitted').length

  return (
    <main className="page">
      <h2>Hi, {me?.display_name}! 🎶</h2>
      {!partner && pair && (
        <div className="banner invite-banner">
          Waiting on your duet partner. Share code{' '}
          <button className="code-chip small" onClick={() => navigator.clipboard?.writeText(fmtCode(pair.invite_code))}>
            {fmtCode(pair.invite_code)}
          </button>{' '}
          (tap to copy).
        </div>
      )}

      <div className="seasons" role="tablist" aria-label="Season">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <button key={s} role="tab" aria-selected={s === season} onClick={() => pick(s)}>S{s}</button>
        ))}
      </div>
      <p className="muted">Season {season}: {done}/{list.length} submitted</p>
      {error && <p className="error">{error}</p>}

      <ul className="eps">
        {list.map((e) => {
          const st = statuses.get(e.id) ?? 'none'
          return (
            <li key={e.id}>
              <Link to={`/ep/${e.id}`} className="ep">
                <span className="ep-num">{e.episode}</span>
                <span className="ep-title">{e.title}{e.verify_note && <span title={e.verify_note}> ⚠️</span>}</span>
                <span className={`chip chip-${st}`}>{LABEL[st]}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </main>
  )
}
