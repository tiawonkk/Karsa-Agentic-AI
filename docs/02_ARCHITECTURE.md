# System Architecture Specification: Project Karsa

> **Versi Dokumen:** 2.0 · **Terakhir diperbarui:** 2026-10-22  
> **Dokumen Terkait:** `01_PRD.md` · `03_SCHEMAS_AND_DATA.md` · `04_TOOLS_AND_MCP.md` · `05_UI_AND_COMPANION_ENGINE.md`

---

## 1. Overview & Core Architectural Tenets

Project Karsa dirancang dengan arsitektur **Hierarchical Multi-Agent System (HMAS)** berbasis graf status terkontrol (*StateGraph* LangGraph). Sistem memadukan komputasi deterministik lokal, perutean model bertingkat (*Tiered Model Routing*), antarmuka pendamping di tepi atas layar (*Desktop Island Notch*), dan efisiensi termal maksimal (*Zero-Heat Sleep Engine*).

### Lima Pilar Teknis Arsitektur Karsa:
1. **Context Isolation via Subagents:** Menggunakan topologi Supervisor-Workers di mana sub-agen dipanggil dalam *scope* terisolasi dan hanya mengembalikan ringkasan akhir (`output_mode="last_message"`), mencegah pembengkakan riwayat pesan (*context rot* / *token bloat*).
2. **Deterministic-First Layer:** Menjalankan pembersihan data (Pandas), kalkulasi saldo *Daily Safe Spend*, parsing nominal lokal, dan kompilasi Word deterministik sebelum memicu pemanggilan LLM.
3. **Universal Model Router (Hot-Swappable):** Lapisan abstraksi dinamis untuk menukar penyedia model kapan saja melalui UI Notch (Gemini Pro/Flash, Kiro AI, Ollama Local [DeepSeek-R1-Distill 8B / Hermes 3 8B], Groq, OpenAI, dan Anthropic).
4. **Hardware-Adaptive & Zero-Heat Sleep Engine:** Otomatis mendeteksi spesifikasi komputasi saat startup (`turbo_gpu` vs `eco_cpu`), dan menyediakan pembebasan memori radikal saat *Sleep Mode* (loop Canvas 0 FPS, Ollama `keep_alive=0` unloader, 0.0% CPU/GPU).
5. **Desktop Island & Active Screen Reader:** Antarmuka bergaya notch (`louis-cfm/coucou`) yang ramah, tidak mencuri fokus, dan mampu menangkap layar/jendela aktif (*Screen Assist*) secara aman untuk membantu pengguna memahami materi di layar.

---

## 2. Topologi Orkestrasi Graf (System Topology)

```text
       ┌──────────────────────────────────────────────────────────────┐
       │   Client Layer: Tauri v2 Desktop Notch / Smartphone PWA      │
       │   - Procedural Mascot Canvas 2D (Squircle & 3D Eyes)         │
       │   - HitlApprovalPill (Allow / Edit / Deny Langsung di Notch) │
       │   - Drag-and-Drop File Swallow & Screen Assist Trigger       │
       └──────────────────────────────┬───────────────────────────────┘
                                      │ (REST / SSE Stream)
                                      ▼
                       ┌──────────────────────────────┐
                       │       Supervisor Node        │
                       │   (Intent Triage & Router)   │
                       └──────┬───┬───┬───┬───────────┘
                              │   │   │   │
     ┌────────────────────────┘   │   │   └────────────────────────┐
     ▼                            ▼   ▼                            ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────────┐ ┌──────────────────────┐
│Finance Module│ │ Study Module │ │ Research & Writer│ │ Data Science & Code  │
│ (Sub-Graph)  │ │ (Sub-Graph)  │ │  (IMRaD & RAG)   │ │ (Pandas Sandbox & MCP│
└──────┬───────┘ └──────┬───────┘ └────────┬─────────┘ └──────────┬───────────┘
       │                │                  │                      │
       └────────────────┴─────────┬────────┴──────────────────────┘
                                  ▼
                   ┌──────────────────────────────┐
                   │     Deterministic Gate       │
                   │ (Pydantic Schema & Risk Gate)│
                   └──────────────┬───────────────┘
                                  │
                         [Evaluasi Risiko]
                          ├─── Rendah ──► [Eksekusi Otomatis]
                          └─── Tinggi / Kritis
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │     interrupt()      │
                       │ (ApprovalRequest)    │
                       └──────────┬───────────┘
                                  │
                         [Review di Notch]
                          ├─── Allow ────► Command(resume="approve") ──► Eksekusi
                          ├─── Edit ─────► Command(resume="edit", args)
                          └─── Deny ─────► Command(resume="reject")  ──► Batal
```

---

## 3. Universal Model Router (Hot-Swappable LLM)

`backend/core/llm_router.py` menyediakan antarmuka terpadu yang membebaskan sub-agen dari keterikatan pada satu vendor model:

```python
chat_model = router.get_chat_model(
    tier="tier1_utility",  # tier1_utility | tier2_code | tier3_reasoning
    stream=True
)
```

