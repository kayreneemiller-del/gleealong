export type Scale = 'sue_c' | 'schue_cringe' | 'rachel_extra'
export type CounterKey =
  | 'schue_creep'
  | 'schue_rap'
  | 'rachel_cries'
  | 'brittana'
  | 'sue_nicknames'

export interface Pair {
  id: string
  invite_code: string
}

export interface Member {
  id: string
  pair_id: string
  display_name: string
}

export interface Episode {
  id: number
  season: number
  episode: number
  title: string
  verify_note: string | null
}

export type ReviewStatus = 'draft' | 'submitted'

export interface ReviewRow {
  id: string
  user_id: string
  episode_id: number
  status: ReviewStatus
  overall_gleeks: number | null
  submitted_at: string | null
  updated_at: string
}

/** One person's review as the UI edits/displays it. */
export interface ReviewContent {
  notes: string
  overall_gleeks: number | null
  ratings: Partial<Record<Scale, number>>
  counters: Record<CounterKey, number>
}

export const SCALES: { key: Scale; label: string; blurb: string; low: string; high: string }[] = [
  { key: 'sue_c', label: "Sue C's", blurb: 'How villainous was Sue?', low: 'Mildly rude', high: 'Full cartoon menace' },
  { key: 'schue_cringe', label: 'Schue Cringe', blurb: 'Second-hand embarrassment from Mr. Schue', low: 'Tolerable', high: 'Hide behind the couch' },
  { key: 'rachel_extra', label: 'Rachel Berry Extra-ness', blurb: 'How extra was our Broadway baby?', low: 'Understated (?!)', high: 'Gold star, maximum' },
]

export const OVERALL = {
  key: 'overall_gleeks' as const,
  label: 'Overall Gleeks',
  blurb: 'The vibes, the songs, the whole thing',
  low: 'Slushie to the face',
  high: 'Standing ovation',
}

export const COUNTERS: { key: CounterKey; label: string; emoji: string; tap: string }[] = [
  { key: 'schue_creep', label: 'Schue creep moments', emoji: '😬', tap: 'Ew.' },
  { key: 'schue_rap', label: 'Schue bad raps', emoji: '🎤', tap: 'Sit down, Will.' },
  { key: 'rachel_cries', label: 'Rachel cries', emoji: '😭', tap: 'Waterworks!' },
  { key: 'brittana', label: 'Brittana moments', emoji: '💛', tap: 'Iconic.' },
  { key: 'sue_nicknames', label: 'Sue nicknames', emoji: '🏷️', tap: 'Porcelain!' },
]

export const emptyContent = (): ReviewContent => ({
  notes: '',
  overall_gleeks: null,
  ratings: {},
  counters: { schue_creep: 0, schue_rap: 0, rachel_cries: 0, brittana: 0, sue_nicknames: 0 },
})
