import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ChevronUp, ExternalLink } from "lucide-react";
import { WidgetId, useWidgets } from "../context/WidgetsContext";
import { ThemeToggle, useTheme } from "../context/ThemeContext";
import { PomodoroBody } from "./widgets/PomodoroWidget";
import { MediaBody } from "./widgets/MediaWidget";
import { WaterBody } from "./widgets/WaterWidget";
import { TodoBody } from "./widgets/TodoWidget";
import { ShelfBody } from "./widgets/ShelfWidget";
import { ChatBridge } from "./widgets/ChatWidget";
import { SlideErrorBoundary } from "./SlideErrorBoundary";

type SlideId = "pomodoro" | "media" | "water" | "todo" | "shelf";

interface Slide {
  id: SlideId;
  title: string;
  /** Widget this slide can be pulled out as (S / M / L floating widget) */
  widget?: WidgetId;
}

const SLIDE_KEY = "karsa_island_slide";

const SLIDES: Slide[] = [
  { id: "pomodoro", title: "Pomodoro", widget: "pomodoro" },
  { id: "media", title: "Musik", widget: "media" },
  { id: "water", title: "Minum Air", widget: "water" },
  { id: "todo", title: "Todo Cepat", widget: "todo" },
  { id: "shelf", title: "Clip Sementara", widget: "shelf" },
];

/** Five white bars that dance (CSS only, so it costs nothing while the island is idle). */
export const Waveform: React.FC<{ active?: boolean }> = ({ active = true }) => (
  <div className="flex items-end gap-[2px] h-3.5" aria-hidden="true">
    {[0.55, 1, 0.7, 0.9, 0.45].map((h, i) => (
      <span
        key={i}
        className={`w-[2.5px] rounded-full bg-current ${active ? "animate-pulse" : ""}`}
        style={{ height: `${h * 100}%`, animationDelay: `${i * 140}ms`, animationDuration: "900ms", opacity: 0.85 }}
      />
    ))}
  </div>
);

/** Ring that fills as the day passes (real clock, no placeholder). */
const DayRing: React.FC<{ now: Date }> = ({ now }) => {
  const frac = (now.getHours() * 60 + now.getMinutes()) / 1440;
  const r = 7;
  const c = 2 * Math.PI * r;
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
      <circle cx="9" cy="9" r={r} fill="none" stroke="#10B981" strokeWidth="2.4" strokeLinecap="round" strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 9 9)" />
    </svg>
  );
};

const stamp = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

interface IslandDeckProps {
  chat: ChatBridge;
  /** The Music slide needs 440px for its lyrics panel; every other slide stays at 380px */
  onWide: (wide: boolean) => void;
  /** Collapse back to the idle pill (the island otherwise stays on the current module) */
  onCollapse: () => void;
}

/**
 * IslandDeck: the expanded Dynamic Island. The daily micro-utilities (Pomodoro, Music + lyrics, Water, Todo, File Shelf)
 * are swipeable slides here; each can be pulled out as a floating S/M/L widget. The AI automations live in the right dock.
 */
