// Distinguishes the two ways this app runs:
//
//  - LOCAL  — served by `npm run dev` (or the bot's own server) on
//             localhost. The live-trading bot at http://localhost:3001 is
//             reachable, so the Live Trading panel is active.
//  - HOSTED — deployed to Vercel (garlic-trading.vercel.app) over HTTPS.
//             A browser will block HTTPS->http://localhost calls as mixed
//             content, so live trading is disabled and the panel explains why.
//
// Anything that talks to the local bot must be gated behind IS_LOCAL.

export const IS_LOCAL: boolean =
  typeof window !== 'undefined' &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname)

export const DEFAULT_BOT_URL = 'http://localhost:3001'
