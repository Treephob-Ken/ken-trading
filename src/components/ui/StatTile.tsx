import InfoTip from '@/components/InfoTip'

export type Tone = 'gain' | 'loss' | 'warn' | 'neutral' | 'brand'

interface Bar {
  /** 0–100 percentage */
  fill: number
  tone: Tone
}

interface Props {
  /** Question-style title that tells the user what the stat answers. */
  question: string
  /** Either a glossary key or raw tooltip text. */
  info: string
  value: string
  tone?: Tone
  sub?: string
  bar?: Bar
  /** Compact = smaller padding, smaller value. For ConfidenceStrip etc. */
  compact?: boolean
}

const TONE_TEXT: Record<Tone, string> = {
  gain: 'text-gain',
  loss: 'text-loss',
  warn: 'text-warn',
  neutral: 'text-text',
  brand: 'text-brand',
}
const TONE_BAR: Record<Tone, string> = {
  gain: 'bg-gain',
  loss: 'bg-loss',
  warn: 'bg-warn',
  neutral: 'bg-muted',
  brand: 'bg-brand',
}

export default function StatTile({
  question,
  info,
  value,
  tone = 'neutral',
  sub,
  bar,
  compact = false,
}: Props) {
  return (
    <div className={`rounded-lg border border-border bg-panel-2 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}>
      <div className="flex items-center text-[11px] font-medium uppercase tracking-wider text-dim font-display">
        <span className="truncate">{question}</span>
        <InfoTip term={info} />
      </div>
      <div
        className={`mt-1 font-mono font-bold tabular-nums ${TONE_TEXT[tone]} ${compact ? 'text-base' : 'text-xl'}`}
      >
        {value}
      </div>
      {bar && (
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div
            className={`h-full rounded-full transition-all duration-500 ${TONE_BAR[bar.tone]}`}
            style={{ width: `${Math.min(100, Math.max(0, bar.fill))}%` }}
          />
        </div>
      )}
      {sub && <div className="mt-1 text-[11px] text-dim leading-snug">{sub}</div>}
    </div>
  )
}
