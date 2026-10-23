@echo off
chcp 65001 >nul
title Project Karsa - Personal Agentic AI Companion

echo ===============================================================
echo   PROJECT KARSA: PERSONAL AGENTIC AI (STUDENT COMPANION)
echo ===============================================================
echo.

:: 1. Check Python Virtual Environment
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment .venv tidak ditemukan.
    echo Harap jalankan 'uv venv' dan install dependencies terlebih dahulu.
    pause
    exit /b 1
)

:: 2. Launch FastAPI Backend Gateway
echo [1/2] Menjalankan Karsa FastAPI Gateway (Port 8765)...
start "Karsa Backend Gateway" cmd /k ".venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8765"

:: 3. Launch Desktop Companion (Vite / Tauri UI)
echo [2/2] Menjalankan Karsa Desktop Notch Companion...
cd desktop-companion
start "Karsa Desktop Island" cmd /k "npm run dev"

echo.
echo ===============================================================
echo   Karsa Companion aktif di background!
echo   - Desktop Island Notch : http://localhost:5173
echo   - Backend REST & SSE   : http://127.0.0.1:8765
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    echo   - Akses HP (PWA Wi-Fi) : http://%%a:5173
    goto :done_ip
)
:done_ip
echo ===============================================================
