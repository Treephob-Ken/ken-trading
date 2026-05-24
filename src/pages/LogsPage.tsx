import { useEffect, useRef, useState } from 'react'
import { getJwt } from '@/contexts/AuthContext'

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogLine {
  ts: string; level: string; msg: string; botId?: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_LINES = 2000
const LEVEL_FILTERS: { label: string; filter: string }[] = [
  { label: 'All', filter: 'all' },
  { label: 'Fills', filter: 'fill' },
  { label: 'Issues', filter: 'warn err' },
  { label: 'Info', filter: 'info ok' },
]

function levelCls(level: string) {
  if (level === 'ok' || level === 'fill') return 'text-gain'
  if (level === 'err') return 'text-loss'
  if (level === 'warn') return 'text-warn'
  return 'text-text'
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [levelFilter, setLevelFilter] = useState('all')
  const [botFilter, setBotFilter] = useState('all')
  const [botIds, setBotIds] = useState<string[]>([])
  const [connected, setConnected] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)

  // ── SSE connection ───────────────────────────────────────────────────────────

  useEffect(() => {
    const jwt = getJwt()
    // EventSource can't send headers — pass token as query param
    const url = `/api/logs/stream${jwt ? `?token=${encodeURIComponent(jwt)}` : ''}`
    const es = new EventSource(url)

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    es.onmessage = (ev) => {
      try {
        const line: LogLine = JSON.parse(ev.data as string)
        setLines(prev => {
          const next = [...prev, line]
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
        })
        if (line.botId && line.botId !== '_server') {
          setBotIds(prev => prev.includes(line.botId!) ? prev : [...prev, line.botId!])
        }
      } catch { /* malformed line */ }
    }

    return () => es.close()
  }, [])

  // ── Auto-scroll ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!autoScroll) return
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [lines, autoScroll])

  const handleScroll = () => {
    const box = boxRef.current
    if (!box) return
    const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 20
    setAutoScroll(atBottom)
  }

  // ── Filtered lines ───────────────────────────────────────────────────────────

  const filtered = lines.filter(l => {
    const levelMatch = levelFilter === 'all' || levelFilter.split(' ').includes(l.level)
    const botMatch = botFilter === 'all' || l.botId === botFilter || (!l.botId && botFilter === '_server')
    return levelMatch && botMatch
  })

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-5 gap-4">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="text-sm font-semibold text-text">Trade Log</h1>
            <p className="text-[11px] text-dim">All bot activity — live stream</p>
          </div>
          <span className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${
            connected
              ? 'border-gain/30 bg-gain/10 text-gain'
              : 'border-border bg-panel text-dim'
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-gain animate-pulse' : 'bg-border'}`} />
            {connected ? 'Live' : 'Connecting…'}
          </span>
          <span className="font-mono text-xs text-dim tabular-nums">{lines.length} lines</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Level filters */}
          <div className="flex items-center rounded-xl border border-border bg-panel-2 p-0.5">
            {LEVEL_FILTERS.map(f => (
              <button
                key={f.filter}
                type="button"
                onClick={() => setLevelFilter(f.filter)}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  levelFilter === f.filter
                    ? 'bg-brand text-white'
                    : 'text-dim hover:text-text'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Bot filter */}
          {botIds.length > 0 && (
            <div className="flex items-center rounded-xl border border-border bg-panel-2 p-0.5">
              <button
                type="button"
                onClick={() => setBotFilter('all')}
                className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                  botFilter === 'all' ? 'bg-brand text-white' : 'text-dim hover:text-text'
                }`}
              >
                All Bots
              </button>
              {botIds.map(id => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBotFilter(id)}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors ${
                    botFilter === id ? 'bg-brand text-white' : 'text-dim hover:text-text'
                  }`}
                >
                  {id.length > 8 ? id.slice(0, 8) + '…' : id}
                </button>
              ))}
            </div>
          )}

          {/* Clear */}
          <button
            type="button"
            onClick={() => { setLines([]); setBotIds([]) }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-dim hover:text-text transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log box */}
      <div className="flex flex-1 min-h-0 flex-col rounded-2xl border border-border bg-bg overflow-hidden">
        <div
          ref={boxRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed"
        >
          {filtered.length === 0 ? (
            <p className="text-dim text-center py-8">
              {connected ? 'Waiting for log lines…' : 'Connecting to log stream…'}
            </p>
          ) : (
            filtered.map((l, i) => (
              <div key={i} className="mb-0.5 break-words">
                <span className="text-dim select-none">[{l.ts.slice(11, 19)}]</span>
                {l.botId && l.botId !== '_server' && (
                  <span className="ml-1 text-brand/70">[{l.botId.slice(0, 8)}]</span>
                )}
                {' '}
                <span className={levelCls(l.level)}>{l.msg}</span>
              </div>
            ))
          )}
        </div>

        {/* Jump to bottom */}
        {!autoScroll && (
          <div className="border-t border-border px-4 py-2 text-right">
            <button
              type="button"
              onClick={() => {
                setAutoScroll(true)
                const box = boxRef.current
                if (box) box.scrollTop = box.scrollHeight
              }}
              className="rounded-lg bg-brand/10 border border-brand/20 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/15 transition-colors"
            >
              ↓ Latest
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
