import React, { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Pin, Minus } from "lucide-react";

interface FloatingPopupCardProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  badge?: string;
  badgeColor?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  isDark?: boolean;
}

export const FloatingPopupCard: React.FC<FloatingPopupCardProps> = ({
  isOpen,
  onClose,
  title,
  badge,
  badgeColor = "text-zinc-900 dark:text-zinc-100 bg-white/20 border-white/30",
  icon,
  children,
  isDark = true,
}) => {
  const [isPinned, setIsPinned] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPinned) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isPinned]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          drag
          dragMomentum={false}
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 10 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className={`fixed top-14 left-1/2 -translate-x-1/2 z-50 w-[335px] max-w-[calc(100vw-1.5rem)] max-h-[390px] rounded-[28px] border flex flex-col overflow-hidden font-sans select-none pointer-events-auto backdrop-blur-2xl karsa-surface`}
        >
          {/* Header Bar & Drag Handle */}
          <div
            className={`flex items-center justify-between px-3.5 py-2.5 border-b cursor-grab active:cursor-grabbing select-none flex-shrink-0 ${
              isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200/80 bg-slate-50/50"
            }`}
            title="Klik dan geser untuk memindahkan kartu"
          >
            <div className="flex items-center gap-1.5 truncate">
              {icon && <span className="flex-shrink-0">{icon}</span>}
              <h3 className="text-[11.5px] font-semibold tracking-tight truncate">
                {title}
              </h3>
              {badge && (
                <span
                  className={`text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-full border ${badgeColor}`}
                >
                  {badge}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsPinned(!isPinned)}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isPinned
                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/40"
                    : isDark
                    ? "hover:bg-white/10 text-zinc-400"
                    : "hover:bg-slate-200 text-slate-600"
                }`}
                title={isPinned ? "Lepas Pin" : "Pin (📌)"}
              >
                <Pin className={`w-3 h-3 ${isPinned ? "rotate-45" : ""}`} />
              </button>

              <button
                type="button"
                onClick={() => setIsMinimized(!isMinimized)}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isDark ? "hover:bg-white/10 text-zinc-400" : "hover:bg-slate-200 text-slate-600"
                }`}
                title="Kecilkan (—)"
              >
                <Minus className="w-3 h-3 stroke-[2.25]" />
              </button>

              <button
                type="button"
                onClick={onClose}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isDark
                    ? "hover:bg-rose-500 hover:text-white text-zinc-400"
                    : "hover:bg-rose-500 hover:text-white text-slate-600"
                }`}
                title="Tutup (Esc)"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Smooth Scroll Content Area */}
          {!isMinimized && (
            <div className="flex-1 overflow-y-auto p-3 text-xs space-y-2">{children}</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FloatingPopupCard;
