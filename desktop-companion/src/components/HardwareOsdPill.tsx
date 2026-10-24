import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Volume2,
  Volume1,
  VolumeX,
  Sun,
  Lock,
  Unlock,
  Zap,
  Bluetooth,
  Headphones,
} from "lucide-react";
import { BezelWings } from "./BezelWings";

export type OsdType = "volume" | "brightness" | "capslock" | "numlock" | "power" | "bluetooth" | "media";

export interface OsdState {
  type: OsdType;
  title: string;
  subtitle?: string;
  value?: number; // 0-100
  badge?: string;
  icon?: string;
}

interface HardwareOsdPillProps {
  isDark?: boolean;
}

export const HardwareOsdPill: React.FC<HardwareOsdPillProps> = ({ isDark = true }) => {
  const [activeOsd, setActiveOsd] = useState<OsdState | null>(null);
  const dismissTimer = useRef<NodeJS.Timeout | null>(null);

  const showOsd = (osd: OsdState, durationMs: number = 2200) => {
    setActiveOsd(osd);
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
    }
    dismissTimer.current = setTimeout(() => {
      setActiveOsd(null);
    }, durationMs);
  };

  useEffect(() => {
    // 1. Subscribe to Real-Time SSE Hardware Events from backend
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/v1/system/osd/stream");

      eventSource.addEventListener("osd://lock-key", (e) => {
        try {
          const data = JSON.parse(e.data);
          showOsd({
            type: "capslock",
            title: data.key,
            subtitle: data.active ? "Key Active" : "Key Inactive",
            badge: data.active ? "ON" : "OFF",
          });
        } catch (_) {}
      });

      eventSource.addEventListener("osd://power", (e) => {
        try {
          const data = JSON.parse(e.data);
          showOsd({
            type: "power",
            title: data.charging ? "Charging" : "On Battery",
            subtitle: data.charging ? "Charger connected" : "Power disconnected",
            value: data.percent,
            badge: `${data.percent}%`,
          });
        } catch (_) {}
      });

      eventSource.addEventListener("osd://volume", (e) => {
        try {
          const data = JSON.parse(e.data);
          showOsd({
            type: "volume",
            title: "Volume",
            subtitle: data.muted ? "Muted" : `${data.level}% Master Audio`,
            value: data.level,
            badge: data.muted ? "MUTED" : `${data.level}%`,
          });
        } catch (_) {}
      });
    } catch (_) {}

    // 2. Keyboard fallback listener for Lock Keys
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "CapsLock") {
        const isCapsOn = e.getModifierState("CapsLock");
        showOsd({
          type: "capslock",
          title: "Caps Lock",
          subtitle: isCapsOn ? "Key Active" : "Key Inactive",
          badge: isCapsOn ? "ON" : "OFF",
        });
      } else if (e.key === "NumLock") {
        const isNumOn = e.getModifierState("NumLock");
        showOsd({
          type: "numlock",
          title: "Num Lock",
          subtitle: isNumOn ? "Key Active" : "Key Inactive",
          badge: isNumOn ? "ON" : "OFF",
        });
      }
    };

    // 3. Custom event dispatcher for Bluetooth / Testing
    const handleCustomOsd = (e: Event) => {
      const customEvent = e as CustomEvent<OsdState>;
      if (customEvent.detail) {
        showOsd(customEvent.detail);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("karsa:osd" as any, handleCustomOsd);

    return () => {
      if (eventSource) eventSource.close();
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("karsa:osd" as any, handleCustomOsd);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {activeOsd && (
        <motion.div
          initial={{ y: -50, opacity: 0, scale: 0.94 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -45, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 460, damping: 30, mass: 0.8 }}
          className="fixed top-0 left-1/2 -translate-x-1/2 z-[70] pointer-events-none select-none font-sans"
        >
          {/* Bezel-Blended Island with Concave Wings */}
          <div
            className={`relative h-[48px] min-w-[310px] px-4 rounded-b-[24px] border border-t-0 shadow-2xl flex items-center justify-between gap-4 backdrop-blur-2xl ${
              isDark
                ? "bg-[#000000] border-white/10 text-zinc-100 shadow-black/90"
                : "bg-[#FAF9F6]/95 border-zinc-200/90 text-zinc-900 shadow-zinc-400/30"
            }`}
            style={{
              boxShadow: isDark
                ? "0 18px 44px -6px rgba(0, 0, 0, 0.9), 0 0 1px 1px rgba(255, 255, 255, 0.08)"
                : "0 18px 44px -6px rgba(0, 0, 0, 0.14), 0 0 1px 1px rgba(0, 0, 0, 0.04)",
            }}
          >
            <BezelWings isDark={isDark} showBacklight={true} />

            {/* Left: Status Icon in Colored Circular Ring */}
            <div className="flex items-center gap-3">
              {/* Reference Image 1: Bluetooth circular icon */}
              {activeOsd.type === "bluetooth" && (
                <div className="w-8 h-8 rounded-full border-2 border-sky-400/80 bg-sky-950/40 flex items-center justify-center flex-shrink-0">
                  <Bluetooth className="w-4 h-4 text-sky-400" />
                </div>
              )}

              {/* Reference Image 2: Power / Charging green circular icon */}
              {activeOsd.type === "power" && (
                <div className="w-8 h-8 rounded-full border-2 border-emerald-400/90 bg-emerald-950/40 flex items-center justify-center flex-shrink-0">
                  <Zap className="w-4 h-4 text-emerald-400 fill-current" />
                </div>
              )}

              {/* Volume circular icon */}
              {activeOsd.type === "volume" && (
                <div className="w-8 h-8 rounded-full border-2 border-emerald-400/70 bg-emerald-950/30 flex items-center justify-center flex-shrink-0">
                  {activeOsd.value === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4 text-emerald-400" />
                  )}
                </div>
              )}

              {/* Brightness */}
              {activeOsd.type === "brightness" && (
                <div className="w-8 h-8 rounded-full border-2 border-amber-400/80 bg-amber-950/30 flex items-center justify-center flex-shrink-0">
                  <Sun className="w-4 h-4 text-amber-400" />
                </div>
              )}

              {/* Lock keys */}
              {(activeOsd.type === "capslock" || activeOsd.type === "numlock") && (
                <div className="w-8 h-8 rounded-full border-2 border-amber-400/80 bg-amber-950/30 flex items-center justify-center flex-shrink-0">
                  {activeOsd.badge === "ON" ? (
                    <Lock className="w-4 h-4 text-amber-400" />
                  ) : (
                    <Unlock className="w-4 h-4 text-zinc-400" />
                  )}
                </div>
              )}

              {/* Title & Subtitle */}
              <div className="truncate">
                <div className="text-xs font-bold tracking-tight text-zinc-950 dark:text-zinc-50 leading-tight">
                  {activeOsd.title}
                </div>
                {activeOsd.subtitle && (
                  <div className="text-[10px] text-zinc-600 dark:text-zinc-400 leading-tight">
                    {activeOsd.subtitle}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Big Typography (Reference Image 2: 70%) or Concentric Headphone Ring (Reference Image 1) */}
            <div className="flex items-center gap-2 pl-3">
              {activeOsd.type === "bluetooth" ? (
                // Reference Image 1: Double concentric ring with headphone
                <div className="w-8 h-8 rounded-full border border-sky-500/30 p-0.5 flex items-center justify-center">
                  <div className="w-full h-full rounded-full border border-sky-400/60 bg-sky-950/30 flex items-center justify-center">
                    <Headphones className="w-3.5 h-3.5 text-sky-300" />
                  </div>
                </div>
              ) : activeOsd.value !== undefined ? (
                // Reference Image 2: Large clean percentage display
                <div className="font-sans font-semibold text-xl text-zinc-950 dark:text-zinc-50 tracking-tight">
                  {activeOsd.value}%
                </div>
              ) : activeOsd.badge ? (
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                    activeOsd.badge === "ON"
                      ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      : "bg-white/10 text-zinc-400"
                  }`}
                >
                  {activeOsd.badge}
                </span>
              ) : null}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default HardwareOsdPill;
