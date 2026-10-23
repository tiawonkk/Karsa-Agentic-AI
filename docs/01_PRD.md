# Product Requirement Document (PRD): Project Karsa

> **Versi Dokumen:** 2.0 · **Status:** Disetujui untuk Tahap 1 · **Terakhir diperbarui:** 2026-10-22  
> **Produk:** Karsa Agentic AI — Desktop Island Companion & Student Agentic AI (100% mandiri, tanpa UiPath)

---

## 1. Executive Summary & Visi Produk

**Project Karsa** adalah sistem *Personal Agentic AI Assistant* terintegrasi yang berwujud **Interactive Top-Edge Notch / Desktop Island Companion** (terinspirasi dari arsitektur `louis-cfm/coucou`). Karsa dirancang khusus untuk mahasiswa guna mengotomasi manajemen keuangan pribadi, rutinitas studi harian, riset paper akademik, penulisan artikel ilmiah berstandar IMRaD, analisis data (*data science*), hingga bantuan pengodean perangkat lunak langsung di layar kerja pengguna.

Karsa berjalan **100% mandiri (*standalone*, tanpa UiPath)**, lintas platform (Windows, macOS, Linux, serta akses Smartphone via PWA), hemat token, adaptif terhadap perangkat keras lokal (GPU/CPU), dan menghadirkan maskot interaktif yang hidup dan ramah.

### 1.1 Empat Prinsip Inti Produk (Revisi V2)

1. **Zero Dummy Data Policy (100% Real SQLite & Live APIs):** DILARANG KERAS menyajikan data palsu/mock di komponen UI maupun backend. Seluruh metrik saldo, safe spend, tugas Eisenhower, log token, dan hardware bersumber langsung dari database SQLite (`~/.karsa/storage/karsa_master.db`), OS telemetry `psutil`, serta API nyata (TheHive.ai DeepSeek, Gemini, arXiv, Semantic Scholar). Jika kosong, tampilkan empty state yang ramah dan mengajak pengguna mencatat data pertamanya.
2. **Compact Coucou-Style Island & Single Active Popover:** Antarmuka adaptif non-intrusif yang tidak menghalangi layar kerja pengguna. Mode 1 Idle Pill (34px × 170px) menempel tipis di tepi atas, sedangkan Mode 2 Compact Island (400px–440px) hanya membuka 1 kartu popover melayang pada satu waktu (Finance Report, Tasks Matrix, Chat, Settings 3-Tab, atau Wardrobe Studio).
3. **Directive Engine & Inline Comment Scanner (`@[Command]`):** Memungkinkan mahasiswa mengetik perintah cepat (`@Money`, `@Todo`, `@Study`, `@Course`, `@Search`, `@Write`, `@Data`, `@Code`, `@Screen`) dengan popup autocomplete di bar input, serta pemindai otomatis baris komentar kode (`# @Search ...`, `// @Todo ...`, `<!-- @Write ... -->`) di workspace proyek aktif untuk eksekusi deterministik 0-token.
4. **Procedural Mascot dengan Sepasang Tangan Lucu & Zero-Heat Sleep:** Maskot squircle Canvas 2D dengan sepasang tangan mengambang (*floating paws*) berbasis fisika pegas yang melacak kursor, menunjuk tombol yang di-hover (`⚙️`, `＋`, `💬`), memegang koin/lup/mengetik kode, dan merapatkan tangan di bawah pipi saat mode Sleep (0 FPS, 0% CPU).

---

## 2. Target Persona & Karakteristik Pengguna Mahasiswa

* **Profil Pengguna:** Mahasiswa (Ilmu Komputer, Sains, Teknik, Sosial-Humaniora) yang aktif multitasking di laptop.
* **Kebutuhan Kritis:**
  * Pengendalian arus kas bulanan berbasis pagu modal tetap dengan input cepat (struk/teks natural) dan perlindungan investasi konservatif.
  * Manajemen tugas kuliah padat dengan prioritas otomatis *Eisenhower Matrix*.
  * Tinjauan literatur ilmiah yang cepat, akurat, dan terstruktur dari repositori akademik (arXiv, Semantic Scholar, Crossref).
  * Transformasi catatan riset/kode menjadi draf karya ilmiah formal (Bilingual: Indonesia baku & English academic) berformat **IMRaD** langsung ke file Microsoft Word (`.docx`).
  * Pembersihan dan inspeksi dataset `.csv`/`.xlsx` tanpa membocorkan atau membuang ribuan token untuk data mentah.
  * Bantuan konsultasi cepat terhadap materi atau kode di layar aktif (*Screen Reader*) tanpa perlu copy-paste manual.

