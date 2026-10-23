import React, { useState, useEffect } from "react";
import { Droplet, Bell, SlidersHorizontal, ChevronLeft, ChevronRight } from "lucide-react";

interface HourlyPoint {
  hour: string;
  amount_ml: number;
}

interface HydrationSlideProps {
  isDark: boolean;
}

export const HydrationSlide: React.FC<HydrationSlideProps> = ({ isDark }) => {
  const [totalMl, setTotalMl] = useState(1500);
  const [dailyTargetMl, setDailyTargetMl] = useState(1500);
  const [isReminderOn, setIsReminderOn] = useState(true);
  const [hourlyChart, setHourlyChart] = useState<HourlyPoint[]>([
    { hour: "09:00", amount_ml: 260 },
    { hour: "10:00", amount_ml: 180 },
    { hour: "11:00", amount_ml: 220 },
    { hour: "12:00", amount_ml: 140 },
    { hour: "13:00", amount_ml: 190 },
    { hour: "14:00", amount_ml: 240 },
    { hour: "15:00", amount_ml: 270 },
  ]);

  const fetchHydration = async () => {
    try {
      const res = await fetch("/api/v1/hydration/today");
      if (res.ok) {
        const data = await res.json();
        if (data.total_ml !== undefined) {
          setTotalMl(data.total_ml || 1500);
          setDailyTargetMl(data.daily_target_ml || 1500);
          if (data.hourly_chart && data.hourly_chart.length > 0) {
            setHourlyChart(data.hourly_chart.slice(0, 7));
          }
        }
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchHydration();
  }, []);

  const handleDrink = async () => {
    const next = totalMl + 250;
    setTotalMl(next);
    try {
      await fetch("/api/v1/hydration/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_ml: 250, daily_target_ml: dailyTargetMl }),
      });
      fetchHydration();
    } catch (_) {}
  };

  const currentL = (totalMl / 1000).toFixed(1);
  const targetL = (dailyTargetMl / 1000).toFixed(1);
  const pct = Math.min(100, Math.round((totalMl / dailyTargetMl) * 100));

  return (
    <div className="w-full flex items-center justify-between gap-4 select-none px-1 py-0.5">
      {/* Left Column: Metric & Drink Buttons (Reference Image 4) */}
      <div className="flex flex-col justify-between flex-1 max-w-[210px]">
        {/* Metric Counter & Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer transition-colors flex-shrink-0">
              <ChevronLeft className="w-3.5 h-3.5" />
            </div>

            <div>
              <div className="text-2xl font-bold text-white tracking-tight leading-none font-sans">
                {currentL} <span className="text-zinc-400 text-lg font-normal">/ {targetL} L</span>
              </div>
              <div className="text-[10px] text-zinc-400 mt-0.5 font-medium">
                Today • <span className="text-sky-400 font-bold">{pct}%</span> • Goal reached
              </div>
            </div>
          </div>

          {/* Bell Toggle Switch */}
          <button
            type="button"
            onClick={() => setIsReminderOn((prev) => !prev)}
            className={`w-11 h-6 rounded-full transition-colors p-0.5 flex items-center cursor-pointer ${
              isReminderOn ? "bg-sky-500 justify-end" : "bg-white/20 justify-start"
            }`}
          >
            <div className="w-5 h-5 rounded-full bg-white shadow-md flex items-center justify-center">
              <Bell className="w-3 h-3 text-sky-600 fill-current" />
            </div>
          </button>
        </div>

        {/* Blue Progress Bar */}
        <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden my-2 relative">
          <div
            className="h-full bg-sky-400 rounded-full transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Buttons: 💧 Drink & ⚙ Settings */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleDrink}
            className="px-3.5 py-1 rounded-full bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Droplet className="w-3.5 h-3.5 fill-current" />
            <span>Drink</span>
          </button>

          <button
            type="button"
            className="px-3 py-1 rounded-full bg-white/10 hover:bg-white/15 text-zinc-300 text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Right Column: Hourly Histogram (09, 12, 15... 0-400ml) (Reference Image 4) */}
      <div className="flex-1 flex items-center gap-2">
        <div className="flex-1 border-l border-white/10 pl-3">
          <div className="flex items-end justify-between h-[75px] gap-1 px-1">
            {hourlyChart.map((p, idx) => {
              const hPct = Math.min(100, Math.max(15, (p.amount_ml / 400) * 100));
              return (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full bg-white/5 rounded-t-sm h-[60px] flex items-end">
                    <div
                      className="w-full bg-sky-500 rounded-t-sm transition-all duration-300"
                      style={{ height: `${hPct}%` }}
                    />
                  </div>
                  {(idx === 0 || idx === 3 || idx === 6) && (
                    <span className="text-[9px] font-mono text-zinc-500">
                      {p.hour.slice(0, 2)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[8px] font-mono text-zinc-500 mt-0.5 px-1">
            <span>09</span>
            <span>12</span>
            <span>15</span>
          </div>
        </div>

        {/* Right chevron arrow */}
        <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer transition-colors flex-shrink-0">
          <ChevronRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </div>
  );
};

export default HydrationSlide;
