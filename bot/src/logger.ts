// Per-bot scoped logger.
//
// Every log line carries a botId so the dashboard can filter / route
// events to the right bot. The special botId "_server" is used for
// non-bot events like server boot.

export type LogLine = { ts: string; level: string; msg: string; botId: string }
export type LogListener = (line: LogLine) => void

const buffers: Map<string, LogLine[]> = new Map()
const listeners = new Set<LogListener>()
const MAX_BUFFER = 500

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function emit(botId: string, level: string, msg: string): void {
  const line: LogLine = { ts: ts(), level, msg, botId }
  let buf = buffers.get(botId)
  if (!buf) {
    buf = []
    buffers.set(botId, buf)
  }
  buf.push(line)
  if (buf.length > MAX_BUFFER) buf.shift()
  for (const fn of listeners) fn(line)
}

export function getLogBuffer(botId: string): LogLine[] {
  return [...(buffers.get(botId) ?? [])]
}

export function clearLogBuffer(botId: string): void {
  buffers.delete(botId)
}

export function onLog(fn: LogListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export interface Logger {
  info: (msg: string) => void
  ok: (msg: string) => void
  warn: (msg: string) => void
  err: (msg: string) => void
  fill: (msg: string) => void
}

export function createLogger(botId: string): Logger {
  const tag = botId === '_server' ? '' : ` [${botId}]`
  return {
    info: (msg) => { console.log(`[${ts()}]${tag} · ${msg}`); emit(botId, 'info', msg) },
    ok:   (msg) => { console.log(`[${ts()}]${tag} OK ${msg}`); emit(botId, 'ok', msg) },
    warn: (msg) => { console.log(`[${ts()}]${tag} ! ${msg}`); emit(botId, 'warn', msg) },
    err:  (msg) => { console.error(`[${ts()}]${tag} X ${msg}`); emit(botId, 'err', msg) },
    fill: (msg) => { console.log(`[${ts()}]${tag} >> ${msg}`); emit(botId, 'fill', msg) },
  }
}

// Server-scope logger for boot/config events.
export const log = createLogger('_server')
