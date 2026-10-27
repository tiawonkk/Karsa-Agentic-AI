import React from "react";
import { motion } from "framer-motion";

export type ShellMode = "IDLE_EYES" | "COMPACT_PILL" | "PEEK" | "SYSTEM_TOAST" | "EXPANDED";

interface NotchShellProps {
  mode: ShellMode;
  isDark?: boolean;
  /** Sleeping: the colour glow stops drifting (Zero-Heat) */
  calm?: boolean;
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
 * NotchShell: the top micro-notch. Every colour comes from the theme variables (--bg-glass, --border-subtle,
 * --text-primary, --shadow-soft), so the Light/Dark toggle repaints it instantly. The concave ears use the same
 * fill as the body so the island flows out of the screen edge.
 * Sizes: idle/compact 210x52, peek 290x54, OSD toast 265x40, expanded bar 560x262.
 */
export const NotchShell: React.FC<NotchShellProps> = ({ mode, calm = false, onClick, children }) => {
  let widthClass = "w-[210px]";
  let heightClass = "h-[52px]";
  let radiusClass = "rounded-b-[26px]";

  if (mode === "PEEK") {
    widthClass = "w-[290px]";
    heightClass = "h-[54px]";
    radiusClass = "rounded-b-[26px]";
  } else if (mode === "SYSTEM_TOAST") {
    widthClass = "w-[265px]";
    heightClass = "h-[40px]";
    radiusClass = "rounded-b-[20px]";
  } else if (mode === "EXPANDED") {
    widthClass = "w-[560px]";
    heightClass = "h-[262px]";
    radiusClass = "rounded-b-[34px]";
  }

  const ear = { fill: "var(--island-bg)" } as React.CSSProperties;

  return (
    <motion.div
      layout
      transition={springPhysics}
      onClick={onClick}
      style={{
        background: "var(--island-bg)",
        color: "var(--text-primary)",
        borderColor: "var(--border-subtle)",
        boxShadow: "var(--glass-shadow)",
        backdropFilter: "blur(30px) saturate(190%)",
        WebkitBackdropFilter: "blur(30px) saturate(190%)",
      }}
      className={`relative ${widthClass} ${heightClass} ${radiusClass} border border-t-0 select-none font-sans z-50 pointer-events-auto transition-all duration-200`}
    >
      {/* Left concave shoulder */}
      <svg
        className="absolute top-0 -left-[19.5px] w-[20px] h-[20px] pointer-events-none z-30"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M 0 0 C 11.046 0 20 8.954 20 20 L 20 0 Z" style={ear} />
      </svg>

      {/* Right concave shoulder */}
      <svg
        className="absolute top-0 -right-[19.5px] w-[20px] h-[20px] pointer-events-none z-30"
        viewBox="0 0 20 20"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M 20 0 C 8.954 0 0 8.954 0 20 L 0 0 Z" style={ear} />
      </svg>

      {/* Colour glow inside the glass (aurora): a soft rainbow that drifts slowly; paused while the app sleeps */}
      <div
        className={`karsa-aurora absolute inset-0 overflow-hidden pointer-events-none ${radiusClass} ${calm ? "karsa-aurora-calm" : ""} ${
          mode === "EXPANDED" ? "opacity-60" : ""
        }`}
        aria-hidden="true"
      />

      <div
        className={`relative w-full h-full overflow-hidden flex flex-col justify-between ${
          mode === "IDLE_EYES" || mode === "COMPACT_PILL" || mode === "PEEK"
            ? "px-3 py-1 justify-center"
            : mode === "SYSTEM_TOAST"
            ? "px-3.5 py-1.5 justify-center"
            : "px-5 pt-2.5 pb-2"
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
};

export default NotchShell;
