# Project Karsa: One-Click PowerShell Launcher
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  PROJECT KARSA: PERSONAL AGENTIC AI (STUDENT COMPANION)" -ForegroundColor Cyan
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host ""

$root = $PSScriptRoot
if (-not (Test-Path "$root\.venv\Scripts\python.exe")) {
    Write-Host "[ERROR] Virtual environment .venv tidak ditemukan di $root" -ForegroundColor Red
    exit 1
}

Write-Host "[1/2] Menjalankan Karsa FastAPI Gateway (Port 8765)..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; .venv\Scripts\python.exe -m uvicorn backend.api.main:app --host 127.0.0.1 --port 8765"

Write-Host "[2/2] Menjalankan Karsa Desktop Notch Companion..." -ForegroundColor Green
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\desktop-companion'; npm run dev"

Write-Host ""
Write-Host "===============================================================" -ForegroundColor Cyan
Write-Host "  Karsa Companion aktif di background!" -ForegroundColor Yellow
Write-Host "  - Desktop Island Notch : http://localhost:5173" -ForegroundColor White
Write-Host "  - Backend REST & SSE   : http://127.0.0.1:8765" -ForegroundColor White
try {
    $localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254*" } | Select-Object -First 1).IPAddress
    if ($localIp) {
        Write-Host "  - Akses HP (PWA Wi-Fi) : http://$($localIp):5173" -ForegroundColor Green
    }
} catch {}
Write-Host "===============================================================" -ForegroundColor Cyan
