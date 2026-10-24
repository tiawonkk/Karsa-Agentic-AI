import React from "react";
import { RefreshCw, WifiOff } from "lucide-react";

/** Honest state when the local Karsa server is not reachable (instead of a spinner that never ends). */
export const OfflineNotice: React.FC<{ onRetry: () => void; compact?: boolean }> = ({ onRetry, compact }) =>
  compact ? (
    <span className="flex items-center gap-1.5 text-[11.5px] font-medium text-rose-500 whitespace-nowrap">
      <WifiOff className="w-3.5 h-3.5" /> Server offline
    </span>
  ) : (
    <div className="h-full flex flex-col items-center justify-center gap-2 text-center">
      <WifiOff className="w-5 h-5 text-rose-500" />
      <div className="text-[11.5px] font-medium text-ink">Server Karsa tidak terjangkau</div>
      <div className="text-[10.5px] text-ink-muted">Jalankan backend di port 8765, lalu coba lagi.</div>
      <button
        type="button"
        onClick={onRetry}
        className="px-3 h-7 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95"
      >
        <RefreshCw className="w-3 h-3" /> Coba lagi
      </button>
    </div>
  );

/** Thin progress line along the bottom of an S pill (0-100). */
export const PillProgress: React.FC<{ pct: number; color: string }> = ({ pct, color }) => (
  <div className="absolute left-3 right-3 bottom-[3px] h-[2px] rounded-full bg-pill overflow-hidden pointer-events-none" aria-hidden="true">
    <div
      className="h-full rounded-full transition-all duration-500"
      style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
    />
  </div>
);
