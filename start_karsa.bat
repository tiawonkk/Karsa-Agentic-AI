@echo off
chcp 65001 >nul
title Karsa (production)
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] .venv tidak ditemukan. Jalankan: uv venv ^&^& uv pip install -e ".[dev,providers,tools]"
    pause & exit /b 1
)
if not exist "desktop-companion\dist\index.html" (
    echo [1/2] Membangun UI ^(sekali saja^)...
    pushd desktop-companion
    call npm install && call npm run build
    popd
    if not exist "desktop-companion\dist\index.html" ( echo [ERROR] Build UI gagal. & pause & exit /b 1 )
)

echo [2/2] Menjalankan Karsa di http://127.0.0.1:8765  ^(backend + UI satu proses^)
set KARSA_BIND=127.0.0.1
if "%KARSA_LAN%"=="1" (
    set KARSA_BIND=0.0.0.0
    echo       AKSES LAN AKTIF: API tidak punya login, pakai hanya di Wi-Fi tepercaya.
    for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do ( echo       HP satu Wi-Fi: http://%%a:8765 & goto :go )
)
:go
start "" http://127.0.0.1:8765
".venv\Scripts\python.exe" -m uvicorn backend.api.main:app --host %KARSA_BIND% --port 8765
