# UI & Companion Engine Specification: Project Karsa (Desktop Island & Mascot)

> **Versi Dokumen:** 1.0 · **Terakhir diperbarui:** 2026-10-22  
> **Inspirasi Desain:** Arsitektur Notch Companion `louis-cfm/coucou`  
> **Teknologi Utama:** Tauri v2 (Rust Window Manager) + React/Next.js + HTML5 Canvas 2D + Tailwind CSS + Framer Motion  

---

## 1. Visi Desain & Konsep "Desktop Island Companion"

Karsa tidak hadir sebagai jendela aplikasi biasa yang kaku atau membosankan. Karsa adalah **sahabat digital di tepi atas layar (*Top-Edge Notch / Desktop Island Companion*)** yang hidup, ramah, ekspresif, dan selalu siap membantu kehidupan serta tugas mahasiswa tanpa mengganggu alur kerja (*never steals focus*).

### Pilar Antarmuka:
1. **Unobtrusive & Always Available:** Menempel anggun di tepi atas layar (*center-top*) seperti pulau dinamis (*Dynamic Island*). Saat diam, ia mengecil atau tidur (*Zero-Heat Sleep*). Saat kursor mendekat atau ada aktivitas, ia mengintip (*peek*) dan merespons.
2. **Procedural Canvas Mascot (Living Squircle):** Karakter maskot berwujud *soft squircle* yang digambar murni di atas HTML5 Canvas 2D dengan fisika pegas (*spring dynamics*), pelacakan mata 3D mengikuti kursor mouse, animasi ekspresi emosi prosedural, dan reaksi interaktif ketika disentuh (*squish*, *dizzy*, *mouth swallow*).
3. **Interactive Wardrobe Studio & Draw Pad:** Pengguna dapat mengganti warna tubuh/mata maskot, serta **menggambar aksesoris sendiri** (topi, pita, kacamata) di kanvas mini built-in. Aksesoris tersebut secara dinamis menempel pada titik jangkar (*anchor point*) kepala/tubuh maskot dan ikut membal serta miring mengikuti gerakan maskot.
4. **Seamless Task & File Swallow:** Pengguna cukup melempar (*drag-and-drop*) file tugas `.pdf`, dataset `.csv`, atau foto struk belanja langsung ke mulut maskot di notch untuk memprosesnya secara instan.
5. **Human-in-the-Loop Approval Pill:** Kartu persetujuan tindakan berisiko tinggi (Allow / Edit / Deny) muncul langsung sebagai ekstensi pulau (*island expansion*) dengan status visual yang jelas.

---

## 2. Desktop Shell: Tauri v2 Window Architecture

Jendela desktop Karsa dibangun di atas Tauri v2 dengan konfigurasi khusus jendela sistem operasi (Windows, macOS, Linux):

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        Top of Screen (0, y)                            │
│                  ┌──────────────────────────────────┐                  │
│                  │  [ ●  ● ]  KARSA DESKTOP ISLAND  │                  │
│                  └──────────────────────────────────┘                  │
│                                                                        │
│                      Area Kerja Pengguna (VS Code,                     │
│                      Browser Jurnal, PDF Reader, dll)                  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Konfigurasi Native Window (`src-tauri/tauri.conf.json`)
* **`decorations`:** `false` (borderless).
* **`transparent`:** `true` (latar belakang tembus pandang, hanya notch dan bayangannya yang dirender).
* **`alwaysOnTop`:** `true` (tetap berada di atas jendela kerja pengguna).
* **`visibleOnAllWorkspaces`:** `true` (muncul di seluruh virtual desktop / spaces).
* **`skipTaskbar`:** `true` (tidak memenuhi taskbar; ada tray icon kecil di system tray).
* **`acceptsFirstMouse`:** `true` (langsung merespons klik pertama tanpa perlu aktivasi jendela).
* **Focus Policy (`Never Steals Focus`):**
  * Di Windows: Menggunakan window styles Win32 `WS_EX_NOACTIVATE` saat dalam mode *Peeking* atau *Floating Mascot* agar ketikan pengguna di VS Code atau terminal tidak terputus saat mouse menyenggol notch.
  * Hanya meminta fokus saat pengguna secara eksplisit mengklik kotak input chat di panel *Expanded Island*.

