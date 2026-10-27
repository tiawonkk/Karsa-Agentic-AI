import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink, Maximize2 } from "lucide-react";
import { WidgetId, useWidgets } from "../context/WidgetsContext";
import { ThemeToggle, useTheme } from "../context/ThemeContext";
import { WIDGET_DEFS } from "./widgets/WidgetLayer";
import { PomodoroBody } from "./widgets/PomodoroWidget";
import { MediaBody } from "./widgets/MediaWidget";
import { WaterBody } from "./widgets/WaterWidget";
import { TodoBody } from "./widgets/TodoWidget";
import { ShelfBody } from "./widgets/ShelfWidget";
import { ChatBridge } from "./widgets/ChatWidget";
import { SlideErrorBoundary } from "./SlideErrorBoundary";
import { openStudio } from "../stores/studioMode";

type SlideId = "omni" | "pomodoro" | "media" | "water" | "todo" | "shelf" | "more";

interface Slide {
  id: SlideId;
  title: string;
  /** Widget this slide can be pulled out as (S / M / L floating widget) */
  widget?: WidgetId;
}

const SLIDES: Slide[] = [
  { id: "omni", title: "Karsa" },
  { id: "pomodoro", title: "Pomodoro Focus", widget: "pomodoro" },
  { id: "media", title: "Musik", widget: "media" },
  { id: "water", title: "Minum Air", widget: "water" },
  { id: "todo", title: "Todo Cepat", widget: "todo" },
  { id: "shelf", title: "Clip Sementara", widget: "shelf" },
  { id: "more", title: "Lainnya" },
];

const MORE: WidgetId[] = ["today", "finance", "chat", "approvals", "notebook", "studio"];

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

const stamp = (d: Date) =>
  `${d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).replace(",", "")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

interface IslandDeckProps {
  /** Slide 0: the Omni command bar */
  omni: React.ReactNode;
  chat: ChatBridge;
  onCollapse: () => void;
}

/**
 * IslandDeck: the expanded Dynamic Island. The daily micro-utilities (Pomodoro, Music + lyrics, Water, Todo, File Shelf)
 * are swipeable slides here; each can be pulled out as a floating S/M/L widget. The AI automations live in the right dock.
 */
export const IslandDeck: React.FC<IslandDeckProps> = ({ omni, chat, onCollapse }) => {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const { openWidget, setSize, toggleOpen } = useWidgets();
  const { isDark } = useTheme();

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);

  const go = useCallback((delta: number) => {
    setDir(delta);
    setIndex((i) => (i + delta + SLIDES.length) % SLIDES.length);
  }, []);

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

  const pullOut = (id: WidgetId) => {
    setSize(id, "M");
    openWidget(id);
  };

  const body = (): React.ReactNode => {
    switch (slide.id) {
      case "omni":
        return omni;
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
      case "more":
        return (
          <div className="grid grid-cols-3 gap-2 h-full content-center">
            {MORE.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => toggleOpen(id)}
                className="karsa-nested h-14 flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-ink cursor-pointer active:scale-95 transition-transform"
              >
                <span style={{ color: WIDGET_DEFS[id].accent }}>{WIDGET_DEFS[id].launcherIcon}</span>
                {WIDGET_DEFS[id].title}
              </button>
            ))}
          </div>
        );
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-1 text-ink">
      {slide.id !== "omni" && (
        <div className="flex items-center justify-between gap-2 flex-shrink-0 h-6">
          <span className="text-[12px] font-semibold tracking-tight truncate w-[34%]">{slide.title}</span>
          <span className="flex items-center gap-1.5 text-[10.5px] font-mono text-ink-2 whitespace-nowrap">
            <DayRing now={now} />
            {stamp(now)}
          </span>
          <span className="flex items-center justify-end gap-1.5 w-[34%] text-ink-2">
            <Waveform />
            <ThemeToggle />
            {slide.widget && (
              <button
                type="button"
                onClick={() => pullOut(slide.widget as WidgetId)}
                className="h-6 px-2 rounded-full karsa-grad text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                title="Tarik keluar jadi widget mengambang (S / M / L)"
                aria-label={`${slide.title} sebagai widget`}
              >
                <ExternalLink className="w-3 h-3" />
                Widget
              </button>
            )}
            <button
              type="button"
              onClick={() => openStudio()}
              className="w-6 h-6 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer"
              title="Mode Aplikasi Besar (Alt+Shift+K)"
              aria-label="Mode Aplikasi Besar"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      <div className="relative flex-1 min-h-0">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={slide.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -36 }}
            transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.7 }}
            className={`absolute inset-0 ${slide.id === "omni" ? "" : "karsa-nested px-3 py-2 overflow-hidden"}`}
          >
            <SlideErrorBoundary slideName={slide.title} isDark={isDark}>
              {body()}
            </SlideErrorBoundary>
          </motion.div>
        </AnimatePresence>

        <button
          type="button"
          onClick={() => go(-1)}
          className="absolute -left-2.5 top-1/2 -translate-y-1/2 w-5 h-8 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer z-10"
          aria-label="Slide sebelumnya"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          className="absolute -right-2.5 top-1/2 -translate-y-1/2 w-5 h-8 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer z-10"
          aria-label="Slide berikutnya"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex items-center justify-center gap-1.5 h-3.5 flex-shrink-0">
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setDir(i > index ? 1 : -1);
              setIndex(i);
            }}
            aria-label={s.title}
            aria-current={i === index}
            className={`h-1.5 rounded-full transition-all cursor-pointer ${i === index ? "w-4 bg-ink" : "w-1.5 bg-ink-muted/50"}`}
          />
        ))}
        <button
          type="button"
          onClick={onCollapse}
          className="absolute right-3.5 bottom-1.5 text-[9px] text-ink-muted hover:text-ink cursor-pointer"
          title="Kecilkan (Esc)"
        >
          Esc
        </button>
      </div>
    </div>
  );
};

export default IslandDeck;
