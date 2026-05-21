@echo off
title Crypto Strategy Lab Website
echo ===================================================
echo Starting Crypto Strategy Lab Website...
echo ===================================================
echo.

:: Open http://localhost:5173 in default browser
echo Opening http://localhost:5173 in your browser...
start http://localhost:5173

:: Run the Vite dev server using the npm.cmd wrapper
call npm.cmd run dev

pause