### 2.2 Mode Tampilan: Top-Edge Notch vs Floating Mascot
Pengguna dapat memilih dua mode penempatan:
1. **Docked Notch (Default):** Mengunci di koordinat $(X_{\text{center}}, 0)$ di tepi atas layar utama.
2. **Detached Floating Companion:** Maskot dapat ditarik (*dragged out*) dari notch ke area mana pun di desktop sebagai teman kecil mengambang berukuran 120 pt, dan dapat dikembalikan ke tepi atas cukup dengan menyeretnya mendekati batas atas layar (*magnet snap*).

---

## 3. Finite State Machine (FSM) Antarmuka Notch

Notch Karsa beroperasi menggunakan State Machine terkontrol:

```text
 ┌──────────────┐     Hover mendekati tepi atas     ┌──────────────┐
 │ HIDDEN/SLEEP ├──────────────────────────────────►│     PEEK     │
 └──────┬───────┘                                   └──────┬───────┘
        │                                                  │
        │ Event approval_required                          │ Klik / Drag file
        │ atau ada streaming agen                          │
        ▼                                                  ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │                         EXPANDED_ISLAND                         │
 │  - Panel Chat & Token Energy Bar                                │
 │  - HitlApprovalPill (Allow / Edit / Deny)                       │
 │  - Mulut Maskot Terbuka (Drag-and-Drop File Swallow)            │
 │  - Tombol ScreenAssist & Status Modul Aktif                     │
 └─────────────────────────────────────────────────────────────────┘
```

### Rincian State Notch (Dynamic Island V3 — Bezel-Blended Island):
| State | Dimensi | Perilaku & Tampilan |
| :--- | :--- | :--- |
| `Mode 1: Bezel Notch Idle` | `clamp(180px, 14vw, 240px) × 34px` | Menempel pada bezel fisik atas dengan lengkungan sayap terbalik (*concave reverse-curve ears*). Menampilkan mata AI oval bercahaya atau mini-status (cincin progres hijau, jam digital `07:47`, dan bar equalizer audio `|||||`). |
| `Mode 2: Bezel Island Expanded Deck` | `clamp(440px, 34vw, 680px) × clamp(120px, 14vh, 220px)` | Pulau meluas ke bawah dengan animasi pegas kenyal (*bouncy spring*). Menampung **6-Slide Interactive Deck** yang dapat digeser secara horizontal menggunakan tombol navigasi `<` dan `>`, swipe gesture, atau pintasan keyboard. |
| `Mode 3: Split View / Lyrics Overlay` | `clamp(580px, 46vw, 840px) × 180px` | Memperluas pulau secara horizontal dengan layout split 2 kolom: sisi kiri pemutar media / kontrol, sisi kanan lirik tersinkronisasi (*live scrollable synced lyrics*) dengan baris aktif yang disorot tebal. |
| `Mode 4: Omni-Bar & Search` | `clamp(460px, 36vw, 700px) × 52px` | Bar input pencarian instan aplikasi Windows + auto-suggest direktif `@` (`@Money`, `@Search`, `@Todo`, `@Study`, `@Write`, `@Data`, `@Screen`). |
| `Mode 5: Hardware OSD Pill` | `clamp(220px, 18vw, 320px) × 42px` | Muncul sesaat (1.5 detik) saat tombol hardware ditekan (Volume, Brightness, CapsLock, Mute, Baterai) menggantikan OSD bawaan Windows yang kaku. |

---

## 3.1 Bezel-Blended Geometry & Adaptive Screen Scaling

### 1. Bezel-Blended "Concave Wings" Geometry
Desain fisik Dynamic Island Karsa V3 menyatu secara organik dengan bezel layar laptop:
* **Concave Reverse-Curve Ears:** Sudut atas kiri dan kanan tidak lagi berbelok siku ke bawah, melainkan memiliki sayap kurva cekung terbalik (radius 14px–20px) yang membaurkan badan pulau hitam OLED `#000000` langsung ke garis bezel fisik atas monitor.
* **Ambient Backlight Gradient:** Pada mode aktif, terdapat pendaran gradien radial lembut (biru-ungu tua `rgba(59, 130, 246, 0.25)` hingga `rgba(147, 51, 234, 0.20)`) di bagian latar belakang pulau, memberikan kesan kedalaman optik yang futuristis namun elegan.

```text
       ═══════════════════════ BEZEL LAPTOP ATAS ═══════════════════════
       ─────────╮                                             ╭─────────
       (Sayap   │                                             │  (Sayap
        Cekung) ╰─────────────┬─────────────────┬─────────────╯   Cekung)
                              │  [ ●         ● ]│
                              │     Glowing     │
                              │     AI Eyes     │
                              ╰─────────────────╯
```

