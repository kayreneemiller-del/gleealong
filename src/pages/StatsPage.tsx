import { useEffect, useState } from 'react'
import { useSession } from '../lib/session'
import { fetchDisagreements, fetchSeasonStats, type Disagreement, type PickedEpisode, type SeasonStats } from '../lib/stats'
import { COUNTERS, OVERALL, SCALES } from '../lib/types'

const AVG_ROWS = [...SCALES.map((s) => ({ key: s.key, label: s.label })), { key: OVERALL.key, label: OVERALL.label }] as const
const ep = (e: PickedEpisode) => `S${e.season}E${e.episode} ${e.title}`

function StatsCard({ title, stats, empty }: { title: string; stats: SeasonStats | null; empty: string }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {!stats || stats.episodes_counted === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <>
          <p className="muted">{stats.episodes_counted} episode{stats.episodes_counted === 1 ? '' : 's'} counted</p>
          <dl className="avgs">
            {AVG_ROWS.map((r) => (
              <div key={r.key}><dt>{r.label}</dt><dd>{stats.averages[r.key]?.toFixed(1) ?? '–'}</dd></div>
            ))}
          </dl>
          {stats.favorite && <p>🏆 <strong>Favorite:</strong> {ep(stats.favorite)} ({stats.favorite.overall_gleeks}/5)</p>}
          {stats.worst && <p>🗑️ <strong>Worst:</strong> {ep(stats.worst)} ({stats.worst.overall_gleeks}/5)</p>}
          <ul className="tallies">
            {COUNTERS.map((c) => <li key={c.key}>{c.emoji} {c.label}: <strong>{stats.counters[c.key]}</strong></li>)}
          </ul>
        </>
      )}
    </section>
  )
}

export default function StatsPage() {
  const { session, partner } = useSession()
  const uid = session!.user.id
  const [season, setSeason] = useState<number | null>(null)
  const [mine, setMine] = useState<SeasonStats | null>(null)
  const [theirs, setTheirs] = useState<SeasonStats | null>(null)
  const [dis, setDis] = useState<Disagreement[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    Promise.all([
      fetchSeasonStats(uid, season),
      partner ? fetchSeasonStats(partner.id, season) : Promise.resolve(null),
      partner ? fetchDisagreements(season) : Promise.resolve([]),
    ])
      .then(([m, t, d]) => { setMine(m); setTheirs(t); setDis(d) })
      .catch((e) => setError((e as Error).message))
  }, [uid, partner, season])

  const name = partner?.display_name ?? 'Your partner'
  return (
    <main className="page">
      <h2>The numbers 📊</h2>
      <div className="seasons seven" role="tablist" aria-label="Season">
        {[null, 1, 2, 3, 4, 5, 6].map((s) => (
          <button key={s ?? 'all'} role="tab" aria-selected={s === season} onClick={() => setSeason(s)}>{s ?? 'All'}</button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}

      <StatsCard title="Your season" stats={mine} empty="Submit a review and your stats show up. Go forth and judge." />
      <StatsCard
        title={`${name}'s season`} stats={theirs}
        empty={`Only episodes you BOTH submitted count here. Nothing in common yet. Get watching!`}
      />
      <p className="muted small">{name}'s numbers only include episodes you've both submitted, so nobody gets spoiled.</p>

      <section className="card">
        <h3>Biggest disagreements 🥊</h3>
        {dis.length === 0 ? <p className="muted">No shared episodes yet. The feud is brewing.</p> : (
          <ol className="dis">
            {dis.map((d) => (
              <li key={d.episode_id}>
                <strong>S{d.season}E{d.episode} {d.title}</strong>
                <span className="gap">avg gap {d.score.toFixed(2)}</span>
                <span className="muted small">
                  {AVG_ROWS.map((r) => `${r.label.split(' ')[0]} ${d.scales[r.key].mine} vs ${d.scales[r.key].theirs}`).join(' · ')}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  )
}
