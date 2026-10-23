import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";

import { MascotSlide } from "./slides/MascotSlide";
import { MediaPlayerSlide } from "./slides/MediaPlayerSlide";
import { PomodoroSlide } from "./slides/PomodoroSlide";
import { HydrationSlide } from "./slides/HydrationSlide";
import { FileShelfSlide } from "./slides/FileShelfSlide";
import { TodoChecklistSlide } from "./slides/TodoChecklistSlide";

interface DynamicIslandDeckProps {
  isDark: boolean;
  mascotColor: string;
  eyeColor: string;
  isSleeping: boolean;
  isDraggingFile: boolean;
  activeAccessory: string | null;
  hoverTarget: "settings" | "add" | "chat" | null;
  emoteContext: "money" | "search" | "screen" | "code" | "success" | null;
  onDropFiles: (files: FileList) => void;
  onSubmitMessage: (msg: string) => void;
  isStreaming: boolean;
}

const SLIDE_TITLES = [
  "Companion & Omni-Bar",
  "Media Player & Lyrics",
  "Pomodoro Focus",
  "Water & Hydration",
  "File Drop Shelf",
  "Eisenhower Tasks",
];

export const DynamicIslandDeck: React.FC<DynamicIslandDeckProps> = (props) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const totalSlides = 6;

  // Real-time clock display
  const [currentTimeStr, setCurrentTimeStr] = useState("");
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      const date = now.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
      });
      setCurrentTimeStr(`${date} • ${time}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % totalSlides);
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + totalSlides) % totalSlides);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "ArrowRight") {
        nextSlide();
      } else if (e.altKey && e.key === "ArrowLeft") {
        prevSlide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="w-full flex flex-col space-y-2 select-none">
      {/* Top Deck Sub-Header: Slide Title, Navigation Arrows, Clock & Live Pulsing Dot */}
      <div className="flex items-center justify-between px-1 text-[11px] text-zinc-400">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={prevSlide}
            className="p-1 rounded-md hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Slide Sebelumnya (Alt + Panah Kiri)"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="font-semibold text-zinc-200 tracking-tight">
            {SLIDE_TITLES[currentSlide]}
          </span>
          <button
            type="button"
            onClick={nextSlide}
            className="p-1 rounded-md hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            title="Slide Berikutnya (Alt + Panah Kanan)"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Live Clock & Equalizer status */}
        <div className="flex items-center gap-2 font-mono text-[10px]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>{currentTimeStr}</span>
        </div>
      </div>

      {/* Main Slide Stage with Framer Motion slide transitions */}
      <div className="relative min-h-[148px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="w-full"
          >
            {currentSlide === 0 && <MascotSlide {...props} />}
            {currentSlide === 1 && <MediaPlayerSlide isDark={props.isDark} />}
            {currentSlide === 2 && <PomodoroSlide isDark={props.isDark} />}
            {currentSlide === 3 && <HydrationSlide isDark={props.isDark} />}
            {currentSlide === 4 && (
              <FileShelfSlide
                isDark={props.isDark}
                onTriggerAction={props.onSubmitMessage}
              />
            )}
            {currentSlide === 5 && (
              <TodoChecklistSlide
                isDark={props.isDark}
                onAddTaskPrompt={props.onSubmitMessage}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Carousel Pagination Indicator (● ━━ ○ ○ ○ ○) */}
      <div className="flex items-center justify-center gap-1.5 pt-1">
        {Array.from({ length: totalSlides }).map((_, idx) => {
          const isActive = idx === currentSlide;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => setCurrentSlide(idx)}
              className={`transition-all duration-300 rounded-full cursor-pointer ${
                isActive
                  ? "w-6 h-1.5 bg-orange-500 shadow-sm"
                  : "w-1.5 h-1.5 bg-white/20 hover:bg-white/40"
              }`}
              title={`Buka Slide ${idx + 1}`}
            />
          );
        })}
      </div>
    </div>
  );
};

export default DynamicIslandDeck;