### 2. Adaptive Screen Scaling (Resolution-Agnostic)
* Menggunakan fungsi CSS `clamp()` dan kalkulasi rasio viewport berbasis DPI layar:
  - Lebar: `clamp(440px, 32vw, 680px)`
  - Tinggi deck: `clamp(130px, 15vh, 220px)`
  - Border radius dasar: `clamp(20px, 2.5vw, 32px)`
* Di Windows/Tauri: Mengambil resolusi layar aktif melalui `window.screen.availWidth` dan skala DPI monitor sehingga pulau tetap proporsional baik di layar 13" FHD (1080p), 15" QHD (1440p), maupun 4K High-DPI Display.

---

## 3.2 Windows Hardware OSD Interceptor (Sub-system Flyout)

Karsa V3 mengintegrasikan modul penangkap event hardware sistem operasi tingkat rendah (*Low-Level Keyboard & Multimedia Event Listener*) guna menggantikan tampilan OSD default Windows yang kaku dan mengganggu:

1. **Event yang Diintersepsi:**
   - **Tombol Volume (`VK_VOLUME_UP`, `VK_VOLUME_DOWN`, `VK_VOLUME_MUTE` / F1-F3):** Menampilkan slider bar volume taktil dengan ikon dinamis (Mute / Rendah / Sedang / Maksimal) dan persentase angka.
   - **Tombol Kecerahan Layar (`F4`–`F5`):** Slider pencerahan layar dari 0% hingga 100%.
   - **Indikator Lock Keys (`CapsLock`, `NumLock`):** Badge status mini `"CAPS LOCK ON"` / `"NUM LOCK ON"` dengan aksen amber/hijau.
   - **Playback Media (`VK_MEDIA_PLAY_PAUSE`, `VK_MEDIA_NEXT_TRACK`, `VK_MEDIA_PREV_TRACK`):** Animasi play/pause instan dan ringkasan judul lagu.
   - **Status Baterai & Daya:** Peringatan status charger dicolok (*Charging*) / dilepas (*On Battery*) dan persentase daya.
   - **Perangkat Bluetooth Audio:** Notifikasi halus saat earphone/TWS terhubung atau terputus.
2. **Perilaku Tampilan OSD:**
   - Pulau secara otomatis membesar lembut ke ukuran `Mode 5: Hardware OSD Pill` selama 1.5 detik, lalu mengecil kembali secara elastis ke mode Idle/Slide aktif.

---

## 3.3 Built-in Windows App Search & `@Directive` Omni-Bar

Pulau dilengkapi Omni-Bar multifungsi yang diakses dengan menekan `Ctrl + Spasi` atau mengklik area pencarian di pulau:

1. **Pencarian Aplikasi Lokal Windows (App Launcher):**
   - Mengindeks folder Start Menu Windows (`C:\ProgramData\Microsoft\Windows\Start Menu\Programs` dan `%AppData%\Microsoft\Windows\Start Menu\Programs`) secara deterministik di latar belakang.
   - Mengetik `"code"` langsung memunculkan *Visual Studio Code*, `"calc"` memunculkan *Kalkulator*, `"spotify"` membuka *Spotify*. Menekan `Enter` langsung meluncurkan aplikasi via sub-proses OS.
2. **Eksekusi Cepat Direktif `@` Mahasiswa (0-Token Instant Action):**
   - `@Money [nominal]`: Mencatat pengeluaran kilat ke SQLite tanpa buka menu keuangan.
   - `@Todo [judul]`: Menambahkan tugas baru otomatis dihitung ke Eisenhower Matrix.
   - `@Study [file]`: Memulai ekstraksi 3-struktur materi kuliah.
   - `@Search [topik]`: Menjalankan query paper jurnal di arXiv dan Crossref.
   - `@Write [topik]`: Menghasilkan draf riset IMRaD dan kompilasi `.docx`.
   - `@Data [file.csv]`: Menjalankan profiling lokal dataset tanpa membuang token.
   - `@Screen`: Mengambil konteks layar aktif untuk tanya-jawab cepat.

---

## 3.4 The 6-Slide Interactive Deck (Carousel Architecture)

