@echo off
setlocal
cd /d "%~dp0"
title WhatsApp Campaign Studio

echo =======================================================
echo   WhatsApp Campaign Studio
echo =======================================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js was not found on your system!
    echo Please download and install Node.js version 18 or higher from:
    echo https://nodejs.org
    echo.
    pause
    exit /b
)

:: Check if server is already running on port 3000
powershell -NoProfile -Command "try { $r = [System.Net.WebRequest]::Create('http://localhost:3000'); $r.Timeout = 800; $res = $r.GetResponse(); exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel% equ 0 (
    echo [INFO] WhatsApp Campaign Studio is already running!
    echo Opening dashboard in your browser...
    echo.
    start "" "http://localhost:3000"
    powershell -NoProfile -Command "Start-Sleep -Seconds 1" >nul 2>nul
    exit /b
)

:: Install dependencies if node_modules does not exist
if not exist "node_modules\" (
    echo [INFO] First-time setup: Installing required dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] npm install encountered an issue. Please run 'npm install' manually.
        pause
        exit /b
    )
)

echo [INFO] Starting WhatsApp Campaign Studio...
echo.
echo =======================================================
echo   Server running on: http://localhost:3000
echo   Opening WhatsApp Campaign Studio in your browser...
echo =======================================================
echo.

:: Automatically open browser after 2 seconds
start "" powershell -NoProfile -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"

node server.js
pause
