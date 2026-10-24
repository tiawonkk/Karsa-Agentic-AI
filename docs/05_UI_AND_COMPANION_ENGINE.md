# UI & Companion Engine Specification: Project Karsa
**(macOS Liquid Glass, Compact Dynamic Island, Mochi Mascot, & Draggable Widgets)**

> **Versi Dokumen:** 2.0 · **Terakhir diperbarui:** 2026-10-23
> **Menggantikan** versi 1.0 (island 540px, palet "Warm Editorial"); versi lama masih ada di riwayat git (commit `30fc750`).

> **Arsitektur v3 (2026-10-23): Dual-Zone + Widget.** Menggantikan carousel 6-slide di dalam Notch.
>
> - **Tema:** CSS variables di `index.css` (`--bg-glass`, `--bg-card`, `--bg-pill`, `--border-subtle`, `--text-primary/secondary/muted`, `--accent-primary`, `--shadow-soft`) dengan `data-theme` + class `.dark` pada `<html>`. `ThemeContext` menyimpan pilihan di localStorage dan tabel `system_settings` (`ui.theme`, `GET/PUT /api/v1/settings/theme`). Tombol `☀️/🌙` ada di Notch (bar expanded) dan header Right-Side Dock. **Semua** surface (Notch, Dock, widget, Settings, Wardrobe, popup) memakai variabel yang sama; tidak ada lagi notch yang selalu hitam.
> - **Zona A, Micro-Notch (`NotchShell`/`NotchBar`):** idle 145x30; peek 220x40; OSD toast 265x40; expanded 380x115 (maskot Mochi kiri, jam, toggle tema, input `@Directive`/pencari aplikasi Start Menu, 8 ikon peluncur direktif).
> - **Zona B, Right-Side Dock (`RightSideDock`):** 275px, `min-h 260 / max-h 78vh`, collapsible menjadi tab 8x64. Header: toggle tema, badge status AI, Settings, Wardrobe. Isi: widget yang di-dock + baris peluncur 6 widget.
> - **Widget (`widgets/ResizableWidget.tsx` = `WidgetContainer`):** Pomodoro, Water, Todo, Finance, Media, AI Chat. Ukuran **S** nano pill 150x40, **M** kartu 250x155, **L** 310x280; widget floating juga bisa di-resize bebas dari sudut kanan bawah (layout dipilih dari dimensi). Header: `[S|M|L]` `[⇄ dock/undock]` `[— minimize ke S]` `[× tutup]`. State widget (open/docked/size/posisi) disimpan di localStorage (`karsa_widgets_v1`). Pomodoro berjalan di `stores/pomodoroStore.ts` (di luar React) sehingga timer tidak hilang saat widget dipindah/ditutup.
> - Dock dan widget floating di-portal ke `document.body` (Notch punya `transform`, yang akan men-anchor ulang elemen `fixed`). Saat Zero-Heat Sleep aktif, dock dan widget tidak di-mount.
>
> - **Visibilitas widget:** kartu memakai `.karsa-widget` (permukaan hampir opak `--bg-widget`, tepi `--border-strong`, bayangan `--shadow-widget`) plus garis aksen 2.5px berwarna per modul di sisi atas. Saat backend mati, widget menampilkan state "Server Karsa tidak terjangkau" + tombol *Coba lagi*, bukan spinner tanpa akhir.
> - **Tarik keluar dari Dock:** seret header (atau pill S) widget yang di-dock; ia tetap di tempat selama kursor masih di dalam panel Dock, lalu terlepas dan mengikuti kursor begitu keluar. Hint zona drop sama dengan widget floating.
> - **Gestur widget floating:** seret ke tepi kiri layar untuk menyembunyikan (hint glow + label), seret ke atas Dock untuk memasukkan (hint outline), klik dua kali header/pill untuk menyembunyikan. Tekan ikon peluncurnya lagi di Dock (atau `Alt+1..6`) untuk menampilkan/menyembunyikan. Posisi terakhir selalu dijaga agar widget muncul kembali di dalam layar.
> - **Tombol pill S:** `[⇄ lepas/masukkan] [⤢ perbesar] [× tutup]` muncul saat hover di sisi kiri-atas pill sehingga tidak menutupi tombol aksi (play/minum/kirim) di kanan.
> - **Peluncur Dock hidup:** badge menit Pomodoro yang sedang berjalan (berdenyut) dan jumlah tugas P1 yang belum selesai, juga saat widgetnya disembunyikan. Pill S Pomodoro/Water punya garis progres tipis di bawahnya.
>
> - **Tombol fungsi di Dynamic Island:** F1-F12 dan tombol media (Play/Pause, Next, Previous, Stop) muncul sebagai toast OSD 265x40 (cincin ungu berisi nama tombol + arti standar Windows, mis. `F5 · Muat Ulang`, `Alt+F4 · Tutup Jendela`). Dibaca backend (`osd://fkey`), hanya nama tombol-tombol itu yang diperiksa dan tidak ada yang disimpan; matikan dengan `KARSA_FKEY_OSD=false`.
> - **Widget Notebook (ungu, Alt+7):** gaya NotebookLM. Tab **Sumber** (tarik file PDF/DOCX/PPTX/TXT/MD/CSV/XLSX atau tempel teks), **Tanya** (jawaban hanya dari sumber dengan sitasi `[n]` yang bisa dibuka kutipannya), **Studio** (Briefing, Panduan Belajar, Draf IMRaD + ekspor `.docx`, dan Pembersih Dataset: pratinjau, lalu simpan sebagai file `_clean` baru). Menjatuhkan file riset di Notch menambahkannya ke notebook aktif. Tanpa API key, semua keluaran memakai mode ekstraktif (cuplikan asli sumber, bukan karangan).
> Bagian 3-5 di bawah (geometri island 430px dan 6 slide) adalah rancangan v2 dan **sudah digantikan** oleh arsitektur di atas.

