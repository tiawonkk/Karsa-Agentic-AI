#!/usr/bin/env bash
# Production launcher: builds the UI once, then serves backend + UI from one process on :8765.
set -e
cd "$(dirname "$0")"
PY=".venv/bin/python"; [ -x "$PY" ] || PY=".venv/Scripts/python.exe"
[ -x "$PY" ] || { echo "[ERROR] .venv tidak ditemukan (uv venv && uv pip install -e '.[dev,providers,tools]')"; exit 1; }
if [ ! -f desktop-companion/dist/index.html ]; then
  (cd desktop-companion && npm install && npm run build)
fi
BIND=127.0.0.1
[ "$KARSA_LAN" = "1" ] && { BIND=0.0.0.0; echo "AKSES LAN AKTIF: API tidak punya login, pakai hanya di Wi-Fi tepercaya."; }
echo "Karsa: http://127.0.0.1:8765"
exec "$PY" -m uvicorn backend.api.main:app --host "$BIND" --port 8765
