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

export async function fetchDisagreements(season: number | null): Promise<Disagreement[]> {
  const { data, error } = await supabase.rpc('biggest_disagreements', { p_limit: 5, p_season: season })
  if (error) throw new Error(error.message)
  return (data ?? []).map((d: Disagreement) => ({ ...d, score: Number(d.score) }))
}
