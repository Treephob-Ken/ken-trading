function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19)
}

export const log = {
  info: (msg: string, ...args: unknown[]) =>
    console.log(`[${ts()}] · ${msg}`, ...args),
  ok: (msg: string, ...args: unknown[]) =>
    console.log(`[${ts()}] OK ${msg}`, ...args),
  warn: (msg: string, ...args: unknown[]) =>
    console.log(`[${ts()}] ! ${msg}`, ...args),
  err: (msg: string, ...args: unknown[]) =>
    console.error(`[${ts()}] X ${msg}`, ...args),
  fill: (msg: string, ...args: unknown[]) =>
    console.log(`[${ts()}] >> ${msg}`, ...args),
}
