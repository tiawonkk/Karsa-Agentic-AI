import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Home,
  MessageSquare,
  SlidersHorizontal,
  Search,
} from "lucide-react";

import { OmniCommandSlide } from "./slides/OmniCommandSlide";
import { MediaPlayerSlide } from "./slides/MediaPlayerSlide";
import { PomodoroSlide } from "./slides/PomodoroSlide";
import { HydrationSlide } from "./slides/HydrationSlide";
import { FileShelfSlide } from "./slides/FileShelfSlide";
import { TodoChecklistSlide } from "./slides/TodoChecklistSlide";
import { SettingsSlide } from "./slides/SettingsSlide";

interface DynamicIslandDeckProps {
  isDark: boolean;
  activeSlide?: number;
  focusSearchTrigger?: number;
  onLyricsToggle?: (expanded: boolean) => void;
  onSubmitMessage: (msg: string) => void;
  onCollapse?: () => void;
  onOpenChat?: () => void;
  onOpenSettings?: () => void;
}

export const DynamicIslandDeck: React.FC<DynamicIslandDeckProps> = ({
  isDark,
  activeSlide,
  focusSearchTrigger,
  onLyricsToggle,
  onSubmitMessage,
  onCollapse,
  onOpenChat,
  onOpenSettings,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const totalSlides = 7;
  const [currentTimeStr, setCurrentTimeStr] = useState("Fri 23 Oct 2026 07:48");
  const [isLyricsActive, setIsLyricsActive] = useState(false);

  // Sync external slide if provided
  useEffect(() => {
    if (activeSlide !== undefined) {
      setCurrentSlide(activeSlide);
    }
  }, [activeSlide]);

  // Real-time clock formatted as "Fri 23 Oct 2026 07:48"
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const datePart = now.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      const timePart = now.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
      });
      setCurrentTimeStr(`${datePart} ${timePart}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const nextSlide = () => setCurrentSlide((prev) => (prev + 1) % totalSlides);
  const prevSlide = () => setCurrentSlide((prev) => (prev - 1 + totalSlides) % totalSlides);

  // Keyboard navigation (Arrow keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't navigate slides if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.key === "ArrowRight") nextSlide();
      else if (e.key === "ArrowLeft") prevSlide();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Notify parent on lyrics expansion change (Slide 1 is MediaPlayer)
  useEffect(() => {
    if (onLyricsToggle) {
      onLyricsToggle(currentSlide === 1 && isLyricsActive);
    }
  }, [currentSlide, isLyricsActive, onLyricsToggle]);

  const renderTitle = () => {
    switch (currentSlide) {
      case 0:
        return (
          <span>
            Omni <span className="text-orange-400">Search</span>
          </span>
        );
      case 1:
        return (
          <span>
            Media <span className="text-orange-400">Player</span>
          </span>
        );
      case 2:
        return (
          <span>
            Pomodoro <span className="text-rose-500">Focus</span>
          </span>
        );
      case 3:
        return (
          <span>
            Water <span className="text-[#38BDF8]">Reminder</span>
          </span>
        );
      case 4:
        return (
          <span>
            Smart <span className="text-amber-400">Shelf</span>
          </span>
        );
      case 5:
        return (
          <span>
            Todo<span className="text-[#22C55E]">List</span>
          </span>
        );
      case 6:
        return (
          <span>
            System <span className="text-indigo-400">Settings</span>
          </span>
        );
      default:
        return <span>Karsa Deck</span>;
    }
  };

  return (
    <div className="w-full h-full flex flex-col justify-between select-none">
      {/* 1. Fixed Header (Reference Images 3, 4, 5) */}
      <div className="flex items-center justify-between px-2 pt-0.5 pb-1 text-xs">
        {/* Left: Module Title & Home/Minimize */}
        <div className="font-bold text-white tracking-tight flex items-center gap-1.5">
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="text-zinc-500 hover:text-white transition-colors p-0.5 cursor-pointer"
              title="Kecilkan ke Notch Pill (Esc)"
            >
              <Home className="w-3 h-3" />
            </button>
          )}
          {renderTitle()}
        </div>

        {/* Center: Green Status Ring + Date/Time */}
        <div
          onClick={onCollapse}
          className={`flex items-center gap-2 font-mono text-[11px] text-zinc-300 ${
            onCollapse ? "cursor-pointer hover:text-white" : ""
          }`}
          title={onCollapse ? "Klik untuk mengecilkan notch" : undefined}
        >
          <div className="w-3.5 h-3.5 rounded-full border-2 border-[#10B981] p-0.5 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
          </div>
          <span>{currentTimeStr}</span>
        </div>

        {/* Right: Quick actions (Search, Chat, Settings) & Audio Equalizer Waveform Bars (|||||) */}
        <div className="flex items-center gap-2">
          {/* Quick jump to Omni-Search (Slide 0) */}
          <button
            type="button"
            onClick={() => setCurrentSlide(0)}
            className={`transition-colors cursor-pointer ${
              currentSlide === 0 ? "text-orange-400" : "text-zinc-500 hover:text-white"
            }`}
            title="Omni-Search & App Launcher (Alt+Space)"
          >
            <Search className="w-3 h-3" />
          </button>

          {onOpenChat && (
            <button
              type="button"
              onClick={onOpenChat}
              className="text-zinc-500 hover:text-white transition-colors cursor-pointer"
              title="Chat AI Karsa"
            >
              <MessageSquare className="w-3 h-3" />
            </button>
          )}

          {/* Quick jump to Settings Slide (Slide 6) */}
          <button
            type="button"
            onClick={() => setCurrentSlide(6)}
            className={`transition-colors cursor-pointer ${
              currentSlide === 6 ? "text-indigo-400" : "text-zinc-500 hover:text-white"
            }`}
            title="Settings Panel & Model Hot-Swap"
          >
            <SlidersHorizontal className="w-3 h-3" />
          </button>

          <div className="flex items-end gap-0.5 h-3.5">
            <span className="w-0.5 h-2 rounded-full bg-white animate-pulse" />
            <span className="w-0.5 h-3.5 rounded-full bg-white animate-pulse delay-75" />
            <span className="w-0.5 h-1.5 rounded-full bg-white animate-pulse delay-150" />
            <span className="w-0.5 h-3 rounded-full bg-white animate-pulse delay-100" />
            <span className="w-0.5 h-2.5 rounded-full bg-white animate-pulse delay-200" />
          </div>
        </div>
      </div>

      {/* 2. Slide Content Area with Spring Transitions */}
      <div className="flex-1 relative overflow-hidden flex items-center my-0.5">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentSlide}
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -18 }}
            transition={{ type: "spring", stiffness: 420, damping: 30 }}
            className="w-full"
          >
            {currentSlide === 0 && (
              <OmniCommandSlide
                isDark={isDark}
                onSubmitMessage={onSubmitMessage}
                focusTrigger={focusSearchTrigger}
              />
            )}
            {currentSlide === 1 && (
              <MediaPlayerSlide
                isDark={isDark}
                onToggleLyricsState={(open) => setIsLyricsActive(open)}
              />
            )}
            {currentSlide === 2 && <PomodoroSlide isDark={isDark} />}
            {currentSlide === 3 && <HydrationSlide isDark={isDark} />}
            {currentSlide === 4 && (
              <FileShelfSlide
                isDark={isDark}
                onTriggerAction={onSubmitMessage}
              />
            )}
            {currentSlide === 5 && (
              <TodoChecklistSlide
                isDark={isDark}
                onAddTaskPrompt={onSubmitMessage}
              />
            )}
            {currentSlide === 6 && (
              <SettingsSlide
                isDark={isDark}
                onOpenFullSettings={() => onOpenSettings && onOpenSettings()}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 3. Bottom Carousel Pagination Dots (••••••━) and Navigation Chevrons */}
      <div className="flex items-center justify-between px-2 pt-0.5">
        {/* Left Arrow Button */}
        <button
          type="button"
          onClick={prevSlide}
          className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          title="Slide Sebelumnya (<)"
        >
          <ChevronLeft className="w-3 h-3" />
        </button>

        {/* Pagination Dots (••••••━) */}
        <div className="flex items-center gap-1.5">
          {Array.from({ length: totalSlides }).map((_, idx) => {
            const isActive = idx === currentSlide;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentSlide(idx)}
                className={`transition-all duration-300 rounded-full cursor-pointer ${
                  isActive
                    ? "w-5 h-1.5 bg-white shadow-sm"
                    : "w-1.5 h-1.5 bg-white/30 hover:bg-white/60"
                }`}
                title={`Buka Slide ${idx + 1}`}
              />
            );
          })}
        </div>

        {/* Right Arrow Button */}
        <button
          type="button"
          onClick={nextSlide}
          className="w-5 h-5 rounded-full bg-white/10 hover:bg-white/20 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          title="Slide Berikutnya (>)"
        >
          <ChevronRight className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
};

export default DynamicIslandDeck;
