import { useEffect, useState } from 'react'
import {
  fetchCollectiveStats, fetchSeasonProgress, type CollectiveStats, type SeasonProgress,
} from '../lib/stats'
import { COUNTERS, OVERALL, SCALES } from '../lib/types'

const AVG_ROWS = [...SCALES.map((s) => ({ key: s.key, label: s.label })), { key: OVERALL.key, label: OVERALL.label }] as const
const ep = (e: { season: number; episode: number; title: string }) => `S${e.season}E${e.episode} ${e.title}`

export default function CollectivePage() {
  const [season, setSeason] = useState(() => Number(sessionStorage.getItem('glee:together')) || 1)
  const [progress, setProgress] = useState<SeasonProgress | null>(null)
  const [stats, setStats] = useState<CollectiveStats | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setError(null); setProgress(null); setStats(null)
    fetchSeasonProgress(season)
      .then(async (p) => {
        if (!active) return
        setProgress(p)
        if (p.unlocked) {
          const s = await fetchCollectiveStats(season)
          if (active) setStats(s)
        }
      })
      .catch((e) => { if (active) setError((e as Error).message) })
    return () => { active = false }
  }, [season])

  const pick = (s: number) => { setSeason(s); sessionStorage.setItem('glee:together', String(s)) }

  return (
    <main className="page">
      <h2>All together now 🎭</h2>
      <div className="seasons" role="tablist" aria-label="Season">
        {[1, 2, 3, 4, 5, 6].map((s) => (
          <button key={s} role="tab" aria-selected={s === season} onClick={() => pick(s)}>S{s}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}

      {progress && !progress.unlocked && (
        <section className="card">
          <h3>Season {season} is locked 🔒</h3>
          <p>
            {progress.members < 2
              ? 'Bring at least one more person into the club to unlock group stats.'
              : 'Unlocks when everyone in the club has reviewed every episode of the season.'}
          </p>
          <progress max={progress.total_episodes} value={progress.done_by_all} aria-label="Episodes reviewed by everyone" />
          <p className="muted">
            {progress.done_by_all} of {progress.total_episodes} episodes done by all {progress.members} of you
          </p>
        </section>
      )}

      {stats && (
        <>
          <section className="card">
            <h3>Season {stats.season}: the club's verdict</h3>
            <p className="muted">{stats.episodes_counted} episodes, {stats.members} reviewers</p>
            <dl className="avgs">
              {AVG_ROWS.map((r) => (
                <div key={r.key}><dt>{r.label}</dt><dd>{stats.averages[r.key]?.toFixed(1) ?? '–'}</dd></div>
              ))}
            </dl>
            {stats.favorite && <p>🏆 <strong>Favorite:</strong> {ep(stats.favorite)} ({stats.favorite.avg_overall.toFixed(1)}/5)</p>}
            {stats.worst && <p>🗑️ <strong>Worst:</strong> {ep(stats.worst)} ({stats.worst.avg_overall.toFixed(1)}/5)</p>}
            <ul className="tallies">
              {COUNTERS.map((c) => <li key={c.key}>{c.emoji} {c.label}: <strong>{stats.counters[c.key]}</strong></li>)}
            </ul>
          </section>

          <section className="card">
            <h3>Who rated what</h3>
            <table className="members">
              <thead>
                <tr><th />{AVG_ROWS.map((r) => <th key={r.key}>{r.label.split(' ')[0]}</th>)}</tr>
              </thead>
              <tbody>
                {stats.per_member.map((m) => (
                  <tr key={m.user_id}>
                    <th scope="row">{m.display_name}</th>
                    {AVG_ROWS.map((r) => <td key={r.key}>{m.averages[r.key]?.toFixed(1) ?? '–'}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h3>Biggest disagreements 🥊</h3>
            <ol className="dis">
              {stats.disagreements.map((d) => (
                <li key={d.episode_id}>
                  <strong>{ep(d)}</strong>
                  <span className="gap">avg spread {d.spread.toFixed(2)}</span>
                  <span className="muted small">
                    {d.by_member.map((m) => `${m.name} ${m.overall_gleeks}`).join(' · ')} overall
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </main>
  )
}