## 1. PERAN & PRINSIP UTAMA DESAIN (GOLDEN UI RULES)
Antarmuka desktop lintas platform dibangun dengan **Tauri v2 + React + TypeScript + Tailwind CSS + Framer Motion** (komponen gaya Shadcn) dan responsif sebagai **Progressive Web App (PWA)** di ponsel.

Patuhi **5 Hukum Mutlak Desain Desktop Karsa** di seluruh komponen:
1. **100% NON-BLOCKING DESKTOP (DILARANG MENUTUPI/MEM-BLUR LAYAR KERJA):**
   - Karsa adalah asisten pendamping kerja harian (*daily driver*), BUKAN halaman web layar penuh.
   - **DILARANG** membuat lapisan `<div className="fixed inset-0 bg-black/... backdrop-blur-...">` yang mengunci atau memburamkan layar.
   - `html`, `body`, dan `#root` wajib `background: transparent !important;`; wrapper terluar wajib `pointer-events-none`.
   - `pointer-events-auto` HANYA dipasang pada kontainer *Dynamic Island* dan kartu *Floating Widget* yang aktif, sehingga sisa desktop 100% tembus pandang dan tembus klik (*click-through*).
2. **COMPACT PROPORTIONS (GAYA NOTCHNOOK / NUSA / COUCOU):**
   - Jangan membuat jendela raksasa. Gunakan ukuran mikro yang ramping dan proporsional terhadap resolusi serta DPI monitor (`clamp()`).
   - Semua detail panjang (chat, pengaturan model/API, kanvas aksesoris, laporan riset) dibuka sebagai **Compact Draggable Floating Widget** yang bisa digeser ke sudut layar mana pun.
3. **UNIFIED HIGH-LUMINANCE LIQUID GLASS (TIDAK PUCAT & TIDAK BELANG):**
   - Semua komponen (`NotchShell`, `ChatWidget`, `SettingsWidget`, `WardrobeWidget`, `SystemToastPill`) membaca satu state tema global (`SystemContext`: `light` | `dark` | `system`).
   - Dilarang satu jendela putih sementara jendela lain abu-abu kusam atau hitam sendiri.