Pulau mengadopsi antarmuka **6-Slide Deck** yang intuitif. Mahasiswa dapat berpindah antar-slide menggunakan tombol panah `<` dan `>`, swipe gesture, atau klik pada pagination dots di bagian bawah kartu:

```text
 ┌────────────────────────────────────────────────────────────────────────┐
 │ [ < ]  Pomodoro           (🟢) Fri 23 Oct 2026 07:48            |||||  │
 │                                                                        │
 │       ┌───────┐                       25:00                   (↻)      │
 │       │  (⏱)  │                     Focus time                         │
 │       └───────┘                                                        │
 │                                                                  [ > ] │
 │                   [☕ Short Break]   [ ▶ ]   [🎯 Focus Time]            │
 │                                                                        │
 │                                 ● ━━ ○ ○ ○ ○                           │
 └────────────────────────────────────────────────────────────────────────┘
```

### Rincian 6 Slide Interaktif:

#### 1. Slide 1 — AI Eyes/Hands & Omni-Bar (Mascot Companion)
* Menampilkan sepasang mata AI putih oval bercahaya yang melacak kursor secara 3D di atas kanvas mochi squircle.
* Sepasang tangan mengambang (*floating paws*) berbasis pegas yang menunjuk dan memegang ikon konteks.
* Omni-bar pencarian aplikasi dan direktif `@`.

#### 2. Slide 2 — Media Player & Live Lyrics Split View
* **Left Pane:** Cover album/vinyl disc yang berputar halus saat musik aktif, judul lagu (*"Paper Sky - Lumen Coast"*), timeline progress bar interaktif dengan durasi waktu berjalan (`03:13`) dan sisa waktu (`-01:03`), tombol kontrol media (*Prev, Play/Pause, Next*).
* **Right Pane (Split View):** Tampilan lirik lagu real-time yang bergulir otomatis (*live scrollable synced lyrics*) dengan baris aktif yang disorot tebal dan baris lainnya ber-opacity lembut (lihat Gambar Referensi 5).
* Ikon visualizer bar equalizer audio animasi `|||||` di pojok kanan atas.

#### 3. Slide 3 — Pomodoro Focus Timer
* Ring pengukur waktu berwarna coral red cerah dengan ikon stopwatch.
* Tampilan digital countdown besar (format `MM:SS`, misal `25:00`) dengan status *"Focus time"*, *"Short Break"*, atau *"Long Break"*.
* Tombol aksi taktil: `☕ Short Break (5m)`, tombol utama Play/Pause `▶`/`⏸`, dan `🎯 Focus Time (25m)`, serta tombol reset `↻`.
* Setiap sesi fokus yang selesai secara deterministik disimpan ke tabel SQLite `focus_sessions` terhubung ke `tasks`.

#### 4. Slide 4 — Water Reminder & Hourly Intake Bar Chart
* Pelacak hidrasi harian untuk menjaga konsentrasi belajar mahasiswa.
* Tampilan target harian (misal `1.250 / 2.000 ml` dengan persentase cincin progres hijau).
* Tombol tambah kilat: `+200 ml (Gelas)`, `+500 ml (Botol)`.
* **Hourly Intake Bar Chart (09:00 - 21:00):** Visualisasi histogram bar kecil per jam yang menunjukkan kapan saja mahasiswa minum air sepanjang hari, bersumber langsung dari tabel SQLite `hydration_logs`.

#### 5. Slide 5 — File Drop Shelf (Desktop Staging Dock)
* Area rak file serbaguna di mana mahasiswa dapat men-drag file apa pun (`.pdf`, `.docx`, `.csv`, `.py`, foto struk) ke Dynamic Island.
* File tersimpan rapi sebagai kartu miniatur dengan ikon tipe file, nama, dan ukuran, dicatat di tabel SQLite `shelf_files`.
* Mahasiswa dapat mengklik untuk memicu pemrosesan Karsa (rangkum materi, analisis dataset, atau ocr) atau men-drag file keluar rak langsung ke jendela browser/WhatsApp Web/email tugas.

#### 6. Slide 6 — TodoList Checklist (Eisenhower Matrix Quickview)
* Daftar centang tugas kuliah to-do hari ini yang diurutkan berdasarkan kuadran Eisenhower (Q1 mendesak di posisi teratas).
* Satu klik checkbox langsung menandai tugas selesai (`complete_task_in_db`) dan mencatat waktu penyelesaian di SQLite `tasks`.
* Tombol pintas `+ Tambah Tugas` untuk input cepat.

---

