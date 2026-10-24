import React from "react";

export interface LiquidGlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  isDark?: boolean;
  specular?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * LiquidGlassCard: Material kaca cair (True Liquid Glassmorphism)
 * Mengadopsi standar spesifikasi:
 * - Light: backdrop-blur-2xl bg-white/45 border-white/40 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)]
 *          dengan kilauan specular di tepi atas: before:via-white/80
 * - Dark:  backdrop-blur-2xl bg-zinc-950/60 border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.6)]
 *          dengan specular line: before:via-white/20
 */
export const LiquidGlassCard = React.forwardRef<HTMLDivElement, LiquidGlassCardProps>(
  ({ isDark = true, specular = true, className = "", children, ...props }, ref) => {
    const glassBase = isDark
      ? "backdrop-blur-2xl bg-zinc-950/60 border border-white/10 shadow-[0_16px_40px_rgba(0,0,0,0.6)] text-zinc-100"
      : "backdrop-blur-2xl bg-white/45 border border-white/40 shadow-[0_8px_32px_0_rgba(31,38,135,0.07)] text-zinc-900";

    const specularClass = specular
      ? isDark
        ? "relative before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-transparent before:via-white/20 before:to-transparent before:pointer-events-none before:z-10"
        : "relative before:absolute before:inset-x-0 before:top-0 before:h-[1px] before:bg-gradient-to-r before:from-transparent before:via-white/80 before:to-transparent before:pointer-events-none before:z-10"
      : "";

    return (
      <div
        ref={ref}
        className={`${glassBase} ${specularClass} ${className}`}
        {...props}
      >
        {children}
      </div>
    );
  }
);

LiquidGlassCard.displayName = "LiquidGlassCard";

export interface LiquidPillButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  className?: string;
}

/**
 * LiquidPillButton: Tombol pil kaca cair seragam tanpa warna pelangi
 * Styling: bg-white/20 hover:bg-white/35 active:scale-95 border border-white/30 backdrop-blur-md font-mono text-xs
 */
export const LiquidPillButton = React.forwardRef<HTMLButtonElement, LiquidPillButtonProps>(
  ({ children, className = "", ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        className={`bg-white/20 hover:bg-white/35 active:scale-95 border border-white/30 backdrop-blur-md text-zinc-900 dark:text-zinc-100 font-mono text-xs px-3 py-1.5 rounded-xl transition-all cursor-pointer select-none inline-flex items-center justify-center gap-1.5 ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);

LiquidPillButton.displayName = "LiquidPillButton";

export default LiquidGlassCard;
