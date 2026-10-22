interface Props {
  label: string
  emoji: string
  tap: string
  count: number
  onChange?: (n: number) => void
}

export default function CounterTap({ label, emoji, tap, count, onChange }: Props) {
  return (
    <div className="counter">
      <button
        type="button" className="counter-main" disabled={!onChange}
        onClick={() => onChange?.(Math.min(999, count + 1))}
        aria-label={`${label}: ${count}. Tap to add one`}
      >
        <span className="emoji">{emoji}</span>
        <span className="c-label">{label}</span>
        <span className="c-tap">{tap}</span>
        <span className="c-count">{count}</span>
      </button>
      {onChange && (
        <button type="button" className="counter-undo" disabled={count === 0} onClick={() => onChange(count - 1)} aria-label={`Remove one from ${label}`}>
          −
        </button>
      )}
    </div>
  )
}
