import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Timer, Coins, Search, CheckSquare, BookOpen, Music, Moon } from "lucide-react";

export interface MiniMascotAvatarProps {
  size?: number; // default 26px
  mascotColor?: string;
  eyeColor?: string;
  isSleeping?: boolean;
  contextMode?: "home" | "pomodoro" | "money" | "search" | "todo" | "study" | "music" | null;
  onClick?: () => void;
  isDark?: boolean;
}

export const MiniMascotAvatar: React.FC<MiniMascotAvatarProps> = ({
  size = 26,
  mascotColor = "#FAF9F6",
  eyeColor = "#18181B",
  isSleeping = false,
  contextMode = null,
  onClick,
  isDark = true,
}) => {
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);

  // Mouse tracking for eyes
  useEffect(() => {
    if (isSleeping) return;
    const handleMove = (e: MouseEvent) => {
      const centerX = window.innerWidth / 2;
      const centerY = 30;
      const dx = (e.clientX - centerX) / (window.innerWidth / 2);
      const dy = (e.clientY - centerY) / (window.innerHeight / 2);
      setGaze({
        x: Math.max(-2, Math.min(2, dx * 2.5)),
        y: Math.max(-1.5, Math.min(1.5, dy * 2)),
      });
    };
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, [isSleeping]);

  // Periodic Blink
  useEffect(() => {
    if (isSleeping) return;
    const interval = setInterval(() => {
      setIsBlinking(true);
      setTimeout(() => setIsBlinking(false), 120);
    }, 4000 + Math.random() * 3000);
    return () => clearInterval(interval);
  }, [isSleeping]);

  const renderBadge = () => {
    switch (contextMode) {
      case "pomodoro":
        return <Timer className="w-2.5 h-2.5 text-rose-500 fill-rose-500/20" />;
      case "money":
        return <Coins className="w-2.5 h-2.5 text-emerald-500 fill-emerald-500/20" />;
      case "search":
        return <Search className="w-2.5 h-2.5 text-purple-500" />;
      case "todo":
        return <CheckSquare className="w-2.5 h-2.5 text-amber-500" />;
      case "study":
        return <BookOpen className="w-2.5 h-2.5 text-blue-500" />;
      case "music":
        return <Music className="w-2.5 h-2.5 text-orange-500" />;
      default:
        return null;
    }
  };

  return (
    <div
      onClick={onClick}
      className="relative flex items-center justify-center cursor-pointer select-none group"
      style={{ width: size, height: size }}
      title={isSleeping ? "Karsa sedang tidur Zzz" : "Karsa Companion (Klik untuk Wardrobe)"}
    >
      {/* Mascot Squircle Body */}
      <div
        className="w-full h-full rounded-[38%] shadow-sm flex items-center justify-center relative transition-transform duration-200 group-hover:scale-110"
        style={{
          backgroundColor: mascotColor,
          border: isDark ? "1.5px solid rgba(255,255,255,0.15)" : "1.5px solid rgba(0,0,0,0.12)",
          boxShadow: isDark
            ? "0 2px 6px rgba(0,0,0,0.4)"
            : "0 2px 6px rgba(0,0,0,0.08)",
        }}
      >
        {isSleeping ? (
          // Sleeping Eyes & Zzz
          <div className="flex items-center gap-1">
            <span
              className="w-1.5 h-0.5 rounded-full inline-block"
              style={{ backgroundColor: eyeColor }}
            />
            <span
              className="w-1.5 h-0.5 rounded-full inline-block"
              style={{ backgroundColor: eyeColor }}
            />
          </div>
        ) : (
          // Expressive Eyes following cursor
          <div className="flex items-center gap-1 relative">
            <motion.div
              animate={{
                scaleY: isBlinking ? 0.1 : 1,
                x: gaze.x,
                y: gaze.y,
              }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="w-1 h-1.5 rounded-full"
              style={{ backgroundColor: eyeColor }}
            />
            <motion.div
              animate={{
                scaleY: isBlinking ? 0.1 : 1,
                x: gaze.x,
                y: gaze.y,
              }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              className="w-1 h-1.5 rounded-full"
              style={{ backgroundColor: eyeColor }}
            />
          </div>
        )}
      </div>

      {/* Mini Context Badge (e.g. Stopwatch, Coin, Search, Zzz) */}
      {isSleeping ? (
        <span className="absolute -top-1 -right-1 text-[8px] font-mono font-bold text-amber-400 animate-pulse">
          Zzz
        </span>
      ) : (
        contextMode && (
          <div
            className={`absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full flex items-center justify-center shadow-xs border ${
              isDark ? "bg-[#18181B] border-[#27272A]" : "bg-white border-zinc-200"
            }`}
          >
            {renderBadge()}
          </div>
        )
      )}
    </div>
  );
};

export default MiniMascotAvatar;
