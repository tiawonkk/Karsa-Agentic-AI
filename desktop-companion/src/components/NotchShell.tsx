import React from "react";
import { motion } from "framer-motion";

export type ShellMode = "IDLE_EYES" | "COMPACT_PILL" | "PEEK" | "SYSTEM_TOAST" | "EXPANDED";

interface NotchShellProps {
  mode: ShellMode;
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
 * NotchShell: the top micro-notch. Every colour comes from the theme variables (--bg-glass, --border-subtle,
 * --text-primary, --shadow-soft), so the Light/Dark toggle repaints it instantly. The concave ears use the same
 * fill as the body so the island flows out of the screen edge.
 * Sizes: idle/compact 145x30, peek 220x40, OSD toast 265x40, expanded bar 380x115.
 */
export const NotchShell: React.FC<NotchShellProps> = ({ mode, onClick, children }) => {
  let widthClass = "w-[145px]";
  let heightClass = "h-[30px]";
  let radiusClass = "rounded-b-[18px]";

  if (mode === "PEEK") {
    widthClass = "w-[220px]";
    heightClass = "h-[40px]";
    radiusClass = "rounded-b-[20px]";
  } else if (mode === "SYSTEM_TOAST") {
    widthClass = "w-[265px]";
    heightClass = "h-[40px]";
    radiusClass = "rounded-b-[20px]";
  } else if (mode === "EXPANDED") {
    widthClass = "w-[380px]";
    heightClass = "h-[115px]";
    radiusClass = "rounded-b-[24px]";
  }

  const ear = { fill: "var(--bg-glass)" } as React.CSSProperties;

  return (
    <motion.div
      layout
      transition={springPhysics}
      onClick={onClick}
      style={{
        background: "var(--bg-glass)",
        color: "var(--text-primary)",
        borderColor: "var(--border-subtle)",
        boxShadow: "var(--shadow-soft)",
        backdropFilter: "blur(24px) saturate(160%)",
        WebkitBackdropFilter: "blur(24px) saturate(160%)",
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

      <div
        className={`w-full h-full overflow-hidden flex flex-col justify-between ${
          mode === "IDLE_EYES" || mode === "COMPACT_PILL" || mode === "PEEK"
            ? "px-3 py-1 justify-center"
            : mode === "SYSTEM_TOAST"
            ? "px-3.5 py-1.5 justify-center"
            : "px-3.5 py-2"
        }`}
      >
        {children}
      </div>
    </motion.div>
  );
};

export default NotchShell;