## 4. Interactive Procedural Canvas 2D Mascot Engine

Maskot Karsa dirender secara prosedural murni menggunakan **HTML5 Canvas 2D Context** (`<canvas>`), menghasilkan animasi yang sangat ringan, tajam di layar Retina/HiDPI, dan bebas dependensi aset bitmap berat.

### 4.1 Geometri Tubuh: The Soft Squircle
Bentuk dasar tubuh maskot adalah *superellipse / squircle* dengan rumus Bézier dinamis yang mendukung deformasi fisika pegas:
$$x(t) = r \cdot \text{sgn}(\cos t) |\cos t|^{2/n}, \quad y(t) = r \cdot \text{sgn}(\sin t) |\sin t|^{2/n}$$
* **Deformasi Fisika:**
  * Saat diklik: Tubuh membal memipih vertikal (*squish factor* $0.7 \times$ tinggi, $1.3 \times$ lebar) lalu kembali bergetar (*elastic bounce*).
  * Saat kursor bergerak cepat di atasnya: Tubuh sedikit miring (*lean*) ke arah gerakan mouse.

### 4.2 Sistem Mata: 3D Spherical Eye Projection
* Mata maskot terdiri dari kornea luar (putih lembut) dan pupil/iris dalam (warna dinamis).
* **Pelacakan Kursor 3D:** Koordinat mouse $(m_x, m_y)$ dinormalisasi terhadap pusat kepala maskot. Posisi pupil diproyeksikan seolah-olah berada di permukaan bola virtual 3D dengan batas kelengkungan (*clamped radius*), menciptakan ilusi tatapan mata tiga dimensi yang hidup.
* **Kedipan Alami (Blink Cycle):** Interval acak antara 2.5 hingga 6 detik. Saat berkedip, tinggi pupil mengecil menjadi 0 selama 120 ms lalu membuka kembali.

### 4.3 Reaksi Interaktif & Emosi
1. **Poked & Annoyed:** Mengklik maskot sekali membuatnya tersentak ramah.
2. **Dizzy / Pusing:** Mengklik cepat $\ge 3\times$ dalam 1 detik membuat mata maskot berputar spiral (*dizzy spirals*) dan bergoyang selama 3 detik sebelum kembali normal.
3. **File Swallow (Mulut Terbuka):** Saat event drag-over file terdeteksi, mata menyipit senang dan mulut terbuka berbentuk oval gelap dengan partikel hisap. Ketika file di-drop, mulut menutup (*"Gulp!"*) disertai animasi perut mengembang sesaat.
4. **Happy Jump:** Ketika sub-agen berhasil menyelesaikan tugas atau kompilasi Word/analisis dataset sukses, maskot melompat kecil dengan mata berbentuk lengkungan bahagia (`^ ^`).

---

## 5. Built-in Wardrobe Studio & Draw-Your-Own Accessory Pad

Karsa menyediakan fitur personalisasi penuh bagi mahasiswa melalui panel **Wardrobe Studio** yang terintegrasi di dalam Notch.

### 5.1 Color Customizer
* **Body Hue/Hex:** Memilih warna tubuh maskot (default: *cute pastel blue / mint / lilac / coral*).
* **Eye Color:** Memilih warna mata/pupil.
* **Notch Aura / Background Particles:** Mengatur efek partikel di belakang maskot (mis. *bintang malam berbintang*, *kelopak sakura*, atau *matrix code green* minimalis).

### 5.2 Draw-Your-Own Accessory Pad (Studio Gambar Mini)
Pengguna tidak perlu mencari mod atau aset eksternal; mereka dapat menggambar aksesoris mereka sendiri langsung di dalam aplikasi!

```text
┌────────────────────────────────────────────────────────┐
│                   WARDROBE STUDIO                      │
│ ┌───────────────────────────┐  Tools:                  │
│ │                           │  [Pen] [Eraser] [Undo]   │
│ │     Koleksi Aksesoris     │  Color: [ ■ #FF5577 ]    │
│ │     [Topi Wisuda] [Pita]  │  Size:  [───●────] 3px   │
│ │     [+ Gambar Baru]       │                          │
│ └───────────────────────────┘                          │
│ ┌────────────────────────────────────────────────────┐ │
│ │                  DRAWING CANVAS                    │ │
│ │  (Siluet panduan kepala maskot transparan 10%)     │ │
│ │                                                    │ │
│ │               .---.                                │ │
│ │              /_____\   <-- Hasil goresan topi      │ │
│ │             (_______)                               │ │
│ │                                                    │ │
│ └────────────────────────────────────────────────────┘ │
│ [ Simpan ke Lemari Aksesoris ]    [ Hapus ]            │
└────────────────────────────────────────────────────────┘
```

