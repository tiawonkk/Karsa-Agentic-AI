# 06 — Gap Analysis: Spesifikasi AIPDLC & LangGraph HITL vs Karsa

Dokumen ini membandingkan spesifikasi "Platform Orchestrator AI Agent & Siklus Hidup Pengembangan Perangkat Lunak (AIPDLC & LangGraph HITL System)" dengan proyek Karsa (asisten mahasiswa lokal). Tujuannya jujur: apa yang sudah ada, apa yang dibangun pada sesi #40, dan apa yang sengaja tidak dibangun beserta alasannya.

Karsa adalah pendamping pribadi di satu perangkat, bukan platform rekayasa perangkat lunak multi-tim. Maka bagian yang relevan diambil dan diperkuat (tata kelola persetujuan manusia), sedangkan infrastruktur skala tim tidak dipaksakan.

## 1. Ringkasan status

| Area spesifikasi | Status | Keterangan |
| :--- | :--- | :--- |
| LangGraph `interrupt()` + `Command(resume=)` + checkpointer | **Ada, diperkuat** | `SqliteSaver`, thread id stabil, resume lewat `POST /api/v1/threads/{id}/resume` |
| Approve / Edit / Reject | **Dibangun (sesi #40)** | Edit sebelumnya hanya label; kini parameter yang diubah benar-benar dijalankan |
| Batas risiko Low/Medium/High/Critical | **Ada + dapat dikonfigurasi** | Override per aksi; kritis tidak pernah otomatis |
| Risk Policy configurator (Deny/Allow/Prompt) | **Dibangun** | `system_settings['hitl.policy']`, tab Kebijakan di widget Approvals |
| Audit `Human_Interventions_Audit` | **Dibangun** | Kolom di `hitl_approvals`: reviewer, keputusan, alasan, bukti, argumen diusulkan vs dijalankan, waktu |
| SDET: 7 mode kegagalan HITL | **Dibangun** | `backend/tests/test_hitl_harness.py` (lihat bagian 2) |
| Approval Card UI | **Dibangun** | Operasi, target, lingkungan, dampak, alasan, bukti, Ubah/Tolak/Setujui, lencana risiko, hitung mundur |
| Pemisahan kredensial (CES) | **Sebagian** | Kunci API dibaca dari `.env`/SQLite di sisi server dan kode proyek tidak memasukkannya ke prompt; tidak ada proses eksekutor terpisah (belum diaudit secara formal) |
| Model state 3 kanal (artefak/state) | **Sebagian** | Checkpointer SQLite + `outputs/` + tabel domain; belum ada pemisahan formal tiga kanal |
| Siklus 12 tahap AIPDLC | **Tidak dibangun** | Di luar cakupan produk (lihat bagian 4) |
| Matriks 27 pola kognitif x topologi | **Tidak dibangun** | Supervisor 2 node + sub-graf modul sudah memenuhi kebutuhan |
| Electron / PostgreSQL / Docker sandbox | **Tidak dibangun** | Karsa memakai Tauri + SQLite lokal, sengaja ringan |
| Kanal Telegram / Slack / email | **Tidak dibangun** | Butuh akun, token, dan server publik; bertentangan dengan prinsip lokal-dulu |

## 2. Tujuh mode kegagalan HITL dan cara dijamin

Setiap baris punya tes otomatis yang menjalankan `interrupt()`/resume sungguhan.

| # | Mode kegagalan | Jaminan | Mekanisme |
| :-: | :--- | :--- | :--- |
| 1 | Approval | Aksi jalan tepat sekali dengan parameter yang diusulkan | `execute_approved` mengklaim slot eksekusi secara atomik (`exec_state` pending -> running -> done) |
| 2 | Rejection | Tidak pernah dieksekusi | `claim_execution` menolak jika keputusan bukan approve/edit |
| 3 | Edit | Yang dijalankan adalah **B** (hasil edit), bukan A | `final_args` dihitung di gerbang; kunci edit harus subset `editable_args`, selain itu ditolak (`invalid_edit`) |
| 4 | Duplicate approval | Klik ganda / dua perangkat tidak menjalankan dua kali | Keputusan pertama menang (`only_if_undecided`), kunci per aksi, endpoint mengembalikan `already_decided` |
| 5 | Stale approval | Persetujuan batal jika dunia berubah | `fingerprint` (ukuran+mtime file, atau nilai pagu) dibandingkan saat eksekusi; hasilnya `stale` |
| 6 | Reviewer timeout | Tidak ada izin tanpa jawaban | `expires_at` dari kebijakan; penyapu mengubah yang kedaluwarsa menjadi reject (`timeout`) |
| 7 | Resume after failure | Aksi yang gagal bisa dilanjutkan tanpa dobel | Status `failed` terdaftar di `/approvals/incomplete`; klaim `running` yang mati diambil alih setelah 120 detik; `/approvals/{id}/retry` |

Bug akar yang ditemukan saat audit: node LangGraph yang di-resume dijalankan ulang dari baris pertama. `action_id` acak (`uuid4`) membuat baris approval baru pada setiap re-run, sehingga baris yang dijawab pengguna menjadi yatim dan tidak pernah selesai. Kini `stable_action_id` (thread + aksi + parameter + `nonce`) membuat re-run memakai baris yang sama, dengan tenggat asli yang dipertahankan.

## 3. Yang diubah pada sesi #40

- `backend/orchestrator/hitl_gate.py`: ditulis ulang (kebijakan, fingerprint, kedaluwarsa, validasi edit, klaim/selesai/eksekusi, audit, pemulihan).
- `backend/core/database.py`: kolom audit/eksekusi pada `hitl_approvals`, migrasi aman untuk DB lama (`_migrate_hitl_columns`), skema v6.
- `backend/core/state.py`: `ProposedAction.fingerprint`, `editable_args`.
- `backend/modules/finance/module.py` dan `research_writer/module.py`: memakai `final_args` + `execute_approved`.
- `backend/api/main.py`: resume idempoten dan sadar-kedaluwarsa, `GRAPH_FACTORY` dapat disuntik untuk tes, endpoint audit/incomplete/retry/policy.
- Frontend: widget **Approvals** (Alt+8; tab Menunggu, Riwayat, Kebijakan), lencana jumlah di Dock, thread id notch bertahan lintas reload, approval dari semua thread, satu kartu notch sekaligus agar pintasan Enter/E/Esc tidak menjawab beberapa sekaligus.

## 4. Yang sengaja tidak dibangun

- **Siklus 12 tahap AIPDLC dan matriks 27 pola**: ini model proses tim rekayasa perangkat lunak. Karsa melayani satu mahasiswa; menambah orkestrator 12 tahap hanya menambah latensi dan token tanpa nilai bagi pengguna.
- **Electron, PostgreSQL, Docker sandbox**: Tauri + SQLite WAL sudah dipilih (lihat `02_ARCHITECTURE.md`). Eksekusi kode berisiko (`run_shell_command`) tetap kritis dan selalu butuh izin manusia; sandbox kontainer bisa menjadi pekerjaan lanjutan jika modul eksekusi kode dibuka.
- **Telegram/Slack/email**: menambah permukaan serangan dan kredensial pihak ketiga. Notifikasi saat ini lewat Dynamic Island, lencana Dock, dan OSD.
- **Eksekutor kredensial terpisah (CES)**: tidak ada alat yang menerima rahasia mentah dari LLM; kunci tetap di sisi server. Pemisahan proses penuh dapat dipertimbangkan bila ada alat pihak ketiga yang memerlukan token.

## 5. Pekerjaan lanjutan yang masuk akal

1. Pasang gerbang yang sama pada modul `datascience_code` (saat ini mengimpor gerbang tetapi belum memakainya untuk eksekusi) dan pada penimpaan file di Notebook (`_clean` selalu file baru, jadi risikonya rendah).
2. Ekspor audit ke CSV dari tab Riwayat.
3. Notifikasi sistem operasi (toast Windows) saat ada approval menunggu dan Karsa tersembunyi.
