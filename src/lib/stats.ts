import { supabase } from './supabase'
import type { CounterKey } from './types'

export interface PickedEpisode {
  episode_id: number
  season: number
  episode: number
  title: string
  overall_gleeks: number
}

export interface SeasonStats {
  episodes_counted: number
  averages: Record<'sue_c' | 'schue_cringe' | 'rachel_extra' | 'overall_gleeks', number | null>
  favorite: PickedEpisode | null
  worst: PickedEpisode | null
  counters: Record<CounterKey, number>
}

export interface Disagreement {
  episode_id: number
  season: number
  episode: number
  title: string
  score: number
  scales: Record<'sue_c' | 'schue_cringe' | 'rachel_extra' | 'overall_gleeks', { mine: number; theirs: number }>
}

export async function fetchSeasonStats(subject: string, season: number | null): Promise<SeasonStats> {
  const { data, error } = await supabase.rpc('season_stats', { p_subject: subject, p_season: season })
  if (error) throw new Error(error.message)
  return data as SeasonStats
}

export async function fetchDisagreements(partner: string, season: number | null): Promise<Disagreement[]> {
  const { data, error } = await supabase.rpc('biggest_disagreements', { p_partner: partner, p_limit: 5, p_season: season })
  if (error) throw new Error(error.message)
  return (data ?? []).map((d: Disagreement) => ({ ...d, score: Number(d.score) }))
}

type ScaleKey = 'sue_c' | 'schue_cringe' | 'rachel_extra' | 'overall_gleeks'

export interface SeasonProgress {
  season: number
  members: number
  total_episodes: number
  done_by_all: number
  unlocked: boolean
}

export interface CollectiveDisagreement {
  episode_id: number
  season: number
  episode: number
  title: string
  spread: number
  ranges: Record<ScaleKey, { min: number; max: number }>
  by_member: { name: string; overall_gleeks: number }[]
}

export interface CollectiveStats {
  season: number
  members: number
  episodes_counted: number
  averages: Record<ScaleKey, number | null>
  per_member: { user_id: string; display_name: string; averages: Record<ScaleKey, number | null> }[]
  favorite: { episode_id: number; season: number; episode: number; title: string; avg_overall: number } | null
  worst: { episode_id: number; season: number; episode: number; title: string; avg_overall: number } | null
  counters: Record<CounterKey, number>
  disagreements: CollectiveDisagreement[]
}

export async function fetchSeasonProgress(season: number): Promise<SeasonProgress> {
  const { data, error } = await supabase.rpc('season_progress', { p_season: season })
  if (error) throw new Error(error.message)
  return data as SeasonProgress
}

export async function fetchCollectiveStats(season: number): Promise<CollectiveStats> {
  const { data, error } = await supabase.rpc('collective_stats', { p_season: season })
  if (error) throw new Error(error.message)
  return data as CollectiveStats
}
