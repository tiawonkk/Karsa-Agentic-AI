import React from "react";
import { motion, AnimatePresence } from "framer-motion";

export type ShellMode = "IDLE_EYES" | "COMPACT_PILL" | "SYSTEM_TOAST" | "EXPANDED";

interface NotchShellProps {
  mode: ShellMode;
  isLyricsExpanded?: boolean;
  isDark?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}

const springPhysics = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
  mass: 0.8,
};

/**
 * NotchShell: The physical bezel-blended chassis of Dynamic Island V3.
 * Features:
 * - Pure OLED Pitch-Black (#000000) blending directly with monitor top bezel.
 * - S-Curve Concave Shoulder Fillets (C1-continuous) that transition the notch into the top frame.
 * - Dynamic dimension scaling using clamp() across 4 distinct modes:
 *    1. IDLE_EYES: clamp(190px, 14vw, 210px) x 38px
 *    2. COMPACT_PILL: clamp(210px, 16vw, 240px) x 38px
 *    3. SYSTEM_TOAST: clamp(340px, 26vw, 380px) x 68px
 *    4. EXPANDED: clamp(480px, 36vw, 540px) x 185px (or 580px when Live Lyrics split view is active)
 * - Soft ambient backlight glow (Deep Indigo & Violet aura).
 */
export const NotchShell: React.FC<NotchShellProps> = ({
  mode,
  isLyricsExpanded = false,
  isDark = true,
  onClick,
  children,
}) => {
  // Compute target width and height based on mode
  let widthClass = "w-[190px]";
  let heightClass = "h-[38px]";
  let radiusClass = "rounded-b-[20px]";

  if (mode === "IDLE_EYES") {
    widthClass = "w-[clamp(190px,14vw,200px)]";
    heightClass = "h-[38px]";
    radiusClass = "rounded-b-[20px]";
  } else if (mode === "COMPACT_PILL") {
    widthClass = "w-[clamp(210px,16vw,230px)]";
    heightClass = "h-[38px]";
    radiusClass = "rounded-b-[20px]";
  } else if (mode === "SYSTEM_TOAST") {
    widthClass = "w-[clamp(340px,25vw,360px)]";
    heightClass = "h-[68px]";
    radiusClass = "rounded-b-[26px]";
  } else if (mode === "EXPANDED") {
    widthClass = isLyricsExpanded
      ? "w-[clamp(580px,44vw,620px)] max-w-[94vw]"
      : "w-[clamp(480px,36vw,540px)] max-w-[94vw]";
    heightClass = "h-[185px]";
    radiusClass = "rounded-b-[32px]";
  }

  return (
    <motion.div
      layout
      transition={springPhysics}
      onClick={onClick}
      className={`relative ${widthClass} ${heightClass} ${radiusClass} border border-t-0 shadow-2xl transition-colors duration-200 select-none font-sans z-50 ${
        isDark
          ? "bg-[#000000] border-white/10 text-zinc-100"
          : "bg-[#FAF9F6] border-zinc-200/90 text-zinc-900"
      }`}
      style={{
        boxShadow: isDark
          ? "0 22px 60px -8px rgba(0, 0, 0, 0.9), 0 0 1px 1px rgba(255, 255, 255, 0.08)"
          : "0 20px 50px -8px rgba(217, 93, 57, 0.12), 0 0 1px 1px rgba(0, 0, 0, 0.04)",
      }}
    >
      {/* 1. Ambient Backlight Gradient Glow (Deep Indigo & Violet Aura) */}
      <div
        className="absolute -top-8 left-1/2 -translate-x-1/2 w-[125%] h-36 rounded-full pointer-events-none -z-10 blur-2xl opacity-60 transition-opacity duration-700"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(59, 130, 246, 0.24) 0%, rgba(147, 51, 234, 0.18) 45%, transparent 75%)",
        }}
      />

      {/* 2. Left S-Curve Concave Shoulder Fillet (Width: 20px, Height: 20px) */}
      <svg
        className="absolute top-0 -left-[20px] w-[20px] h-[20px] pointer-events-none z-30"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M 0 0 C 11.046 0 20 8.954 20 20 L 20 0 Z"
          fill={isDark ? "#000000" : "#FAF9F6"}
        />
      </svg>

      {/* 3. Right S-Curve Concave Shoulder Fillet (Width: 20px, Height: 20px) */}
      <svg
        className="absolute top-0 -right-[20px] w-[20px] h-[20px] pointer-events-none z-30"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M 20 0 C 8.954 0 0 8.954 0 20 L 0 0 Z"
          fill={isDark ? "#000000" : "#FAF9F6"}
        />
      </svg>

      {/* 4. Notch Body Content */}
      <div
        className={`w-full h-full overflow-hidden flex flex-col justify-between ${
          mode === "IDLE_EYES" || mode === "COMPACT_PILL"
            ? "px-2 py-0.5 justify-center"
            : mode === "SYSTEM_TOAST"
            ? "px-3 py-1 justify-center"
            : "p-2.5"
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
};

export default NotchShell;