4. **WCAG AAA HIGH CONTRAST & NO CLIPPING:**
   - Dilarang teks putih/abu-abu muda di atas latar terang.
   - Dilarang tombol atau header terpotong (*clipping*). Gunakan grid lega dan `flex-wrap`.
5. **ZERO DUMMY DATA & DEFENSIVE UI:**
   - Dilarang saldo palsu, tugas bohongan, atau lagu palsu. Semua terhubung ke SQLite lokal dan API OS asli dengan *safe fallback* (mis. `(data?.hourly_logs ?? []).slice(0, 6)`) dan dibungkus `<ErrorBoundary>`.

---

## 2. SISTEM TIPOGRAFI, PALET WARNA, & MATERIAL LIQUID GLASS

### 2.1 Pasangan Tipografi (Google Fonts)
Impor dan kunci di `tailwind.config` serta CSS global:
- **`font-sans` — UI, Judul, Narasi:** **Poppins** (400, 500, 600, 700). Gunakan `font-semibold tracking-tight` untuk judul slide, tombol, dan label.
- **`font-mono` — Angka, Jam, Timer, IDR, Token, Direktif `@`:** **JetBrains Mono** (500, 600, 700). Wajib pada jam header, hitung mundur Pomodoro (`25:00`), nominal IDR, metrik token, persentase baterai/volume, dan lencana `@Money` s.d. `@Screen`.

### 2.2 Token Material: macOS Ceramic & Obsidian Liquid Glass
Jangan gunakan transparansi rendah (`bg-white/40`) yang menjadi abu-abu keruh di atas wallpaper gelap.

#### A. Light Glass Mode
- **Surface Utama (Notch & Floating Widgets):**
  ```css
  background: linear-gradient(145deg, rgba(255, 255, 255, 0.95) 0%, rgba(248, 250, 252, 0.90) 100%);
  backdrop-filter: blur(32px) saturate(200%);
  -webkit-backdrop-filter: blur(32px) saturate(200%);
  border: 1px solid rgba(226, 232, 240, 0.9);
  box-shadow: 0 14px 36px -6px rgba(15, 23, 42, 0.12), inset 0 1px 1px rgba(255, 255, 255, 1);
  color: #0F172A;
  ```
- **Elemen Dalam (Input, Chip `@Directive`, Kartu Sekunder):** `bg-slate-100/85 hover:bg-slate-200/80 border border-slate-200/90 text-slate-900 placeholder:text-slate-400`
- **Teks Utama & Angka Timer:** `#0F172A` · **Teks Sekunder:** `#475569`

#### B. Dark Glass Mode
- **Surface Utama:**
  ```css
  background: linear-gradient(145deg, rgba(20, 20, 25, 0.92) 0%, rgba(12, 12, 16, 0.88) 100%);
  backdrop-filter: blur(32px) saturate(180%);
  -webkit-backdrop-filter: blur(32px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow: 0 18px 44px -8px rgba(0, 0, 0, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.15);
  color: #F8FAFC;
  ```
- **Elemen Dalam:** `bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 text-zinc-100 placeholder:text-zinc-500`
- **Teks Utama & Angka Timer:** `#F8FAFC` · **Teks Sekunder:** `#94A3B8`

### 2.3 Aksen Gradasi Segar
- **Chip `@Directive` monokrom:** `@Money`, `@Search`, `@Todo`, `@Study`, `@Write`, `@Data`, `@Code`, `@Screen` memakai kapsul kaca netral seragam (`rounded-full px-2.5 py-1 font-mono text-[11px] font-medium transition-all active:scale-95`) dengan ikon kecil yang bersih. Tanpa warna pelangi.
- **Warm Sunrise (Play/Action, Highlight, Progress utama):** `bg-gradient-to-r from-[#FF9A8B] via-[#FF6A88] to-[#6366F1] text-white shadow-sm`
- **Fresh Emerald (Tasks & Budget):** `bg-gradient-to-r from-[#059669] via-[#10B981] to-[#34D399]`
- **Sky Aqua (Water Reminder):** `bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8]`

