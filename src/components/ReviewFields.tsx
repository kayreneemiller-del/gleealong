import { COUNTERS, OVERALL, SCALES, type ReviewContent } from '../lib/types'
import RatingRow from './RatingRow'
import CounterTap from './CounterTap'

/** Notes + counters + ratings. Read-only when `onChange` is omitted. */
export default function ReviewFields({
  content, onChange,
}: { content: ReviewContent; onChange?: (c: ReviewContent) => void }) {
  const set = (patch: Partial<ReviewContent>) => onChange?.({ ...content, ...patch })
  return (
    <>
      <section>
        <h3>Live notes</h3>
        {onChange ? (
          <textarea
            rows={4} maxLength={10000} value={content.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Hot takes, quotes, Sue one-liners… (optional)"
          />
        ) : (
          <p className="notes-read">{content.notes || <em>No notes. A woman of few words.</em>}</p>
        )}
      </section>

      <section>
        <h3>Tally time</h3>
        <div className="counters">
          {COUNTERS.map(({ key, ...c }) => (
            <CounterTap
              key={key} {...c} count={content.counters[key]}
              onChange={onChange && ((n) => set({ counters: { ...content.counters, [key]: n } }))}
            />
          ))}
        </div>
      </section>

      <section>
        <h3>The verdict</h3>
        {SCALES.map(({ key, ...s }) => (
          <RatingRow
            key={key} {...s} value={content.ratings[key]}
            onChange={onChange && ((v) => set({ ratings: { ...content.ratings, [key]: v } }))}
          />
        ))}
        <RatingRow
          {...OVERALL} value={content.overall_gleeks}
          onChange={onChange && ((v) => set({ overall_gleeks: v }))}
        />
      </section>
    </>
  )
}
