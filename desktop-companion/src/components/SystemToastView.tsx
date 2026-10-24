import React from "react";
import {
  Volume2,
  VolumeX,
  Sun,
  Lock,
  Unlock,
  Zap,
  Bluetooth,
  Headphones,
  Play,
  SkipBack,
  SkipForward,
  Square,
} from "lucide-react";

export type ToastCategory = "charging" | "bluetooth" | "capslock" | "numlock" | "volume" | "brightness" | "fkey" | "media";

export interface SystemToastData {
  category: ToastCategory;
  title: string;
  subtitle?: string;
  value?: number; // 0-100
  badge?: string;
  /** media toasts: which transport key was pressed */
  mediaKey?: string;
  /** fkey toasts: the key name shown inside the ring (e.g. F5) */
  keyName?: string;
}

interface SystemToastViewProps {
  toast: SystemToastData;
  isDark?: boolean;
  onClick?: () => void;
}

/**
 * SystemToastView: Interactive Hardware OSD Pill in True Liquid Glass.
 * Allows click-to-inspect / click-to-dismiss without blocking pointer events.
 */
export const SystemToastView: React.FC<SystemToastViewProps> = ({
  toast,
  isDark = true,
  onClick,
}) => {
  return (
    <div
      onClick={onClick}
      className="w-full h-full flex items-center justify-between px-3 select-none font-sans pointer-events-auto cursor-pointer transition-transform duration-150 active:scale-[0.98]"
      title="Klik untuk membuka rincian atau menyembunyikan info"
    >
      {/* Left: Status Ring Icon */}
      <div className="flex items-center gap-2.5 min-w-0">
        {/* Battery / Charging */}
        {toast.category === "charging" && (
          <div className="w-7 h-7 rounded-full border-2 border-emerald-500 bg-emerald-500/15 flex items-center justify-center flex-shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
            <Zap className="w-3.5 h-3.5 text-emerald-500 fill-current" />
          </div>
        )}

        {/* Bluetooth */}
        {toast.category === "bluetooth" && (
          <div className="w-7 h-7 rounded-full border-2 border-sky-500 bg-sky-500/15 flex items-center justify-center flex-shrink-0 shadow-[0_0_8px_rgba(56,189,248,0.3)]">
            <Bluetooth className="w-3.5 h-3.5 text-sky-500" />
          </div>
        )}

        {/* Volume */}
        {toast.category === "volume" && (
          <div className="w-7 h-7 rounded-full border-2 border-sky-500 bg-sky-500/15 flex items-center justify-center flex-shrink-0">
            {toast.value === 0 ? (
              <VolumeX className="w-3.5 h-3.5 text-rose-500" />
            ) : (
              <Volume2 className="w-3.5 h-3.5 text-sky-500" />
            )}
          </div>
        )}

        {/* Brightness */}
        {toast.category === "brightness" && (
          <div className="w-7 h-7 rounded-full border-2 border-orange-500 bg-orange-500/15 flex items-center justify-center flex-shrink-0 shadow-[0_0_8px_rgba(249,115,22,0.3)]">
            <Sun className="w-3.5 h-3.5 text-orange-500" />
          </div>
        )}

        {/* CapsLock / NumLock */}
        {(toast.category === "capslock" || toast.category === "numlock") && (
          <div className="w-7 h-7 rounded-full border-2 border-emerald-500 bg-emerald-500/15 flex items-center justify-center flex-shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.3)]">
            {toast.badge === "ON" ? (
              <Lock className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Unlock className="w-3.5 h-3.5 text-zinc-400" />
            )}
          </div>
        )}

        {/* Function key (F1-F12): the key name sits in the ring */}
        {toast.category === "fkey" && (
          <div className="min-w-[30px] h-7 px-1.5 rounded-full border-2 border-violet-500 bg-violet-500/15 flex items-center justify-center flex-shrink-0 shadow-[0_0_8px_rgba(139,92,246,0.3)]">
            <span className="text-[10px] font-mono font-bold text-violet-500 leading-none">{toast.keyName}</span>
          </div>
        )}

        {/* Media transport keys */}
        {toast.category === "media" && (
          <div className="w-7 h-7 rounded-full border-2 border-orange-500 bg-orange-500/15 flex items-center justify-center flex-shrink-0">
            {toast.mediaKey === "Next" ? (
              <SkipForward className="w-3.5 h-3.5 text-orange-500 fill-current" />
            ) : toast.mediaKey === "Previous" ? (
              <SkipBack className="w-3.5 h-3.5 text-orange-500 fill-current" />
            ) : toast.mediaKey === "Stop" ? (
              <Square className="w-3 h-3 text-orange-500 fill-current" />
            ) : (
              <Play className="w-3.5 h-3.5 text-orange-500 fill-current" />
            )}
          </div>
        )}

        {/* Center: Title & Subtitle */}
        <div className="flex flex-col justify-center truncate min-w-0">
          <div className="text-xs font-semibold tracking-tight leading-tight truncate text-[#09090B] dark:text-[#FAFAFA] font-sans">
            {toast.title}
          </div>
          {toast.subtitle && (
            <div className="text-[11px] font-mono leading-tight truncate text-[#52525B] dark:text-[#A1A1AA] mt-0.5">
              {toast.subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Right: Value or Headphone */}
      <div className="flex items-center pl-2 flex-shrink-0">
        {toast.category === "bluetooth" ? (
          <div className="w-7 h-7 rounded-full border border-sky-400/30 p-0.5 flex items-center justify-center">
            <Headphones className="w-3.5 h-3.5 text-sky-400" />
          </div>
        ) : toast.value !== undefined ? (
          <div className="font-mono font-bold text-sm tracking-tight text-[#09090B] dark:text-[#FAFAFA]">
            {toast.value}%
          </div>
        ) : toast.badge ? (
          <span
            className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
              toast.badge === "ON"
                ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-200 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {toast.badge}
          </span>
        ) : null}
      </div>
    </div>
  );
};

export default SystemToastView;