### 2.4 Tombol Kontrol Jendela (`Pin 📌`, `Minimize —`, `Delete 🗑️`, `Close ×`)
- Ukuran: `w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer`
- Light: `bg-slate-200/85 hover:bg-slate-300 text-slate-800` (Close hover: `hover:bg-rose-500 hover:text-white`)
- Dark: `bg-white/10 hover:bg-white/20 text-zinc-100` (Close hover: `hover:bg-rose-500 hover:text-white`)
- Ikon Lucide: `strokeWidth={2.25}`, ukuran `w-3.5 h-3.5`.

---

## 3. GEOMETRI DYNAMIC ISLAND & SEAMLESS S-CURVE BEZEL EARS (`NotchShell.tsx`)

### 3.1 Telinga Lengkung Menyatu (Seamless S-Curve Shoulders)
- Pulau menempel di tengah atas layar (`top: 0`, `left: 50%`, `transform: translateX(-50%)`).
- Bahu *concave S-curve ears* (`16px × 16px`) **DILARANG** berwarna hitam statis terpisah dan dilarang memiliki `border-left` / `border-right` pemisah.
- Render ears dengan variabel latar `--island-surface` yang 100% identik dengan bodi tengah (atau satu path SVG / mask terpadu) sehingga pulau mengalir mulus dari bingkai atas layar.

### 3.2 Empat State Ukuran Adaptif
Transisi pegas: `transition={{ type: "spring", stiffness: 400, damping: 30, mass: 0.8 }}`.
1. **Idle / Compact Pill (`155px × 32px`):** dua mata kapsul Karsa berkedip halus, atau cincin hijau di kiri + jam digital (`HH:mm`, JetBrains Mono) di tengah + 4 batang gelombang audio di kanan.
2. **Peek Hover (`220px × 40px`):** membal saat kursor mendekati tepi atas; sapaan singkat maskot dan sisa *Daily Safe Spend* hari ini.
3. **Hardware OSD Toast (`265px × 40px`, `rounded-full`):** menggantikan pop-up bawaan Windows untuk `F1`–`F12` (Volume, Mute, Brightness), `CapsLock`, `NumLock`, Battery Charger, Bluetooth Audio. Kiri: cincin ikon berwarna (hijau Battery/CapsLock, biru Volume/Bluetooth, amber Brightness). Tengah: nama status (`Poppins text-xs font-semibold`). Kanan: persentase (`JetBrains Mono text-xs font-bold`). Menyusut kembali setelah 1,8 detik.
4. **Expanded Interactive Island (`width: 430px`, `min-height: 165px`, `height: auto`, `padding: 12px 16px`):** tiga baris (`Header 28px`, `Body 1fr`, `Footer Pagination 22px`) tanpa tumpang tindih. Mendukung *swipe/drag* horizontal (`drag="x"`), *wheel scroll* horizontal, dan tombol panah bulat `<` `>` di kiri-kanan bawah.

---

## 4. DESAIN MASKOT KARSA (MINIMALIST COUCOU MOCHI) & WARDROBE STUDIO

### 4.1 Karakter Mochi Bersih (`MascotCanvas.tsx`)
Tanpa partikel bintik merah/debu kasar. Digambar bersih di HTML5 Canvas 2D:
- **Tubuh:** *Pillowy Squircle* (`46px × 38px` di dalam Notch), gradien putih mutiara (`#FFFFFF` → `#F1F5F9`), highlight tipis di tepi atas, bayangan elips lembut di bawah.
- **Wajah & Mata:** default dua garis lengkung gembira (`⌒   ⌒`) atau dua mata oval hitam mengkilap yang melirik mengikuti kursor dengan inersia pegas. Pipi merona pastel (*soft blush* opasitas 18%).
- **Tangan Bulat Melayang (*Floating Paws*):** dua bola `10px` di kiri-kanan tubuh, terhubung elastis. Ekspresi kontekstual: melambai saat kursor mendekat, memegang koin (`@Money`), kaca pembesar (`@Search`/`@Screen`), stopwatch (Pomodoro berjalan), mengetik (`@Code`), dan merapatkan tangan di bawah pipi (`Zzz`) saat **Zero-Heat Sleep Mode** (0 FPS; CPU/GPU 0%).
- **Mini Companion Badge:** di slide selain Home, avatar mini Karsa (`24px`) di header bereaksi sesuai slide aktif.