export const IslandDeck: React.FC<IslandDeckProps> = ({ chat, onWide, onCollapse }) => {
  // The island stays on the module you are using: the slide survives collapsing and reopening
  const [index, setIndex] = useState(() => {
    try {
      const n = Number(localStorage.getItem(SLIDE_KEY));
      return Number.isInteger(n) && n >= 0 && n < SLIDES.length ? n : 0;
    } catch (_) {
      return 0;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(SLIDE_KEY, String(index));
    } catch (_) {}
  }, [index]);
  const [dir, setDir] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const { openWidget, setSize, widgets } = useWidgets();
  // A module that is already floating as a widget is not shown a second time in the island
  const visible = SLIDES.filter((sl) => !(sl.widget && widgets[sl.widget]?.open));
  const { isDark } = useTheme();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const visibleKey = visible.map((v) => v.id).join(",");
  const go = useCallback(
    (delta: number) => {
      const ids = visibleKey ? visibleKey.split(",") : [];
      if (!ids.length) return;
      setDir(delta);
      setIndex((i) => {
        const at = ids.indexOf(SLIDES[i].id);
        const next = ids[(at + delta + ids.length) % ids.length];
        return SLIDES.findIndex((sl) => sl.id === next);
      });
    },
    [visibleKey]
  );

  // the current slide was just pulled out as a widget: move on to the next one still in the island
  useEffect(() => {
    const ids = visibleKey ? visibleKey.split(",") : [];
    if (!ids.length || ids.includes(SLIDES[index].id)) return;
    for (let k = 1; k <= SLIDES.length; k++) {
      const cand = SLIDES[(index + k) % SLIDES.length];
      if (ids.includes(cand.id)) {
        setIndex(SLIDES.indexOf(cand));
        return;
      }
    }
  }, [visibleKey, index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      // arrows belong to a text field that has something in it (caret movement); an empty Omni bar lets them swipe
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && (el.tagName !== "INPUT" || (el as HTMLInputElement).value !== "")) return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const slide = SLIDES[index];
  const empty = visible.length === 0;
  useEffect(() => {
    onWide(false);
  }, [onWide]);

  const pullOut = (id: WidgetId) => {
    setSize(id, "M");
    openWidget(id);
  };

  const body = (): React.ReactNode => {
    switch (slide.id) {
      case "pomodoro":
        return <PomodoroBody size="M" />;
      case "media":
        return <MediaBody size="M" />;
      case "water":
        return <WaterBody size="M" />;
      case "todo":
        return <TodoBody size="M" />;
      case "shelf":
        return <ShelfBody size="M" chat={chat} />;
    }
  };

  return (
    <div className="relative w-full h-full flex flex-col gap-1 text-ink">
      <div className="flex items-center justify-between gap-2 flex-shrink-0 h-5 text-[11px]">
        <button type="button" onClick={onCollapse} title="Kecilkan island (Esc)" aria-label="Kecilkan island" className="group/t font-semibold tracking-tight truncate w-[34%] text-left inline-flex items-center gap-1 cursor-pointer">
          <span className="truncate">{empty ? "Island" : slide.title}</span>
          <ChevronUp className="w-3 h-3 flex-shrink-0 text-ink-muted opacity-0 group-hover/t:opacity-100 transition-opacity" />
        </button>
        <span className="flex items-center gap-1.5 font-mono text-ink-2 whitespace-nowrap">
          <DayRing now={now} />
          {stamp(now)}
        </span>
        <span className="flex items-center justify-end gap-1.5 w-[34%] text-ink-2">
          <ThemeToggle />
          {!empty && <button
            type="button"
            onClick={() => pullOut(slide.widget as WidgetId)}
            className="h-5 px-2 rounded-full karsa-grad text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer"
            title="Tarik keluar jadi widget mengambang (S / M / L)"
            aria-label={`${slide.title} sebagai widget`}
          >
            <ExternalLink className="w-3 h-3" />
            Widget
          </button>}
        </span>
      </div>

      <div className="group relative flex-1 min-h-0">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={slide.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -36 }}
            transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.7 }}
            className="absolute inset-0 karsa-nested !rounded-[18px] px-3 py-1.5 overflow-hidden"
          >
            <SlideErrorBoundary slideName={slide.title} isDark={isDark}>
              {empty ? <div className="h-full flex items-center justify-center text-[11px] text-ink-muted text-center">Semua modul sedang jadi widget mengambang. Tutup salah satu untuk menampilkannya di sini.</div> : body()}
            </SlideErrorBoundary>
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          onClick={() => go(-1)}
          className="absolute -left-[13px] top-1/2 -translate-y-1/2 w-3.5 h-7 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label="Slide sebelumnya"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          className="absolute -right-[13px] top-1/2 -translate-y-1/2 w-3.5 h-7 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer z-10 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
          aria-label="Slide berikutnya"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="flex-shrink-0 h-2 flex items-center justify-center gap-1.5">
        {visible.map((sl) => {
          const i = SLIDES.indexOf(sl);
          return (
          <button
            key={sl.id}
            type="button"
            onClick={() => {
              setDir(i > index ? 1 : -1);
              setIndex(i);
            }}
            aria-label={sl.title}
            aria-current={i === index}
            className={`h-1 rounded-full transition-all cursor-pointer ${i === index ? "w-3.5 bg-ink" : "w-1 bg-ink-muted/50"}`}
          />
          );
        })}
      </div>
    </div>
  );
};

export default IslandDeck;
