import { supabase } from './supabase'
import { PermanentSyncError } from './draftSync'
import {
  emptyContent,
  type CounterKey,
  type Episode,
  type ReviewContent,
  type ReviewRow,
  type Scale,
} from './types'

export interface LoadedReview {
  row: ReviewRow
  content: ReviewContent
}

interface RawReview extends ReviewRow {
  ratings: { scale: Scale; value: number }[]
  counters: { counter: CounterKey; count: number }[]
  notes: { body: string } | { body: string }[] | null
}

function toContent(r: RawReview): ReviewContent {
  const c = emptyContent()
  c.overall_gleeks = r.overall_gleeks
  for (const x of r.ratings ?? []) c.ratings[x.scale] = x.value
  for (const x of r.counters ?? []) c.counters[x.counter] = x.count
  const n = Array.isArray(r.notes) ? r.notes[0] : r.notes
  c.notes = n?.body ?? ''
  return c
}

export async function fetchEpisodes(): Promise<Episode[]> {
  const { data, error } = await supabase
    .from('episodes').select('id, season, episode, title, verify_note')
    .order('season').order('episode')
  if (error) throw error
  return data as Episode[]
}

/** episode_id -> my review status. */
export async function fetchMyStatuses(uid: string): Promise<Map<number, 'draft' | 'submitted'>> {
  const { data, error } = await supabase.from('reviews').select('episode_id, status').eq('user_id', uid)
  if (error) throw error
  return new Map((data ?? []).map((r) => [r.episode_id as number, r.status as 'draft' | 'submitted']))
}

/**
 * Reviews of one episode that RLS lets me see: always mine; the partner's only after I've submitted mine.
 * (No client-side filtering for the reveal rule; the server simply doesn't return what I may not see.)
 */
export async function fetchEpisodeReviews(episodeId: number, uid: string) {
  const { data, error } = await supabase
    .from('reviews')
    .select('*, ratings(scale, value), counters(counter, count), notes(body)')
    .eq('episode_id', episodeId)
  if (error) throw error
  const rows = (data ?? []) as unknown as RawReview[]
  const mine = rows.find((r) => r.user_id === uid)
  const theirs = rows.find((r) => r.user_id !== uid)
  return {
    mine: mine ? ({ row: mine, content: toContent(mine) } satisfies LoadedReview) : null,
    theirs: theirs ? ({ row: theirs, content: toContent(theirs) } satisfies LoadedReview) : null,
  }
}

const payload = (c: ReviewContent) => ({
  overall_gleeks: c.overall_gleeks,
  notes: c.notes,
  ratings: c.ratings,
  counters: c.counters,
})

/** Postgres/PostgREST errors carry a code; network failures don't. Only the former are permanent. */
function classify(error: { message: string; code?: string }): Error {
  return error.code ? new PermanentSyncError(error.message) : new Error(error.message)
}

export async function saveDraft(episodeId: number, c: ReviewContent): Promise<void> {
  const { error } = await supabase.rpc('save_draft', { p_episode_id: episodeId, p_payload: payload(c) })
  if (error) throw classify(error)
}

export async function submitReview(episodeId: number, c: ReviewContent): Promise<void> {
  const { error } = await supabase.rpc('submit_review', { p_episode_id: episodeId, p_payload: payload(c) })
  if (error) throw classify(error)
}

export const isComplete = (c: ReviewContent) =>
  c.overall_gleeks != null && (['sue_c', 'schue_cringe', 'rachel_extra'] as Scale[]).every((s) => c.ratings[s] != null)
