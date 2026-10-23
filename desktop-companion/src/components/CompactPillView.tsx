import React, { useState, useEffect } from "react";

interface CompactPillViewProps {
  isDark?: boolean;
}

/**
 * CompactPillView: Clean, minimal status pill (210px x 38px).
 * - Left: Green status progress ring (#10B981)
 * - Center: Bold digital clock (HH:mm)
 * - Right: 5 dynamic animated white audio waveform bars (|||||)
 */
export const CompactPillView: React.FC<CompactPillViewProps> = ({ isDark = true }) => {
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
      {/* Left: Green Status Ring (#10B981) */}
      <div className="flex items-center gap-2">
        <div className="w-4 h-4 rounded-full border-2 border-[#10B981] p-0.5 flex items-center justify-center">
          <div className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse" />
        </div>
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
