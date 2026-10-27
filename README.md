# Karsa: Personal Agentic AI Companion

Pendamping AI agentik pribadi untuk mahasiswa Indonesia. Karsa hidup sebagai **Dynamic Island** di tepi atas layar (modul harian) dan **panel AI** di sisi kanan (chat + otomasi), didukung backend FastAPI + LangGraph yang berjalan lokal dengan SQLite.

Prinsip utama:

- **Deterministik dulu.** Parsing, hitungan, dan kompilasi file dikerjakan Python; LLM hanya dipakai bila perlu (hemat token).
- **Tanpa data dummy.** UI menampilkan data nyata atau keadaan kosong yang jujur.
- **Manusia tetap memegang kendali.** Aksi berisiko (menimpa dokumen, menulis kode, menjalankan perintah) berhenti di gerbang persetujuan (HITL).
- **Privasi.** Tidak ada perekaman layar tersembunyi; data tersimpan di komputermu (`~/.karsa/`).

## Fitur

### Dynamic Island (modul harian)
Lima slide yang bisa digeser (panah, tombol keyboard, atau titik): **Pomodoro**, **Musik** (judul, kontrol, lirik sinkron), **Minum Air**, **Todo Cepat**, dan **Clip Sementara** (laci file). Setiap slide bisa ditarik keluar sebagai widget mengambang berukuran S / M / L lewat tombol **Widget**; modul yang sudah jadi widget tidak ditampilkan dobel di Island.

### Panel AI di kanan (Agentic)
Chat dengan Karsa, banner persetujuan, dan kartu otomasi:

| Otomasi | Fungsi |
|---|---|
| Finance & Laporan | Catat uang ("makan 25rb"), berita finance, laporan bulanan |
| PRD-to-App | Unggah PRD, Karsa menyusun rencana, kamu setujui, lalu kode dibangun dan diuji |
| Data CSV/XLSX | Unggah dataset, lihat profil nyata, bersihkan, ekspor siap-latih ML |
| Deep Research | Jurnal arXiv/Crossref + matriks perbandingan (hasil nyata, bukan karangan) |
| Artikel Ilmiah | Draf IMRaD dari sumbermu, ekspor .docx |
| Personal Brain | Notebook: tanya bersitasi, rangkuman, kuis |
| Project Hub | Nama proyek, sumber data, nilai kebaruan |
| Business Builder | Ide jadi modal, RAB, HPP, BEP, ROI |

**Full App Mode** (`Alt+Shift+K`) membuka semua otomasi dalam jendela besar.

### Lainnya
- **Folder project**: pilih folder lewat dialog Windows; hasil (dataset bersih, paper .docx, build PRD) disimpan di sana.
- **Karsa si maskot**: bola bercahaya dengan mata; mood mengikuti aktivitas AI, bisa didandani di Wardrobe. `Alt+K` memunculkan Karsa besar yang bisa bicara.
- **Hari Ini**: ringkasan harian dan maksimal 3 pengingat berbasis data nyata.
- **HP (PWA)**: akses dari ponsel lewat QR di Settings > HP.
- **Shell desktop Tauri v2**: jendela transparan, click-through, hotkey global, tray (lihat bagian Tauri).

## Arsitektur singkat

```
UI React/Vite (desktop-companion/)  ->  FastAPI gateway (backend/api/main.py)
                                          -> Supervisor LangGraph (Directive -> regex -> LLM triage)
                                          -> Modul spesialis (finance, study, research, writer, code)
                                          -> Gerbang HITL  -> SQLite (~/.karsa/)
```

Routing LLM (`backend/core/llm_router.py`) memilih model per keperluan dengan failover: provider gratis lebih dulu, lalu Ollama lokal sebagai cadangan. Spesifikasi lengkap ada di [`docs/`](docs/); status dan log keputusan di [`docs/00_PROJECT_MEMORY.md`](docs/00_PROJECT_MEMORY.md).

