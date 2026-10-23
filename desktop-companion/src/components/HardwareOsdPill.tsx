import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Volume2,
  Volume1,
  VolumeX,
  Sun,
  Lock,
  Unlock,
  BatteryCharging,
  Battery,
  Music,
} from "lucide-react";

export type OsdType = "volume" | "brightness" | "capslock" | "numlock" | "battery" | "media";

export interface OsdState {
  type: OsdType;
  title: string;
  value?: number; // 0-100 for volume / brightness
  badge?: string;
  icon?: string;
}

interface HardwareOsdPillProps {
  isDark?: boolean;
}

export const HardwareOsdPill: React.FC<HardwareOsdPillProps> = ({ isDark = true }) => {
  const [activeOsd, setActiveOsd] = useState<OsdState | null>(null);
  const dismissTimer = useRef<NodeJS.Timeout | null>(null);

  const showOsd = (osd: OsdState, durationMs: number = 1600) => {
    setActiveOsd(osd);
    if (dismissTimer.current) {
      clearTimeout(dismissTimer.current);
    }
    dismissTimer.current = setTimeout(() => {
      setActiveOsd(null);
    }, durationMs);
  };

  useEffect(() => {
    // 1. Keyboard event listener for lock keys and media keys
    const handleKeyDown = (e: KeyboardEvent) => {
      // CapsLock
      if (e.key === "CapsLock") {
        const isCapsOn = e.getModifierState("CapsLock");
        showOsd({
          type: "capslock",
          title: "Caps Lock",
          badge: isCapsOn ? "ON" : "OFF",
        });
      }
      // NumLock
      else if (e.key === "NumLock") {
        const isNumOn = e.getModifierState("NumLock");
        showOsd({
          type: "numlock",
          title: "Num Lock",
          badge: isNumOn ? "ON" : "OFF",
        });
      }
      // Volume keys
      else if (e.key === "AudioVolumeUp") {
        showOsd({
          type: "volume",
          title: "Volume",
          value: 75,
        });
      } else if (e.key === "AudioVolumeDown") {
        showOsd({
          type: "volume",
          title: "Volume",
          value: 45,
        });
      } else if (e.key === "AudioVolumeMute") {
        showOsd({
          type: "volume",
          title: "Mute",
          value: 0,
        });
      }
    };

    // 2. Custom event listener for simulated or backend OS hardware flyout
    const handleCustomOsd = (e: Event) => {
      const customEvent = e as CustomEvent<OsdState>;
      if (customEvent.detail) {
        showOsd(customEvent.detail);
      }
    };

    // 3. Battery status listener
    if (typeof navigator !== "undefined" && "getBattery" in navigator) {
      (navigator as any).getBattery?.().then((battery: any) => {
        const onChargingChange = () => {
          showOsd({
            type: "battery",
            title: battery.charging ? "Power Connected" : "On Battery",
            value: Math.round(battery.level * 100),
            badge: battery.charging ? "Charging" : `${Math.round(battery.level * 100)}%`,
          });
        };
        battery.addEventListener("chargingchange", onChargingChange);
      }).catch(() => {});
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("karsa:osd" as any, handleCustomOsd);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("karsa:osd" as any, handleCustomOsd);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <AnimatePresence>
      {activeOsd && (
        <motion.div
          initial={{ y: -40, opacity: 0, scale: 0.94 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -30, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", stiffness: 480, damping: 32 }}
          className="fixed top-0 left-1/2 -translate-x-1/2 z-[60] pointer-events-none select-none font-sans"
        >
          <div
            className={`h-[42px] min-w-[240px] px-4 rounded-b-2xl border border-t-0 shadow-2xl flex items-center justify-between gap-3 backdrop-blur-xl ${
              isDark
                ? "bg-[#000000]/95 border-white/15 text-zinc-100 shadow-black/80"
                : "bg-[#FAF9F6]/95 border-zinc-200/90 text-zinc-900 shadow-zinc-400/30"
            }`}
            style={{
              boxShadow: isDark
                ? "0 14px 34px -6px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.08)"
                : "0 14px 34px -6px rgba(0, 0, 0, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.04)",
            }}
          >
            {/* Left Icon */}
            <div className="flex items-center gap-2">
              {activeOsd.type === "volume" && (
                activeOsd.value === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (activeOsd.value ?? 50) > 50 ? (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Volume1 className="w-4 h-4 text-emerald-400" />
                )
              )}
              {activeOsd.type === "brightness" && <Sun className="w-4 h-4 text-amber-400" />}
              {activeOsd.type === "capslock" && (
                activeOsd.badge === "ON" ? (
                  <Lock className="w-4 h-4 text-amber-400" />
                ) : (
                  <Unlock className="w-4 h-4 text-zinc-400" />
                )
              )}
              {activeOsd.type === "numlock" && <Lock className="w-4 h-4 text-emerald-400" />}
              {activeOsd.type === "battery" && (
                activeOsd.badge === "Charging" ? (
                  <BatteryCharging className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Battery className="w-4 h-4 text-zinc-300" />
                )
              )}
              {activeOsd.type === "media" && <Music className="w-4 h-4 text-indigo-400" />}

              <span className="text-xs font-semibold tracking-tight">{activeOsd.title}</span>
            </div>

            {/* Right: Progress Slider or Badge */}
            {activeOsd.value !== undefined ? (
              <div className="flex items-center gap-2 flex-1 max-w-[120px] ml-2">
                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-teal-300 rounded-full transition-all duration-150"
                    style={{ width: `${Math.min(100, Math.max(0, activeOsd.value))}%` }}
                  />
                </div>
                <span className="font-mono text-[10px] text-zinc-400 w-7 text-right">
                  {activeOsd.value}%
                </span>
              </div>
            ) : activeOsd.badge ? (
              <span
                className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-md ${
                  activeOsd.badge === "ON" || activeOsd.badge === "Charging"
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                    : "bg-white/10 text-zinc-400"
                }`}
              >
                {activeOsd.badge}
              </span>
            ) : null}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default HardwareOsdPill;
