import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Banknote,
  ChevronUp,
  CheckSquare,
  Code2,
  Monitor,
  PenTool,
  Search,
} from "lucide-react";
import { MascotCanvas } from "./MascotCanvas";
import { ThemeToggle } from "../context/ThemeContext";

interface AppItem {
  name: string;
  path: string;
}

interface NotchBarProps {
  isDark: boolean;
  mascotColor: string;
  eyeColor: string;
  activeAccessory: string | null;
  isSleeping: boolean;
  focusTrigger: number;
  onSubmit: (text: string) => void;
  onCollapse: () => void;
  onOpenWardrobe: () => void;
}

const DIRECTIVES: Array<{ cmd: string; icon: React.ReactNode; hint: string }> = [
  { cmd: "@Money", icon: <Banknote className="w-3.5 h-3.5" />, hint: "Catat pengeluaran & cek safe spend" },
  { cmd: "@Search", icon: <Search className="w-3.5 h-3.5" />, hint: "Cari paper ilmiah (arXiv/Crossref)" },
  { cmd: "@Todo", icon: <CheckSquare className="w-3.5 h-3.5" />, hint: "Tambah tugas (Eisenhower P1-P4)" },
  { cmd: "@Study", icon: <BookOpen className="w-3.5 h-3.5" />, hint: "Rangkum materi kuliah" },
  { cmd: "@Write", icon: <PenTool className="w-3.5 h-3.5" />, hint: "Draf karya ilmiah (IMRaD .docx)" },
  { cmd: "@Data", icon: <BarChart3 className="w-3.5 h-3.5" />, hint: "Profiling dataset .csv/.xlsx" },
  { cmd: "@Code", icon: <Code2 className="w-3.5 h-3.5" />, hint: "Bantuan kode & debugging" },
  { cmd: "@Screen", icon: <Monitor className="w-3.5 h-3.5" />, hint: "Baca layar aktif (dengan izin)" },
];

/**
 * NotchBar: the expanded micro-notch (380x115). Mascot on the left; on the right a header (clock, theme toggle,
 * collapse), the quick command input, and a row of @Directive launchers. Typing a plain name searches the real
 * Windows Start Menu index; Enter launches the first match.
 */
export const NotchBar: React.FC<NotchBarProps> = ({
  isDark,
  mascotColor,
  eyeColor,
  activeAccessory,
  isSleeping,
  focusTrigger,
  onSubmit,
  onCollapse,
  onOpenWardrobe,
}) => {
  const [value, setValue] = useState("");
  const [time, setTime] = useState("");
  const [apps, setApps] = useState<AppItem[]>([]);
  const [launchNote, setLaunchNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const tick = () =>
      setTime(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusTrigger]);

  // Start Menu app search (debounced); skipped for @Directives
  useEffect(() => {
    const q = value.trim();
    if (q.length < 2 || q.startsWith("@")) {
      setApps([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/v1/system/apps?q=${encodeURIComponent(q)}`);
        if (res.ok && !cancelled) {
          const d = await res.json();
          setApps(Array.isArray(d?.apps) ? d.apps.slice(0, 4) : []);
        }
      } catch (_) {}
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [value]);

  const launch = async (app: AppItem) => {
    setLaunchNote(`Membuka ${app.name}…`);
    try {
      await fetch("/api/v1/system/apps/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: app.path }),
      });
    } catch (_) {}
    setValue("");
    setApps([]);
    setTimeout(() => setLaunchNote(null), 1500);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;
    if (!v.startsWith("@") && apps.length > 0) {
      launch(apps[0]);
      return;
    }
    onSubmit(v);
    setValue("");
  };

  const rect = inputRef.current?.getBoundingClientRect();

  return (
    <div className="w-full h-full flex items-center gap-2 text-ink">
      <div
        onClick={onOpenWardrobe}
        className="w-[96px] h-full flex-shrink-0 flex items-center justify-center cursor-pointer active:scale-95 transition-transform pointer-events-auto"
        title="Karsa — klik untuk Wardrobe 🎨"
      >
        <MascotCanvas
          size={40}
          bodyColor={mascotColor}
          eyeColor={eyeColor}
          accessoryImage={activeAccessory}
          isSleeping={isSleeping}
          isDark={isDark}
          showStarOrbit={false}
        />
      </div>

      <div className="flex-1 min-w-0 h-full flex flex-col justify-between py-0.5">
        <div className="flex items-center justify-between">
          <span className="font-mono font-bold text-[12px] tracking-tight">{time}</span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <button
              type="button"
              onClick={onCollapse}
              className="w-6 h-6 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer"
              title="Kecilkan (Esc)"
              aria-label="Kecilkan"
            >
              <ChevronUp className="w-3.5 h-3.5" strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <form onSubmit={submit} className="relative flex items-center">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={launchNote ?? "Ketik @Money, @Todo atau nama aplikasi…"}
            className="w-full h-8 pl-3 pr-8 rounded-full bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent font-sans"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="absolute right-1 w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-30 cursor-pointer"
            title="Kirim (Enter)"
            aria-label="Kirim"
          >
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>

        <div className="flex items-center justify-between">
          {DIRECTIVES.map((d) => (
            <button
              key={d.cmd}
              type="button"
              onClick={() => {
                setValue(`${d.cmd} `);
                inputRef.current?.focus();
              }}
              title={`${d.cmd} — ${d.hint}`}
              aria-label={d.cmd}
              className="w-[26px] h-[26px] rounded-full bg-pill text-ink-2 hover:text-ink hover:brightness-110 flex items-center justify-center cursor-pointer active:scale-95 transition-all"
            >
              {d.icon}
            </button>
          ))}
        </div>
      </div>

      {/* App search results: portaled so the notch's overflow clipping cannot cut them */}
      {apps.length > 0 &&
        rect &&
        createPortal(
          <div
            className="karsa-surface fixed z-[60] rounded-2xl p-1.5 pointer-events-auto font-sans"
            style={{ top: rect.bottom + 8, left: rect.left, width: Math.max(rect.width, 220) }}
          >
            {apps.map((a, i) => (
              <button
                key={a.path}
                type="button"
                onClick={() => launch(a)}
                className={`w-full text-left px-2.5 py-1.5 rounded-xl text-[12px] flex items-center justify-between gap-2 cursor-pointer hover:bg-pill text-ink ${
                  i === 0 ? "bg-pill" : ""
                }`}
              >
                <span className="truncate font-medium">{a.name}</span>
                {i === 0 && <span className="text-[9px] font-mono text-ink-muted flex-shrink-0">Enter</span>}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
};

export default NotchBar;
