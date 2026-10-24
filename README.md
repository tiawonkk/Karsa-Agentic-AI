# Project Karsa

Pendamping AI agentik pribadi untuk mahasiswa Indonesia: pulau notch di tepi atas layar, dock widget di kanan (Pomodoro, Air, Todo, Finance, Media, Chat, Notebook, Approvals), dan backend FastAPI + LangGraph yang berjalan sepenuhnya lokal (SQLite). Prinsip: deterministik dulu, hemat token, tanpa data dummy, aksi berisiko selalu menunggu persetujuan manusia.

Spesifikasi lengkap ada di [`docs/`](docs/). Status terkini dan log keputusan: [`docs/00_PROJECT_MEMORY.md`](docs/00_PROJECT_MEMORY.md).

## Prasyarat

- Python 3.11+ dan [uv](https://docs.astral.sh/uv/)
- Node.js 20+
- (opsional) Ollama untuk model lokal; kunci API Gemini/DeepSeek bisa dipasang dari Settings di aplikasi

## Instalasi

```bash
uv venv
uv pip install -e ".[dev,providers,tools]"
cp .env.example .env        # lalu isi kunci API, atau pasang dari menu Settings
cd desktop-companion && npm install && cd ..
```

Data pengguna disimpan di luar repo: `~/.karsa/` (database, hasil dokumen, unggahan). Ubah lokasinya dengan `KARSA_DATA_DIR`.

## Menjalankan (produksi, satu perintah)

Windows:

```bat
start_karsa.bat
```

macOS/Linux/Git Bash:

```bash
./start_karsa.sh
```

Skrip membangun UI sekali (jika `desktop-companion/dist` belum ada), lalu menjalankan backend dan UI dalam **satu proses** di <http://127.0.0.1:8765>. UI juga bisa dipasang sebagai PWA di browser.

Akses dari HP di Wi-Fi yang sama bersifat opt-in, karena API tidak memakai login:

```bat
set KARSA_LAN=1 && start_karsa.bat
```

## Pengembangan

```bash
run_karsa.bat                                   # backend :8765 + Vite :5173 (hot reload)
.venv/Scripts/python.exe -m pytest -q           # tes backend (~3 menit)
cd desktop-companion && npm run build           # type-check + build UI
```

## Membungkus dengan Tauri (belum terverifikasi)

`desktop-companion/src-tauri/` saat ini hanya berisi `tauri.conf.json`; belum ada sumber Rust (`Cargo.toml`, `src/main.rs`) atau `@tauri-apps/cli`, sehingga `npm run tauri build` **belum bisa dijalankan** dan belum diuji. Langkah yang dibutuhkan: pasang Rust, jalankan `npm i -D @tauri-apps/cli && npx tauri init`, arahkan `frontendDist` ke `../dist`, lalu daftarkan backend sebagai sidecar. Sampai itu selesai, gunakan mode PWA/browser di atas.

## Keamanan

- `.env` tidak ikut git; `.env.example` hanya berisi placeholder.
- Aksi berisiko (timpa dokumen, ubah pagu, perintah shell) berhenti di gerbang persetujuan; lihat widget **Approvals** (Alt+8).
- Jangan buka `KARSA_LAN=1` di jaringan publik.