## Prasyarat

- Python 3.11+ dan [uv](https://docs.astral.sh/uv/)
- Node.js 20+
- Windows disarankan (kontrol volume/brightness, media, dialog folder memakai API Windows)
- Opsional: [Ollama](https://ollama.com) untuk model lokal. Kunci API Gemini/DeepSeek bisa dipasang dari Settings.

## Instalasi

```bash
uv venv
uv pip install -e ".[dev,providers,tools]"
cp .env.example .env        # lalu isi kunci API, atau pasang dari menu Settings
cd desktop-companion && npm install && cd ..
```

Kunci API gratis Gemini: <https://aistudio.google.com/apikey>. Data pengguna disimpan di `~/.karsa/` (ubah dengan `KARSA_DATA_DIR`).

## Cara memakai

### Menjalankan

Satu perintah (backend + UI di satu proses, <http://127.0.0.1:8765>):

```bat
start_karsa.bat
```

macOS/Linux/Git Bash: `./start_karsa.sh`. Mode pengembangan (hot reload, UI di <http://localhost:5173>):

```bat
run_karsa.bat
```

### Alur harian

1. **Buka Island**: klik notch di atas layar. Geser antar modul dengan panah (muncul saat kursor di atas kartu) atau tombol kiri/kanan. Klik judul untuk mengecilkannya.
2. **Chat**: di panel kanan, ketik biasa (mis. "catat makan siang 25rb") atau pakai direktif `@Money`, `@Todo`, `@Search`, `@Write`, `@Data`, `@Code`, `@Screen`.
3. **Pilih folder project**: di kartu otomasi mana pun, tekan *Pilih folder* agar hasil langsung tersimpan di sana.
4. **Unggah file**: klik atau seret PRD (.pdf/.docx/.md/.txt) atau dataset (.csv/.xlsx/.json) ke area unggah.
5. **Setujui aksi berisiko**: Karsa menampilkan rencana atau perubahan; tidak ada yang ditulis atau dijalankan sebelum kamu menekan setujui. Riwayatnya ada di widget **Approvals**.

### Pintasan

| Tombol | Fungsi |
|---|---|
| `Alt+K` | Karsa besar yang bisa bicara |
| `Alt+Shift+K` | Full App Mode |
| `←` / `→` | Geser slide Island |
| `?` | Daftar pintasan (bisa diubah) |

### Akses dari HP

Opt-in, karena API tidak memakai login. Jalankan `run_karsa_phone.bat` (atau `set KARSA_LAN=1 && start_karsa.bat`), lalu pindai QR di Settings > HP. Setiap perangkat non-lokal wajib memakai token pairing. Jangan aktifkan di jaringan publik.

## Pengembangan

```bash
.venv/Scripts/python.exe -m pytest -q           # tes backend (~2-3 menit)
cd desktop-companion && npm run build           # type-check + build UI
```

Konvensi proyek ada di [`CLAUDE.md`](CLAUDE.md); setiap pekerjaan dicatat di `docs/00_PROJECT_MEMORY.md`.

## Shell desktop Tauri

Sumber Rust ada di `desktop-companion/src-tauri/` (jendela transparan click-through, hotkey, tray, backend sidecar). Build butuh Rust dan MSVC Build Tools:

```bash
cd desktop-companion
npm install
npm run tauri build
```

Catatan jujur: kode Rust ini belum pernah dikompilasi di lingkungan pengembang. Bila build gagal, gunakan mode browser/PWA di atas.

## Keamanan

- `.env` tidak ikut git; `.env.example` hanya berisi placeholder.
- Aksi berisiko berhenti di gerbang persetujuan dan tercatat di audit.
- Unggahan hanya dipercaya dari dalam `~/.karsa/uploads/files`; dialog folder hanya melayani akses lokal (loopback).
- Folder sistem dan repo Karsa sendiri tidak bisa dipilih sebagai folder project.