### 4.2 Kustomisasi Warna & Kanvas Aksesoris (`WardrobeWidget.tsx`)
- Compact Draggable Widget (`330px`) bertema Liquid Glass seragam.
- **Tab 1 (Warna & Energi):** warna tubuh dan mata maskot, serta **Token Energy Bar** (persentase kuota token harian/bulanan dan estimasi biaya IDR dari `token_logs`).
- **Tab 2 (Kanvas Aksesoris):** *Drawing Pad* (`200px × 160px`; kuas halus, ketebalan, *color picker*, penghapus, *undo*, tombol *Simpan ke Kepala Maskot*) untuk topi, kacamata, atau pita; disimpan sebagai PNG transparan di SQLite (`wardrobe_items`).

---

## 5. SPESIFIKASI 6 SLIDE INTERAKTIF DI DALAM NOTCH
Semua slide dalam Expanded Island (`430px`) rapi, lega, dan bebas komponen terpotong.

1. **Slide 1 — Karsa Home (`HomeSlide.tsx`):**
   - **Kiri (`105px`):** panggung maskot + kapsul mungil `🎨 Wardrobe`.
   - **Kanan (`1fr`):** input cepat (`h-8 rounded-full px-3 text-xs`, placeholder `"Ketik @Money, @Todo, @Search..."`, tombol kirim `→`) dan 8 chip direktif (`@Money`, `@Search`, `@Todo`, `@Study`, `@Write`, `@Data`, `@Code`, `@Screen`) dengan `flex flex-wrap gap-1.5` (4 per baris, `px-2.5 py-1 text-[11px] font-mono`) tanpa terpotong.
2. **Slide 2 — OmniSearch & Windows App Launcher (`OmniSearchSlide.tsx`):** bar pencarian terpadu (`Alt + Space`). Nama aplikasi (`vscode`, `chrome`, `word`, `spotify`) → daftar aplikasi asli Start Menu dengan ikon; `Enter` membuka. Awalan `@` → autocomplete parameter direktif. Tombol `Scan # @...` di kanan atas memindai komentar `# @Search ...` / `// @Todo ...` pada workspace aktif.
3. **Slide 3 — Pomodoro (`PomodoroSlide.tsx`):** kiri: cincin progres SVG dan hitung mundur (`25:00`, JetBrains Mono `text-3xl font-bold`). Klik angka atau `⚙️` untuk mengatur *Focus* (`15/25/45/60`), *Short Break* (`5/10`), *Long Break* (`15/30`) plus `-5m` / `+5m`. Toggle suara `🔔/🔕`; pada `00:00` bunyikan chime Web Audio, tampilkan OS Desktop Notification, simpan sesi ke `focus_sessions`.
4. **Slide 4 — Water Reminder (`HydrationSlide.tsx`):** kiri: `0.0 / 2.0 L` (`text-2xl font-bold`), progress *Sky Aqua*, tombol `+ Drink (250ml)` (INSERT ke SQLite), `⚙️ Settings`. Settings: toggle pengingat, interval (`1 Jam`, `1.5 Jam`, `2 Jam [Default]`, `3 Jam`), target harian (`1500`–`3000 ml`), ukuran gelas. Kanan: **6 batang kapsul vertikal** (`w-2.5 h-14 rounded-full bg-slate-200/80 dark:bg-white/10 overflow-hidden flex items-end`) untuk jam `08, 11, 14, 17, 20, 22`, tinggi proporsional dari SQLite.
5. **Slide 5 — Media Player & Live Lyrics (`MediaSlide.tsx`):** sampul, judul, artis, progress, kontrol dari sesi media OS (Windows GSMTC). Tanpa lagu: `"Tidak ada musik diputar"`. Progress bar memakai timeline OS asli (`position_s`/`duration_s`); tombol ⏮ ⏯ ⏭ memanggil `POST /api/v1/system/media/control` (`play_pause` | `next` | `previous`). Tombol `💬 Lirik` membuka split-view lirik tersinkron dari `https://lrclib.net/api/get` dengan baris aktif tersorot real-time.
6. **Slide 6 — TodoList (P1–P4) & Smart File Shelf (`TodoSlide.tsx`):** dua tab: `Checklist Tugas` dan `File Shelf`. Checklist murni dari tabel `tasks`; `+ Tugas` memilih `🔴 P1 · Kritis`, `🟠 P2 · Penting`, `🔵 P3 · Normal`, `🟢 P4 · Santai`. File Shelf: dropzone garis putus-putus; foto struk → OCR `@Money`, PDF → `@Study`/`@Search`, CSV → `@Data`.

