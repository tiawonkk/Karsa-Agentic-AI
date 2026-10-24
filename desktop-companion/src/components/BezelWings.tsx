import React from "react";

interface BezelWingsProps {
  isDark?: boolean;
  showBacklight?: boolean;
}

/**
 * BezelWings: Concave reverse-curve wings (ears) that blend the top edges
 * of the Dynamic Island seamlessly into the physical top bezel of the monitor.
 * Incorporates an ambient backlight gradient glow behind the notch.
 */
export const BezelWings: React.FC<BezelWingsProps> = ({
  isDark = true,
  showBacklight = true,
}) => {
  const notchColor = isDark ? "rgba(24, 24, 29, 0.92)" : "rgba(255, 255, 255, 0.95)";

  return (
    <>
      {/* Ambient Backlight Aura (Deep Indigo & Violet Glow) */}
      {showBacklight && (
        <div
          className="absolute -top-6 left-1/2 -translate-x-1/2 w-[120%] h-32 rounded-full pointer-events-none -z-10 blur-2xl opacity-70 transition-opacity duration-700"
          style={{
            background: isDark
              ? "radial-gradient(ellipse at top, rgba(59, 130, 246, 0.22) 0%, rgba(147, 51, 234, 0.15) 45%, transparent 75%)"
              : "radial-gradient(ellipse at top, rgba(255, 255, 255, 0.8) 0%, rgba(224, 231, 255, 0.35) 45%, transparent 75%)",
          }}
        />
      )}

      {/* Left Concave Wing (C1-continuous reverse-curve ear) */}
      <svg
        className="absolute top-0 -left-[17.5px] w-[18px] h-[18px] pointer-events-none z-30"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M 0 0 A 18 18 0 0 0 18 18 L 18 0 Z"
          fill={notchColor}
        />
      </svg>

      {/* Right Concave Wing (C1-continuous reverse-curve ear) */}
      <svg
        className="absolute top-0 -right-[17.5px] w-[18px] h-[18px] pointer-events-none z-30"
        viewBox="0 0 18 18"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M 0 18 A 18 18 0 0 0 18 0 L 0 0 Z"
          fill={notchColor}
        />
      </svg>
    </>
  );
};

export default BezelWings;
