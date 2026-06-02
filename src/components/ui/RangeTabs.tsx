// One consistent segmented range/period selector used across analytics pages.
export default function RangeTabs<T extends string>({ value, options, onChange, className = '' }: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <div className={`flex items-center gap-1 ${className}`}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          aria-pressed={o.id === value}
          className={`rounded-md border px-2 py-1 text-[11px] cursor-pointer transition-colors ${
            o.id === value
              ? 'border-brand bg-brand/10 text-brand'
              : 'border-border bg-panel-2 text-dim hover:text-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
