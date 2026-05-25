import { useEffect, useRef, useState } from 'react'
import { getJwt } from '@/contexts/AuthContext'

// Live SSE stream of every bot's log lines. Lifted from the previous LogsPage
// implementation — preserved as the "Events" tab so debugging behavior the user
// already relies on doesn't change.

interface LogLine {
  ts: string
  level: string
  msg: string
  botId?: string
}

const MAX_LINES = 2000

function levelCls(level: string) {
  if (level === 'ok' || level === 'fill') return 'text-gain'
  if (level === 'err') return 'text-loss'
  if (level === 'warn') return 'text-warn'
  return 'text-text'
}

export default function EventsStream() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [connected, setConnected] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const jwt = getJwt()
    const url = `/api/logs/stream${jwt ? `?token=${encodeURIComponent(jwt)}` : ''}`
    const es = new EventSource(url)
    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)
    es.onmessage = (ev) => {
      try {
        const line: LogLine = JSON.parse(ev.data as string)
        setLines((prev) => {
          const next = [...prev, line]
          return next.length > MAX_LINES ? next.slice(-MAX_LINES) : next
        })
      } catch { /* malformed line */ }
    }
    return () => es.close()
  }, [])

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

  return (
    <div className="flex h-[60vh] min-h-0 flex-col rounded-2xl border border-border bg-bg overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-panel/60 px-3 py-2">
        <span className={`flex items-center gap-1.5 text-[11px] ${connected ? 'text-gain' : 'text-dim'}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-gain animate-pulse' : 'bg-border'}`} />
          {connected ? 'Live' : 'Connecting…'}
        </span>
        <span className="font-mono text-[11px] tabular-nums text-dim">{lines.length} lines</span>
      </div>
      <div
        ref={boxRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <p className="py-8 text-center text-dim">
            {connected ? 'Waiting for log lines…' : 'Connecting to log stream…'}
          </p>
        ) : (
          lines.map((l, i) => (
            <div key={i} className="mb-0.5 break-words">
              <span className="select-none text-dim">[{l.ts.slice(11, 19)}]</span>
              {l.botId && l.botId !== '_server' && (
                <span className="ml-1 text-brand/70">[{l.botId.slice(0, 8)}]</span>
              )}{' '}
              <span className={levelCls(l.level)}>{l.msg}</span>
            </div>
          ))
        )}
      </div>
      {!autoScroll && (
        <div className="border-t border-border px-4 py-2 text-right">
          <button
            type="button"
            onClick={() => {
              setAutoScroll(true)
              const box = boxRef.current
              if (box) box.scrollTop = box.scrollHeight
            }}
            className="rounded-lg border border-brand/20 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand hover:bg-brand/15"
          >
            ↓ Latest
          </button>
        </div>
      )}
    </div>
  )
}
