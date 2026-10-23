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
} from "lucide-react";

export type ToastCategory = "charging" | "bluetooth" | "capslock" | "numlock" | "volume" | "brightness";

export interface SystemToastData {
  category: ToastCategory;
  title: string;
  subtitle?: string;
  value?: number; // 0-100
  badge?: string;
}

interface SystemToastViewProps {
  toast: SystemToastData;
  isDark?: boolean;
}

/**
 * SystemToastView: High-fidelity hardware OSD Toast (340px x 68px).
 * Matches user reference images 1 & 2:
 * - Left: Ring with specific accent (Green for Charging/CapsLock, Sky Blue for Bluetooth/Volume, Amber for Brightness)
 * - Center: Bold title and subtitle
 * - Right: Large percentage text (e.g. "70%") or concentric headphone ring
 */
export const SystemToastView: React.FC<SystemToastViewProps> = ({ toast, isDark = true }) => {
  return (
    <div className="w-full h-full flex items-center justify-between px-3.5 select-none">
      {/* Left: Ring Icon */}
      <div className="flex items-center gap-3.5">
        {/* Charging (Green Ring) */}
        {toast.category === "charging" && (
          <div className="w-10 h-10 rounded-full border-2 border-[#10B981] bg-[#10B981]/15 flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(16,185,129,0.3)]">
            <Zap className="w-5 h-5 text-[#10B981] fill-current" />
          </div>
        )}

        {/* Bluetooth (Sky Blue Ring) */}
        {toast.category === "bluetooth" && (
          <div className="w-10 h-10 rounded-full border-2 border-[#38BDF8] bg-[#38BDF8]/15 flex items-center justify-center flex-shrink-0 shadow-[0_0_12px_rgba(56,189,248,0.3)]">
            <Bluetooth className="w-5 h-5 text-[#38BDF8]" />
          </div>
        )}

        {/* Volume (Sky Blue / Emerald Ring) */}
        {toast.category === "volume" && (
          <div className="w-10 h-10 rounded-full border-2 border-[#38BDF8] bg-[#38BDF8]/15 flex items-center justify-center flex-shrink-0">
            {toast.value === 0 ? (
              <VolumeX className="w-5 h-5 text-rose-400" />
            ) : (
              <Volume2 className="w-5 h-5 text-[#38BDF8]" />
            )}
          </div>
        )}

        {/* Brightness (Amber Ring) */}
        {toast.category === "brightness" && (
          <div className="w-10 h-10 rounded-full border-2 border-amber-400 bg-amber-400/15 flex items-center justify-center flex-shrink-0">
            <Sun className="w-5 h-5 text-amber-400" />
          </div>
        )}

        {/* CapsLock / NumLock (Green/Amber Ring) */}
        {(toast.category === "capslock" || toast.category === "numlock") && (
          <div className="w-10 h-10 rounded-full border-2 border-[#10B981] bg-[#10B981]/15 flex items-center justify-center flex-shrink-0">
            {toast.badge === "ON" ? (
              <Lock className="w-5 h-5 text-[#10B981]" />
            ) : (
              <Unlock className="w-5 h-5 text-zinc-400" />
            )}
          </div>
        )}

        {/* Center: Title & Subtitle */}
        <div className="flex flex-col justify-center">
          <div className="text-sm font-bold text-white tracking-tight leading-tight">
            {toast.title}
          </div>
          {toast.subtitle && (
            <div className="text-xs text-zinc-400 mt-0.5 leading-tight font-medium">
              {toast.subtitle}
            </div>
          )}
        </div>
      </div>

      {/* Right: Large Typography 70% or Concentric Headphone Ring */}
      <div className="flex items-center pl-2">
        {toast.category === "bluetooth" ? (
          // Concentric Headphone Ring (Reference Image 1)
          <div className="w-10 h-10 rounded-full border border-sky-400/30 p-1 flex items-center justify-center">
            <div className="w-full h-full rounded-full border border-sky-400/70 bg-sky-950/40 flex items-center justify-center">
              <Headphones className="w-4 h-4 text-sky-300" />
            </div>
          </div>
        ) : toast.value !== undefined ? (
          // Large percentage text 70% (Reference Image 2)
          <div className="font-sans font-bold text-2xl text-white tracking-tight">
            {toast.value}%
          </div>
        ) : toast.badge ? (
          <span
            className={`text-xs font-mono font-bold px-2.5 py-1 rounded-lg ${
              toast.badge === "ON"
                ? "bg-[#10B981]/25 text-[#10B981] border border-[#10B981]/40"
                : "bg-white/10 text-zinc-400"
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
