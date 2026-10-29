import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useSession } from '../lib/session'
import { DraftSyncer, type SyncStatus } from '../lib/draftSync'
import {
  fetchEpisodeReviews, fetchEpisodes, isComplete, saveDraft, submitReview, type LoadedReview, type PartnerReview,
} from '../lib/reviews'
import { emptyContent, type Episode, type ReviewContent } from '../lib/types'
import ReviewFields from '../components/ReviewFields'

const STATUS_COPY: Record<SyncStatus, string> = {
  idle: '',
  dirty: 'Unsaved… ✏️',
  saving: 'Saving… 🎵',
  saved: 'Saved ✓',
  offline: 'Offline. Draft is safe on this phone and will sync soon 📶',
  error: 'Hmm, the server said no.',
}

const partnerNames = (names: string[]) =>
  names.length === 0 ? 'Your clubmates'
    : names.length === 1 ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`

export default function EpisodePage() {
  const { id } = useParams()
  const episodeId = Number(id)
  const { session, me, partners } = useSession()
  const uid = session!.user.id

  const [episode, setEpisode] = useState<Episode | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mine, setMine] = useState<LoadedReview | null>(null)
  const [others, setOthers] = useState<PartnerReview[]>([])
  const [content, setContent] = useState<ReviewContent>(emptyContent())
  const [status, setStatus] = useState<SyncStatus>('idle')
  const [statusDetail, setStatusDetail] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const syncer = useRef<DraftSyncer | null>(null)

  const submitted = mine?.row.status === 'submitted'

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    const key = `glee:draft:${uid}:${episodeId}`
    const s = new DraftSyncer({
      key,
      send: (c) => saveDraft(episodeId, c),
      onStatus: (st, d) => { setStatus(st); setStatusDetail(d) },
    })
    syncer.current?.dispose()
    syncer.current = s
    const local = s.loadLocal()
    try {
      const [eps, rev] = await Promise.all([fetchEpisodes(), fetchEpisodeReviews(episodeId, uid)])
      setEpisode(eps.find((e) => e.id === episodeId) ?? null)
      setMine(rev.mine); setOthers(rev.others)
      if (rev.mine?.row.status === 'submitted') {
        s.clear() // final on the server; any stale local copy is obsolete
        setContent(rev.mine.content)
      } else if (local?.dirty) {
        setContent(local.content); s.resume(local.content) // unsynced local edits win
      } else {
        setContent(rev.mine?.content ?? emptyContent())
      }
    } catch (e) {
      // Offline cold start: fall back to the local draft so notes/taps still work.
      if (local) { setContent(local.content); s.resume(local.content) }
      else setLoadError((e as Error).message)
      fetchEpisodes().then((eps) => setEpisode(eps.find((x) => x.id === episodeId) ?? null)).catch(() => {})
    } finally {
      setLoading(false)
    }
  }, [uid, episodeId])

  useEffect(() => {
    void load()
    const kick = () => syncer.current?.kick()
    const vis = () => { if (document.visibilityState === 'visible') kick() }
    window.addEventListener('online', kick)
    document.addEventListener('visibilitychange', vis)
    return () => {
      window.removeEventListener('online', kick)
      document.removeEventListener('visibilitychange', vis)
      syncer.current?.dispose()
    }
  }, [load])

  const edit = useCallback((c: ReviewContent) => {
    setContent(c)
    syncer.current?.update(c)
  }, [])

  async function submit() {
    if (!window.confirm('Submit for real? Reviews are final. No take-backs, no encores.')) return
    setSubmitting(true); setSubmitError(null)
    try {
      await submitReview(episodeId, content)
      syncer.current?.clear()
      await load() // re-fetch: RLS now reveals each partner's review they've submitted
    } catch (e) {
      setSubmitError((e as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const title = useMemo(
    () => (episode ? `S${episode.season}E${episode.episode} · ${episode.title}` : 'Episode'),
    [episode],
  )

  if (loading) return <main className="page"><p className="muted">Cueing up the episode…</p></main>
  if (loadError) return <main className="page"><Link to="/">← Back</Link><p className="error">{loadError}</p><button className="primary" onClick={() => void load()}>Try again</button></main>

  return (
    <main className="page">
      <header className="ep-head">
        <Link to="/" className="back">← Episodes</Link>
        <h2>{title}</h2>
        {episode?.verify_note && <p className="verify">⚠️ Title/order unverified ({episode.verify_note})</p>}
      </header>

      {submitted ? (
        <>
          <p className="banner ok-banner">Submitted! Your review is locked in. 🔒</p>
          <h3 className="who">{me?.display_name} (you)</h3>
          <ReviewFields content={content} />
          {partners.length === 0 && (
            <p className="banner">Nobody else is in the club yet. Share your invite code from the Episodes tab. 👀</p>
          )}
          {partners.map((p) => {
            const theirs = others.find((o) => o.userId === p.id)
            return theirs ? (
              <div key={p.id}>
                <hr />
                <h3 className="who who-partner">{p.display_name} ✨ revealed</h3>
                <ReviewFields content={theirs.content} />
              </div>
            ) : (
              <p key={p.id} className="banner">
                Nothing from {p.display_name} yet. Once they submit, their take shows up right here. 👀
              </p>
            )
          })}
        </>
      ) : (
        <>
          <p className="banner">
            Drafts are private. {partnerNames(partners.map((p) => p.display_name))} can't peek until you both submit.
          </p>
          <ReviewFields content={content} onChange={edit} />
          <div className={`sync sync-${status}`} role="status">
            {STATUS_COPY[status]} {status === 'error' && statusDetail}
          </div>
          {submitError && <p className="error" role="alert">{submitError}</p>}
          <button className="primary submit" disabled={!isComplete(content) || submitting} onClick={() => void submit()}>
            {submitting ? 'Taking a bow…' : 'Submit review (final!)'}
          </button>
          {!isComplete(content) && <p className="muted center">Rate all four scales to unlock submit.</p>}
        </>
      )}
    </main>
  )
}
