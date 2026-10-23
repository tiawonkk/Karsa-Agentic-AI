import React, { useState, useEffect } from "react";

interface CompactPillViewProps {
  isDark?: boolean;
  hasPendingApproval?: boolean;
}

/**
 * CompactPillView: Clean, minimal status pill (210px x 38px).
 * - Left: Green status progress ring (#10B981) or Amber Alert Ring
 * - Center: Bold digital clock (HH:mm)
 * - Right: 5 dynamic animated white audio waveform bars (|||||)
 */
export const CompactPillView: React.FC<CompactPillViewProps> = ({
  isDark = true,
  hasPendingApproval = false,
}) => {
  const [timeStr, setTimeStr] = useState("07:48");

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
    <div className="w-full h-full flex items-center justify-between px-2 cursor-pointer">
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

      {/* Center: Bold Digital Clock (HH:mm) */}
      <div className="font-mono font-bold text-sm text-white tracking-tight leading-none">
        {timeStr}
      </div>

      {/* Right: 5 Dynamic Animated White Waveform Bars */}
      <div className="flex items-end gap-0.5 h-3.5">
        <span className="w-0.5 h-2 rounded-full bg-white animate-pulse" />
        <span className="w-0.5 h-3.5 rounded-full bg-white animate-pulse delay-75" />
        <span className="w-0.5 h-1.5 rounded-full bg-white animate-pulse delay-150" />
        <span className="w-0.5 h-3 rounded-full bg-white animate-pulse delay-100" />
        <span className="w-0.5 h-2.5 rounded-full bg-white animate-pulse delay-200" />
      </div>
    </div>
  );
};

export default CompactPillView;
