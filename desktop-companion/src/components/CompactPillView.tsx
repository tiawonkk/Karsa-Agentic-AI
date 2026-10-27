import React, { useState, useEffect } from "react";

interface CompactPillViewProps {
  isDark?: boolean;
  hasPendingApproval?: boolean;
}

/**
 * CompactPillView: Clean, minimal status pill (210px x 38px).
 * - Left: Green status progress ring (#10B981) or Amber Alert Ring
 * - Center: Bold digital clock in JetBrains Mono (HH:mm) with WCAG AAA contrast
 * - Right: 5 dynamic animated waveform bars in dark/light contrast
 */
export const CompactPillView: React.FC<CompactPillViewProps> = ({
  isDark = true,
  hasPendingApproval = false,
}) => {
  const [timeStr, setTimeStr] = useState("10:03");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTimeStr(
        now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="w-full h-full flex items-center justify-between px-2.5 cursor-pointer select-none">
      {/* Left: Status Ring (#10B981 or Amber if Pending Approval) */}
      <div className="flex items-center gap-1.5">
        <div
          className={`w-4 h-4 rounded-full border-2 p-0.5 flex items-center justify-center ${
            hasPendingApproval
              ? "border-[#D95D39] bg-[#D95D39]/20 shadow-[0_0_8px_rgba(217,93,57,0.5)]"
              : "border-[#10B981]"
          }`}
        >
          <div
            className={`w-1.5 h-1.5 rounded-full ${
              hasPendingApproval ? "bg-[#D95D39] animate-ping" : "bg-[#10B981] animate-pulse"
            }`}
          />
        </div>
        {hasPendingApproval && (
          <span className="text-[10px] font-mono text-[#D95D39] font-bold">IZIN</span>
        )}
      </div>

      {/* Center: Bold Digital Clock in JetBrains Mono (Rule 1 & 2) */}
      <div className="font-mono font-bold text-[12px] tracking-tight leading-none text-[#09090B] dark:text-[#FAFAFA]">
        {timeStr}
      </div>

      {/* Right: 5 Dynamic Animated Waveform Bars */}
      <div className="flex items-end gap-0.5 h-3.5">
        <span
          className={`w-0.5 h-2 rounded-full animate-pulse ${
            isDark ? "bg-zinc-200" : "bg-zinc-800"
          }`}
        />
        <span
          className={`w-0.5 h-3.5 rounded-full animate-pulse delay-75 ${
            isDark ? "bg-zinc-200" : "bg-zinc-800"
          }`}
        />
        <span
          className={`w-0.5 h-1.5 rounded-full animate-pulse delay-150 ${
            isDark ? "bg-zinc-200" : "bg-zinc-800"
          }`}
        />
        <span
          className={`w-0.5 h-3 rounded-full animate-pulse delay-100 ${
            isDark ? "bg-zinc-200" : "bg-zinc-800"
          }`}
        />
        <span
          className={`w-0.5 h-2.5 rounded-full animate-pulse delay-200 ${
            isDark ? "bg-zinc-200" : "bg-zinc-800"
          }`}
        />
      </div>
    </div>
  );
};

export default CompactPillView;
