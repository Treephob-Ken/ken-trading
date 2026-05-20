type LogLine = { ts: string; level: string; msg: string }
type LogListener = (line: LogLine) => void

const buffer: LogLine[] = []
const listeners = new Set<LogListener>()
const MAX_BUFFER = 500

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

function emit(level: string, msg: string): void {
  const line: LogLine = { ts: ts(), level, msg }
  buffer.push(line)
  if (buffer.length > MAX_BUFFER) buffer.shift()
  for (const fn of listeners) fn(line)
}

export function getLogBuffer(): LogLine[] {
  return [...buffer]
}

export function onLog(fn: LogListener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const log = {
  info: (msg: string) => { console.log(`[${ts()}] · ${msg}`); emit('info', msg) },
  ok:   (msg: string) => { console.log(`[${ts()}] OK ${msg}`); emit('ok', msg) },
  warn: (msg: string) => { console.log(`[${ts()}] ! ${msg}`); emit('warn', msg) },
  err:  (msg: string) => { console.error(`[${ts()}] X ${msg}`); emit('err', msg) },
  fill: (msg: string) => { console.log(`[${ts()}] >> ${msg}`); emit('fill', msg) },
}
