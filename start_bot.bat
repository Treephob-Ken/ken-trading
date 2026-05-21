@echo off
title Hyperliquid Grid Bot Dashboard
echo ===================================================
echo Starting Hyperliquid Grid Bot Dashboard...
echo ===================================================
echo.

:: Change to the bot directory
cd /d "%~dp0bot"

:: Launch the bot dashboard in the default browser
echo Opening http://localhost:3001 in your browser...
start http://localhost:3001

:: Run the Express dashboard server using the npm.cmd wrapper
call npm.cmd run serve

pause
