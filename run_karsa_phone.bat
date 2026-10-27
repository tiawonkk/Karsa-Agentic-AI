@echo off
chcp 65001 >nul
title Project Karsa - Mode HP (Wi-Fi)

echo ===============================================================
echo   KARSA MODE HP: backend dibuka ke jaringan Wi-Fi/LAN
echo   Hanya perangkat yang memindai kode QR (Settings ^> HP) yang bisa masuk.
echo ===============================================================
echo.

if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment .venv tidak ditemukan.
    pause
    exit /b 1
)

:: Windows akan menanyakan izin firewall untuk Python saat pertama kali: pilih "Jaringan pribadi".
if not exist "desktop-companion\dist\m.html" (
    echo Membangun antarmuka... 
    pushd desktop-companion
    call npm run build
    popd
)

echo Karsa dijalankan di http://0.0.0.0:8765 (desktop: http://localhost:8765)
.venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 0.0.0.0 --port 8765