#### Alur Teknis Canvas Drawing Pad:
1. **Dimensi Kanvas Gambar:** Kanvas berukuran $256 \times 256$ piksel dengan latar transparan (`transparent alpha`).
2. **Panduan Visual (Ghost Template):** Menampilkan siluet samar kepala maskot (opacity 15%) sebagai acuan posisi agar pengguna tahu di mana letak atas kepala, mata, atau leher.
3. **Drawing Tools:**
   * Kuas halus anti-aliased dengan pengaturan ketebalan (1px s.d. 20px).
   * Palet warna bebas (Color Picker HEX/RGB).
   * Penghapus (*Eraser*) & Riwayat Undo/Redo (stack 20 langkah).
4. **Penyimpanan Aksesoris (`wardrobe_items`):**
   * Hasil gambar diekspor sebagai PNG Base64 atau file lokal di `~/.karsa/wardrobe/<item_id>.png`.
   * Metadata disimpan ke tabel SQLite `wardrobe_items` dengan tipe anchor: `head_top` (topi/pita), `eyes` (kacamata), `neck` (dasi/syal), atau `side` (pin/bunga).
5. **Dynamic Physics Attachment Rendering:**
   * Saat maskot Canvas 2D digambar, layer aksesoris aktif dirender di atas tubuh maskot.
   * Koordinat transformasi aksesoris dikalikan dengan matriks deformasi maskot: jika kepala maskot miring $5^\circ$ atau membal ke bawah saat diklik, aksesoris ikut miring dan membal secara presisi!

---

## 6. Zero-Heat Sleep Mode Architecture (Hemat Baterai & Suhu 0%)

Salah satu masalah utama aplikasi asisten desktop adalah konsumsi CPU latar belakang yang membuat kipas laptop berputar dan baterai cepat habis. Karsa memecahkan masalah ini secara radikal dengan **Zero-Heat Sleep Mode**.

### 6.1 Pemicu Mode Tidur (Sleep Triggers)
1. **Inaktivitas:** Tidak ada pergerakan mouse atau request baru selama $N$ menit (default: 5 menit, dapat diatur).
2. **Manual Toggle:** Pengguna mengklik tombol tidur / ikon bulan sabit di notch.
3. **System Sleep / Screen Lock:** Deteksi event OS saat laptop mengunci layar atau sleep.

### 6.2 Eksekusi Tiga Tahap Zero-Heat:
```text
           [Deteksi Inaktivitas / Tombol Tidur]
                           │
                           ▼
 ┌─────────────────────────────────────────────────────────┐
 │ 1. UI Layer: Hentikan requestAnimationFrame (0 FPS)     │
 │    - Canvas loop berhenti total                         │
 │    - Render 1 frame statis: Maskot tidur pulas ("Zzz")  │
 │    - Notch mengecil ke mode HIDDEN/SLEEP (6px)          │
 └─────────────────────────┬───────────────────────────────┘
                           │
                           ▼
 ┌─────────────────────────────────────────────────────────┐
 │ 2. Backend Gateway: Hentikan Poller & Watchers          │
 │    - Screen watcher / window context capture dihentikan │
 │    - SSE background keep-alive dibuat idle              │
 └─────────────────────────┬───────────────────────────────┘
                           │
                           ▼
 ┌─────────────────────────────────────────────────────────┐
 │ 3. Model Engine: Unload Model Lokal dari VRAM/RAM       │
 │    - Panggil Ollama API: {"model": "...", "keep_alive": 0}│
 │    - VRAM GPU dan memori RAM terbebas kembali 100%       │
 └─────────────────────────────────────────────────────────┘
```

* **Dampak:** Penggunaan CPU/GPU turun ke **0.0%**. Laptop tetap dingin, kipas hening, dan baterai tahan lama saat mahasiswa di kelas atau perpustakaan.
* **Instant Wake-Up:** Begitu kursor mouse menyentuh area notch, sistem bangun kembali dalam $<100\text{ ms}$, me-restart loop Canvas, dan siap menerima instruksi.

---

## 7. Human-in-the-Loop (HITL) Notch Approval Pill

