# Future Plan

## Direct API Trigger: Website → Bot

Currently the website exports a JSON file that you manually drop into the bot dashboard. A future upgrade would add a **"Deploy & Start" button** directly in the Grid Optimizer that:

1. Calls `POST http://localhost:3001/api/bots` with the grid config JSON
2. Then calls `POST http://localhost:3001/api/bots/:id/start` to launch the bot
3. Shows a live status badge on the website confirming the bot is running
4. Optional: WebSocket connection from website → bot for real-time P&L updates

### Requirements
- Bot dashboard must be running on `localhost:3001`
- CORS headers on the bot server to allow requests from `garlic-trading.vercel.app`
- Fallback: if bot is unreachable, show "Bot offline — download JSON instead"
- Security: only allow from localhost or whitelisted origins

### Files to change
- `bot/src/server.ts` — add CORS middleware
- `src/pages/GridPage.tsx` — add "Deploy & Start" button next to the existing download button
- New `src/lib/botApi.ts` — fetch wrapper for bot REST endpoints