---

## 6. COMPACT DRAGGABLE FLOATING WIDGETS (`width: 335px`)
Berlaku untuk `ChatWidget`, `SettingsWidget`, `WardrobeWidget`, `HitlApprovalWidget`:
1. **Ukuran & Posisi:** lebar `335px`, tinggi maks `390px` (`overflow-y-auto`), `rounded-2xl`, muncul di bawah/samping Notch tanpa mem-blur desktop.
2. **Draggable:** `<motion.div drag dragControls={dragControls} dragListener={false} dragMomentum={false}>`; drag lewat bar judul.
3. **Header:** ikon + judul (`Poppins text-xs font-semibold`), badge status koneksi AI yang sinkron, tombol **Pin**, **Minimize ke pill mungil**, **Close**.

### 6.1 `SettingsWidget.tsx`
- Tanpa placeholder titik-titik (`••••••••`). Placeholder jujur: `"Tempel Gemini API Key (AIzaSy...)"`.
- Tombol **`Simpan & Hubungkan`** di samping input (dengan tombol mata Show/Hide): simpan ke `system_settings` via `POST /api/settings/keys`, jalankan *live ping test* ke Gemini / DeepSeek / Ollama, lalu perbarui badge global Settings dan Chat serentak menjadi **`🟢 Gemini Active`** (atau tampilkan error asli).
- **3 Tab:** `Models & API` (RAM/VRAM asli, `Turbo GPU` vs `Eco CPU`, Auto-Routing: harian/keuangan → Gemini Flash; riset/coding → DeepSeek / Gemini Pro, statistik token & biaya IDR), `Modules` (toggle 5 modul), `Appearance` (`Light Glass`, `Dark Glass`, `System`, ukuran Notch, timer Auto-Sleep).

### 6.2 `ChatWidget.tsx` & `HitlApprovalWidget.tsx`
- **Chat:** bubble pengguna `bg-slate-900 text-white` (Light) dan `bg-white/15 text-zinc-100` (Dark). Mendukung tabel ringkas, kartu *Daily Safe Spend*, tombol unduh `.docx`.
- **HITL:** muncul otomatis saat LangGraph `interrupt()` pada aksi berisiko tinggi (menimpa kode, menimpa `.docx`, mengubah modal bulanan, perintah terminal destruktif) dengan cuplikan perubahan (JetBrains Mono) dan tombol **`Izinkan (Enter)`**, **`Ubah (E)`**, **`Batal (Esc)`**.

---

## 7. INSTRUKSI EKSEKUSI & VERIFIKASI VISUAL
1. Spesifikasi ini disimpan di `docs/05_UI_AND_COMPANION_ENGINE.md`.
2. Terapkan token CSS Liquid Glass, font Poppins + JetBrains Mono, hapus fullscreen backdrop blur, satukan S-curve ears, maskot Mochi bersih, perbaiki 6 slide, dan widget draggable.
3. Jalankan `npm run build` (0 error TypeScript/CSS), lalu catat pembaruan di `docs/00_PROJECT_MEMORY.md`.
