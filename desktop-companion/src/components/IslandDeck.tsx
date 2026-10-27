import React, { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
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
}

/**
 * IslandDeck: the expanded Dynamic Island. The daily micro-utilities (Pomodoro, Music + lyrics, Water, Todo, File Shelf)
 * are swipeable slides here; each can be pulled out as a floating S/M/L widget. The AI automations live in the right dock.
 */
export const IslandDeck: React.FC<IslandDeckProps> = ({ chat, onWide }) => {
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState(1);
  const [now, setNow] = useState(() => new Date());
  const { openWidget, setSize } = useWidgets();
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
  useEffect(() => {
    onWide(slide.id === "media");
    return () => onWide(false);
  }, [slide.id, onWide]);

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
    <div className="relative w-full h-full flex flex-col gap-1.5 text-ink">
      <div className="flex items-center justify-between gap-2 flex-shrink-0 h-6 text-[11px]">
        <span className="font-semibold tracking-tight truncate w-[34%]">{slide.title}</span>
        <span className="flex items-center gap-1.5 font-mono text-ink-2 whitespace-nowrap">
          <DayRing now={now} />
          {stamp(now)}
        </span>
        <span className="flex items-center justify-end gap-1.5 w-[34%] text-ink-2">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => pullOut(slide.widget as WidgetId)}
            className="h-5 px-2 rounded-full karsa-grad text-[10px] font-semibold inline-flex items-center gap-1 cursor-pointer"
            title="Tarik keluar jadi widget mengambang (S / M / L)"
            aria-label={`${slide.title} sebagai widget`}
          >
            <ExternalLink className="w-3 h-3" />
            Widget
          </button>
        </span>
      </div>

      <div className="relative flex-1 min-h-0">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={slide.id}
            custom={dir}
            initial={{ opacity: 0, x: dir * 36 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: dir * -36 }}
            transition={{ type: "spring", stiffness: 420, damping: 36, mass: 0.7 }}
            className="absolute inset-0 karsa-nested !rounded-[18px] px-3 py-2 overflow-hidden"
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

      <div className="absolute left-0 right-0 bottom-[3px] flex items-center justify-center gap-1.5 pointer-events-none">
        {SLIDES.map((sl, i) => (
          <button
            key={sl.id}
            type="button"
            onClick={() => {
              setDir(i > index ? 1 : -1);
              setIndex(i);
            }}
            aria-label={sl.title}
            aria-current={i === index}
            className={`pointer-events-auto h-1 rounded-full transition-all cursor-pointer ${i === index ? "w-3.5 bg-ink" : "w-1 bg-ink-muted/50"}`}
          />
        ))}
      </div>
    </div>
  );
};

export default IslandDeck;
