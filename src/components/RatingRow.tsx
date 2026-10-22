interface Props {
  label: string
  blurb: string
  low: string
  high: string
  value: number | null | undefined
  onChange?: (v: number) => void
}

export default function RatingRow({ label, blurb, low, high, value, onChange }: Props) {
  return (
    <fieldset className="rating" disabled={!onChange}>
      <legend>{label}</legend>
      <p className="blurb">{blurb}</p>
      <div className="pips" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n} type="button" role="radio" aria-checked={value === n}
            className={value != null && n <= value ? 'pip on' : 'pip'}
            onClick={() => onChange?.(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <div className="ends"><span>{low}</span><span>{high}</span></div>
    </fieldset>
  )
}
