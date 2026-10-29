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

/** Everyone I can currently see for an episode, besides me. */
export type PartnerReview = LoadedReview & { userId: string }

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
 * Reviews of one episode that RLS lets me see: always mine; each partner's only after I've submitted mine
 * (and they've submitted theirs). Partners are independent: one may be revealed while another is not.
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
  const others = rows
    .filter((r) => r.user_id !== uid)
    .map((r) => ({ userId: r.user_id, row: r, content: toContent(r) }) satisfies PartnerReview)
  return {
    mine: mine ? ({ row: mine, content: toContent(mine) } satisfies LoadedReview) : null,
    others,
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