### Matriks Model per Tier:
| Tier Model | Beban Kerja / Tanggung Jawab | Provider & Model Target |
| :--- | :--- | :--- |
| **Tier 1: Triage & Utility** | Klasifikasi niat, parsing JSON struk belanja, prioritisasi tugas harian | **Ollama Local** (`hermes3:8b`) pada `turbo_gpu`; **Gemini Flash / Groq** pada `eco_cpu` |
| **Tier 2: Code & Transform** | Pembuatan skrip Pandas, perbaikan kode via patch MCP, debugging | **Anthropic** (Claude), **Gemini Pro**, atau **Kiro AI Engine** (via MCP/OpenAI-compatible) |
| **Tier 3: Reasoning & Synthesis** | Komparasi multi-paper ilmiah, draf karya ilmiah IMRaD, analisis investasi | **Gemini Pro** / **Anthropic Claude 3.5 Sonnet** (Konteks luas & bilingual formal) |
| **Vision / Screen Assist** | OCR struk belanja, pembacaan tangkapan layar aktif | **Gemini Flash** (Cloud) / OCR lokal cepat (Deskripsi & Teks) |

* **Hot-Swapping:** Pengguna dapat mengganti model aktif kapan saja dari panel pengaturan Notch tanpa me-restart server.

---

## 4. Hardware-Adaptive & Thermal-Safe Sleep Engine

`backend/core/hardware_detector.py` bertanggung jawab menjaga performa dan suhu laptop pengguna.

### 4.1 Mode Komputasi Startup
1. **Mode `turbo_gpu` (VRAM $\ge 6\text{ GB}$ & Ollama Aktif):**
   - Menjalankan model lokal (`hermes3:8b` / `deepseek-r1:8b`) untuk operasi Tier 1.
   - Mengaktifkan embedding lokal (`BAAI/bge-small-en-v1.5`).
   - Biaya token operasional harian: **0 IDR**.
2. **Mode `eco_cpu` (Tanpa GPU diskrit / RAM terbatas / Ollama mati):**
   - Menonaktifkan LLM lokal untuk mencegah lag dan panas pada laptop.
   - Mengalihkan beban kerja Tier 1 ke cloud API ringan hemat biaya (Gemini Flash / Groq).

### 4.2 Zero-Heat Sleep Mode (`SLEEP` State)
Saat pengguna mengaktifkan mode tidur atau sistem mendeteksi inaktivitas selama batas waktu tertentu (default: 5 menit):

1. **Canvas Animation Loop Dimatikan (0 FPS):** Jendela desktop membatalkan `requestAnimationFrame`. Maskot dirender menjadi 1 frame statis tidur pulas (`Zzz`).
2. **Background Watchers Dihentikan:** Seluruh pemantau layar, background poller, dan event listener dinonaktifkan.
3. **Model Local VRAM Unloader:** Backend memicu pemanggilan Ollama API:
   ```json
   POST http://localhost:11434/api/generate
   {
     "model": "hermes3:8b",
     "keep_alive": 0
   }
   ```
   *Efek:* Model lokal segera dikeluarkan dari VRAM/RAM. Penggunaan CPU dan GPU turun ke **0.0%**, laptop tetap dingin dan baterai tidak terkuras.
4. **Instant Wake:** Sentuhan mouse pertama di area notch langsung mengembalikan sistem ke state aktif dalam waktu $< 100\text{ ms}$.

---

## 5. Direct Screen & Active Window Reader (`screen_reader.py`)

Karsa dilengkapi modul khusus di `backend/screen_context/screen_reader.py` untuk menjadi asisten kontekstual nyata saat pengguna membaca paper, memahami materi kuliah, atau debugging kode:

```text
[Tombol ScreenAssist di Notch]
                │
                ▼
[Tangkap Layar / Jendela Aktif] (via platform API / Desktop Shell)
                │
                ├── Ekstraksi Judul Jendela Aktif (mis. "VS Code - main.py")
                └── Kompresi Citra di Memori (JPEG kualitas optimal / OCR lokal)
                │
                ▼
[Injeksi ke KarsaState: active_window_context]
                │
                ▼
[Sub-Agen Menjawab Berdasarkan Konteks Layar Tanpa Copy-Paste]
```

* **Kebijakan Privasi Mutlak:** Screen Reader **hanya** aktif ketika pengguna secara sadar mengklik tombol *Screen Assist* atau mendrag ikon target ke jendela tertentu. Tidak ada perekaman latar belakang diam-diam (*Zero Stealth Recording*).

---

## 6. Multi-Device Architecture (Hub-and-Spoke Pattern)

* **Laptop (Central Hub):** Menjalankan daemon FastAPI, LangGraph Multi-Agent Engine, SQLite Master, dan jendela Tauri v2 Desktop Island.
* **Smartphone (Edge Client):** Akses mobile via Progressive Web App (PWA) melalui Wi-Fi lokal atau koneksi aman Tailscale Mesh VPN. Mahasiswa dapat memotret struk belanja dari kamera HP, mengecek matriks tugas Eisenhower, atau memberikan konfirmasi persetujuan HITL saat tidak di depan laptop.