Saat sub-agen membutuhkan persetujuan manusia untuk aksi berisiko tinggi (menimpa kode, menulis dokumen Word, mengubah pagu modal, atau perintah terminal):

1. **Notch Glow Effect:** Tepi island menyala oranye/amber lembut (*pulsing alert*).
2. **Tampilan Pill:**
   ```text
   ┌─────────────────────────────────────────────────────────────────┐
   │ ⚠️ APPROVAL REQUIRED: Timpa File 'analysis.py'?                 │
   │ Diff: +12 baris, -4 baris (Pembersihan outlier & normalisasi)   │
   │                                                                 │
   │   [✓ Allow / Setujui]    [✎ Edit Argumen]    [✕ Deny / Tolak]   │
   └─────────────────────────────────────────────────────────────────┘
   ```
3. Mengklik **Allow** mengirim payload `decision: "approve"` ke endpoint resume backend secara instan tanpa perlu berpindah jendela ke terminal atau browser.

---

## 8. Ringkasan Komponen Frontend Desktop Companion

| File Komponen | Peran Utama |
| :--- | :--- |
| `src/components/NotchIsland.tsx` | Kontainer utama top-notch overlay, manajemen state FSM, animasi spring Framer Motion (`stiffness: 420, damping: 32, mass: 0.8`), dan copywriting mahasiswa lugas. |
| `src/components/MascotCanvas.tsx` | Loop rendering HTML5 Canvas 2D, celestial starry cosmic orbit, squircle physics, eye projection, smile idle `^ ^`, blush cheeks, sleep rendering 0 FPS, dan layer aksesoris. |
| `src/components/WardrobeStudio.tsx`| Modal lemari pakaian: color picker bertema Warm Obsidian & Terracotta, daftar aksesoris, dan Kanvas Gambar mini $256 \times 256$ dengan undo/pen/eraser. |
| `src/components/HitlApprovalPill.tsx` | Kartu persetujuan risiko tinggi (Badge solid Terracotta `#D95D39`, spring physics `-0.5deg`, proof box `JetBrains Mono`, dan shortcut keyboard `Enter`/`E`/`Esc`). |
| `src/components/ScreenAssistBtn.tsx` | Tombol picu cepat untuk membaca layar/jendela aktif untuk konsultasi materi kuliah atau bug kode. |
| `src/App.tsx` | Main wrapper aplikasi dengan film grain noise overlay (`opacity: 0.025`, `feTurbulence`) dan integrasi state. |

---

## 9. Sistem Desain "Warm Editorial & Tactile Companion" (Anti-AI-Slop)

### 9.1 Larangan AI-Slop vs Standar Karsa
* **Latar Belakang:** Dilarang menggunakan biru-slate AI generik (`#0f172a`) dengan glow neon. Gunakan monokrom hangat: **Warm Paper (`#FAF9F6`)** & **Obsidian Charcoal (`#121212`)**, dipadukan aksen solid tegas **Terracotta (`#D95D39`)** atau **Sage (`#3B7A57`)**.
* **Asimetri Terkontrol:** Angka *Daily Safe Spend* berukuran besar mendominasi kolom kiri menggunakan `Instrument Serif`, indeks berlabel `01 / 02`, dan pemisahan berbasis whitespace halus (`#121212` vs `#171615` vs `#1A1917`).
* **3-Font Pairing:**
  1. `Instrument Serif`: Heading & nominal editorial (`letter-spacing: -0.03em`, `line-height: 1.02`).
  2. `Plus Jakarta Sans`: UI teks & tubuh percakapan utama.
  3. `JetBrains Mono`: Angka token, data transaksi IDR, dan diff kode pada kartu HITL.
* **Tekstur Film Grain & 3-Layer Tinted Shadows:**
  - Latar diberi lapisan SVG `feTurbulence` (2.5% opacity) statis tanpa hambatan klik (`pointer-events: none`).
  - Bayangan berlapis bertingkat: `--shadow-tactile-rest`, `--shadow-tactile-lifted`, dan `--shadow-tactile-notch`.
* **Spring Physics & Micro-Rotations:**
  - Transisi menggunakan `framer-motion` pegas (`stiffness: 420, damping: 32, mass: 0.8`).
  - Kartu dan chip tombol aksi cepat memiliki rotasi mikro asimetris (`hover:-rotate-1`, `hover:rotate-1`) agar terasa taktil dan organik di atas meja belajar mahasiswa.

