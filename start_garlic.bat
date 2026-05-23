@echo off
title Garlic Trading — Launcher
echo ================================================
echo  Garlic Trading Bot + Cloudflare Tunnel
echo ================================================
echo.

:: ── 1. Bot server (new window, stays open) ──────────────────────────────────
echo [1/3] Starting bot server on port 3001...
start "Garlic Bot Server" cmd /k "cd /d "%~dp0bot" && npm.cmd run serve"

:: Give the server a moment to bind the port before the tunnel connects
timeout /t 3 /nobreak > nul

:: ── 2. Cloudflare tunnel (new window, stays open) ───────────────────────────
echo [2/3] Starting Cloudflare tunnel (trading-bot)...
start "Cloudflare Tunnel" cmd /k "cloudflared tunnel run trading-bot"

:: Give the tunnel a moment to establish
timeout /t 2 /nobreak > nul

:: ── 3. Open the live dashboard in browser ───────────────────────────────────
echo [3/3] Opening https://bot.garlic-trading.net ...
start https://bot.garlic-trading.net

echo.
echo Both windows are running. Close them to stop the bot and tunnel.
echo.
pause