---

## 3. Spesifikasi 5 Modul Mahasiswa (Plug-and-Play)

Semua modul mengimplementasikan kontrak standar `BaseKarsaModule`:

### Modul 1: Financial Intelligence Module (`finance`)
* **Input Cepat:** Teks percakapan bebas (*"Baru jajan seblak 25rb"*) atau *drag-and-drop* foto struk belanja langsung ke mulut maskot di notch.
* **Klasifikasi 5 Kategori Mutlak:**
  1. `makanan` (kebutuhan konsumsi harian)
  2. `pelajaran` (buku kuliah, alat tulis, kursus, sertifikasi)
  3. `kesehatan` (vitamin, obat-obatan, biaya medis)
  4. `investment` (reksadana, deposito, instrumen pasar modal)
  5. `kesenangan` (jajan kopi, hobi, hiburan)
* **Kalkulasi Deterministik:** Menghitung sisa modal dan parameter *Daily Safe Spend* harian secara matematis di Python:
  $$\text{Daily Safe Spend} = \frac{\text{Sisa Alokasi } \texttt{makanan} + \text{Sisa Alokasi } \texttt{kesenangan}}{\text{Sisa Hari dalam Bulan}}$$
* **Asisten Pertimbangan Investasi Konservatif:** Mengevaluasi kecukupan likuiditas sebelum menyarankan instrumen berisiko rendah (Reksadana Pasar Uang / Deposito Bibit vs Saham). Dilarang keras memberikan rekomendasi spekulatif atau janji imbal hasil.

### Modul 2: Daily Life & Study Module (`study_daily`)
* **Pelacak Tugas Eisenhower Matrix:** Pengelompokan tugas otomatis berdasarkan `is_urgent` dan `is_important` (Q1: *Do First*, Q2: *Schedule*, Q3: *Delegate*, Q4: *Eliminate*). Tenggat $\le 48$ jam otomatis berstatus *urgent*.
* **Perangkum Multi-Dokumen Kuliah:** Memproses dokumen kuliah (`.pdf`, `.docx`, `.pptx`, `.txt`) menjadi 3 struktur komprehensif:
  1. *Rangkuman Eksekutif* (5–10 poin esensial).
  2. *Kamus Konsep Kunci* (glosarium istilah dan rumus penting).
  3. *Lembar Uji Mandiri* (3–5 pertanyaan evaluasi pemahaman).
* **Skill Roadmap Mingguan:** Menyusun kurikulum belajar adaptif mingguan lengkap dengan kurasi kursus gratis/terjangkau (Dicoding, Kaggle, FreeCodeCamp, CS50 Harvard, Coursera Financial Aid).

### Modul 3: Academic Research Module (`research`)
* **Pencarian Jurnal Ilmiah Terpadu:** Integrasi pencarian API ke arXiv, Semantic Scholar, dan Crossref dengan rate limiting aman dan cache lokal.
* **Ekstraksi Parameter Standar Paper:** Ekstraksi PDF paper menjadi 5 parameter kunci:
  1. Tahun terbit
  2. Sumber dataset
  3. Metodologi riset
  4. Limitasi riset
  5. Hasil evaluasi metrik

### Modul 4: Scientific Writer Module / Word Bridge (`writer`)
* **Draf Karya Ilmiah IMRaD:** Mengubah kode eksperimen dan catatan riset menjadi draf karya ilmiah formal bilingual (Indonesia baku / English academic) berstruktur *Introduction, Methods, Results, Discussion*.
* **Kompilasi Deterministik `.docx`:** Mengompilasi naskah Markdown secara rapi menjadi file Microsoft Word (`.docx`) menggunakan pustaka `python-docx` lengkap dengan penataan heading, tabel, caption gambar, dan sitasi berurutan.

