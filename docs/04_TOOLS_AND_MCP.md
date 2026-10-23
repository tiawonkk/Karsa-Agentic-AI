# Tools, Sandbox & MCP Integration: Project Karsa

> **Versi Dokumen:** 2.0 · **Terakhir diperbarui:** 2026-10-22  
> **Implementasi Target:** `backend/screen_context/` & `backend/modules/*/tools.py`

---

## 1. Direct Screen & Active Window Reader (`ScreenAssistTool`)

Mahasiswa sering kali butuh bantuan cepat membaca materi kuliah slide PDF di layar, memahami grafik di paper ilmiah, atau menganalisis pesan eror traceback di terminal/VS Code. Mengharuskan mereka menyalin teks atau mengambil screenshot manual sangat memecah konsentrasi.

Karsa menyediakan `ScreenAssistTool` (`backend/screen_context/screen_reader.py`) yang terhubung langsung ke tombol di *Notch Companion*:

### 1.1 Spesifikasi Fungsional:
1. **Target Capture:**
   * **Active Window Capture:** Mengidentifikasi judul jendela aktif (mis. `"VS Code - train_model.py"` atau `"Chrome - arXiv:2401.12345"`) dan memotong area jendela aplikasi yang sedang difokuskan pengguna.
   * **Full Screen Capture:** Menangkap layar utama secara utuh bila pengguna meminta analisis menyeluruh.
2. **Optimasi Token & Privasi (Compression & Local OCR First):**
   * Gambar tangkapan layar **tidak langsung** diunggah mentah ke API vision cloud.
   * Citra dikompresi di memori (JPEG 75% quality, resolusi dibatasi maksimum $1280\text{ px}$ sisi terpanjang).
   * Pada mode teks/kode: Mesin OCR lokal mengekstrak teks terlebih dahulu. Jika teks berhasil terbaca dengan akurasi tinggi, hanya teks terstruktur yang dikirim ke LLM (menghemat kuota token vision).
3. **Kebijakan Privasi Mutlak (Privacy Toggle & Anti-Spy):**
   * Tangkapan layar **HANYA** terjadi saat pengguna mengklik tombol *Screen Assist* di notch atau menyeret target ke jendela tertentu.
   * **Tidak pernah ada perekaman latar belakang diam-diam (*Zero Stealth Recording*)**.
   * Gambar sementara disimpan di `~/.karsa/uploads/screen_cache/` dan dihapus otomatis setelah sesi selesai.

---

## 2. Poka-Yoke Agent-Computer Interface (ACI)

Setiap *tool* yang dapat dipanggil oleh agen tunduk pada aturan *Poka-Yoke* yang ketat:

1. **Skema Input/Output Pydantic v2 Eksplisit:**
   * `model_config = ConfigDict(extra="forbid")`. Argumen halusinasi langsung ditolak di gerbang validasi.
2. **Jalur File Wajib Absolut:**
   * Mencegah path traversal (`../../`) dan ambiguitas direktori kerja. Semua path di-resolve dengan `Path(p).expanduser().resolve()`.
3. **Pesan Eror Informatif & Solutif:**
   * Eror tool mengembalikan struktur `ToolError` yang berisi kode eror, pesan jelas, dan petunjuk tindakan koreksi (*actionable hint*).

---

## 3. Coding & Filesystem Integration via MCP (Model Context Protocol)

Modul `datascience_code` mengintegrasikan ruang kerja pengodean menggunakan standar terbuka **Model Context Protocol (MCP)**:

### 3.1 Filesystem Sandbox:
* Operasi baca/tulis dibatasi ketat di dalam `active_workspace_path` (direktori proyek aktif).
* Menimpa file kode yang ada atau membuat file di luar workspace memicu interupsi **HITL** pada *Notch Approval Pill*.

### 3.2 Terminal Execution Sandbox:
* Menjalankan perintah testing (`pytest`), linting (`ruff`), atau profiling data dalam sub-proses terisolasi (`subprocess.run(shell=False)`).
* Output terminal dipotong maksimal $2.000$ karakter untuk mencegah lonjakan token pada context window LLM.

---

## 4. Deterministic Data Science Sandbox (Pandas Local Profiler)

Prinsip: **LLM tidak boleh membaca ribuan baris data mentah**.

1. Skrip Pandas lokal mengekstrak profil dataset `.csv` atau `.xlsx`:
   * Dimensi data (`shape`).
   * Tipe data per kolom (`dtypes`).
   * Jumlah nilai kosong (*missing values*) dan duplikasi baris.
   * Ringkasan statistik 5 angka (`df.describe().to_dict()`).
2. Hanya metadata ringkas ini (JSON berukuran $< 2\text{ KB}$) yang dikirim ke LLM.
3. LLM menyusun rencana pembersihan (`CleaningPlan`), lalu dieksekusi secara deterministik di sandbox lokal menghasilkan file baru di `~/.karsa/outputs/`.

---

## 5. Deterministic Document Engine (IMRaD to `.docx` Compiler)

Mengubah naskah riset berformat IMRaD (*Introduction, Methods, Results, Discussion*) dari Markdown menjadi dokumen Microsoft Word:

1. Kompilasi dilakukan secara deterministik murni menggunakan pustaka `python-docx` (0 token LLM).
2. Memetakan elemen Markdown ke gaya resmi dokumen ilmiah:
   * Heading 1, 2, 3 dengan hierarki rapi.
   * Tabel bergaris formal (*Table Grid*) dengan caption penomoran.
   * Blok kode dengan font monospace dan background kontras lembut.
   * Sitasi bernomor berurutan otomatis dengan daftar pustaka di bagian akhir.
3. Menimpa file dokumen `.docx` yang sudah ada wajib melalui konfirmasi persetujuan manusia di *Notch Companion*.