### Modul 5: Data Science & Coding Assistant Module (`datascience_code`)
* **Sanitasi & Profiling Dataset Lokal:** Skrip Python/Pandas lokal mengekstrak metadata deskriptif (`df.info()`, `df.describe()`, dimensi, null count, duplikasi) di sandbox lokal. Data mentah ribuan baris **tidak pernah dikirim** ke context window LLM.
* **Coding Bridge via MCP:** Integrasi ruang kerja pengodean menggunakan standar *Model Context Protocol* (Filesystem & Terminal Sandbox terbatas pada direktori proyek aktif) untuk membaca AST, menerapkan patch kode, dan menjalankan testing.

---

## 4. Desktop Island, Mascot Canvas, & Wardrobe Studio

* **Top-Edge Notch Shell:** Jendela transparan, borderless, always-on-top, dan *never steals focus* di tepi atas layar. Memiliki mode `HIDDEN/SLEEP`, `PEEK`, dan `EXPANDED_ISLAND`.
* **Procedural Canvas Mascot:** Karakter *soft squircle* di atas HTML5 Canvas 2D dengan mata yang diproyeksikan 3D mengikuti kursor mouse, berkedip alami, membal (*squish*) saat diklik, pusing (*dizzy*) jika diklik cepat 3x, dan membuka mulut lebar untuk memakan file yang di-drag-and-drop.
* **Wardrobe Studio & Built-in Accessory Pad:** Pengguna dapat mengganti warna tubuh/mata maskot, memilih efek partikel aura, serta **menggambar aksesoris sendiri** pada kanvas mini $256 \times 256$ dengan kuas, penghapus, color picker, dan undo. Aksesoris menempel dinamis mengikuti deformasi tubuh maskot.
* **Direct Screen & Active Window Reader (`ScreenAssist`):** Tombol di notch untuk menangkap layar penuh atau jendela aktif beserta judulnya guna membantu membaca paper, konsultasi materi, atau debugging kode di layar. Dilengkapi *Privacy Toggle* (hanya membaca saat diminta).

---

## 5. Human-in-the-Loop (HITL) Governance Gate

Tindakan berisiko tinggi wajib memicu interupsi graf (`interrupt()`) dan menampilkan kartu persetujuan (*Approval Pill*) langsung di Desktop Notch:

| Operasi | Tingkat Risiko | Mekanisme Eksekusi |
| :--- | :--- | :--- |
| Membaca file / dataset / PDF | Rendah | Otomatis |
| Menghitung saldo & *Daily Safe Spend* | Rendah | Otomatis |
| Ekstraksi ringkasan kuliah & paper | Rendah | Otomatis |
| Membaca layar aktif (via tombol ScreenAssist) | Rendah | Dipicu oleh pengguna |
| Memodifikasi / menimpa file kode | **Tinggi** | Interupsi Graf $\rightarrow$ Approval Pill di Notch |
| Menimpa draf dokumen Word `.docx` | **Tinggi** | Interupsi Graf $\rightarrow$ Approval Pill di Notch |
| Mengubah pagu modal bulanan utama | **Tinggi** | Interupsi Graf $\rightarrow$ Approval Pill di Notch |
| Eksekusi perintah terminal shell | **Kritis** | Interupsi Graf $\rightarrow$ Approval Pill di Notch |

---

## 6. Persyaratan Non-Fungsional Kritis

1. **Zero-Heat Standby:** CPU/GPU usage 0.0% dan RAM/VRAM terbebas saat *Sleep Mode*.
2. **Token Transparency:** Setiap panggilan model dicatat di `token_logs` dan ditampilkan pada *Energy Bar* maskot dalam estimasi rupiah (IDR).
3. **Multi-Device Sync:** Hub lokal berjalan di laptop; HP terhubung sebagai PWA via Wi-Fi lokal atau Tailscale Tunnel.
4. **Cross-Platform:** Seluruh manipulasi file menggunakan `pathlib.Path` dan kode backend berjalan stabil di Windows, macOS, dan Linux.