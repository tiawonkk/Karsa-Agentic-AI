import React, { useState, useEffect } from "react";
import { Droplet, Plus, Sparkles } from "lucide-react";

interface HourlyPoint {
  hour: string;
  amount_ml: number;
}

interface HydrationSlideProps {
  isDark: boolean;
}

export const HydrationSlide: React.FC<HydrationSlideProps> = ({ isDark }) => {
  const [totalMl, setTotalMl] = useState(0);
  const [dailyTargetMl, setDailyTargetMl] = useState(2000);
  const [hourlyChart, setHourlyChart] = useState<HourlyPoint[]>([]);
  const [isLogging, setIsLogging] = useState(false);

  const fetchHydration = async () => {
    try {
      const res = await fetch("/api/v1/hydration/today");
      if (res.ok) {
        const data = await res.json();
        setTotalMl(data.total_ml || 0);
        setDailyTargetMl(data.daily_target_ml || 2000);
        setHourlyChart(data.hourly_chart || []);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchHydration();
  }, []);

  const handleAddWater = async (amount: number) => {
    if (isLogging) return;
    setIsLogging(true);
    try {
      const res = await fetch("/api/v1/hydration/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_ml: amount, daily_target_ml: dailyTargetMl }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.summary) {
          setTotalMl(data.summary.total_ml);
          setHourlyChart(data.summary.hourly_chart);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLogging(false);
    }
  };

  const percentage = Math.min(100, Math.round((totalMl / dailyTargetMl) * 100));

  // Max value in chart for scaling
  const maxHourlyMl = Math.max(
    300,
    ...hourlyChart.map((h) => h.amount_ml)
  );

  return (
    <div
      className={`w-full rounded-2xl p-3.5 transition-colors flex flex-col justify-between ${
        isDark ? "bg-[#0c0c0e] border border-white/8" : "bg-white border border-zinc-200 shadow-sm"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-cyan-400">
          <Droplet className="w-4 h-4 fill-current" />
          <span>Water Reminder & Hidrasi</span>
        </div>
        <div className="text-[10px] font-mono text-zinc-400">
          Target: <span className="text-zinc-200 font-bold">{dailyTargetMl} ml</span>
        </div>
      </div>

      {/* Middle: Progress Circle & Metrics */}
      <div className="flex items-center justify-between my-1 px-2">
        <div className="flex items-center gap-3">
          {/* Progress Circular Ring */}
          <div className="relative w-14 h-14 flex items-center justify-center flex-shrink-0">
            <svg className="w-14 h-14 transform -rotate-90" viewBox="0 0 36 36">
              <path
                className="text-white/10"
                strokeWidth="3.2"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
              <path
                className="text-cyan-400 transition-all duration-500"
                strokeDasharray={`${percentage}, 100`}
                strokeWidth="3.2"
                strokeLinecap="round"
                stroke="currentColor"
                fill="none"
                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center font-mono font-bold text-xs text-cyan-300">
              {percentage}%
            </div>
          </div>

          <div>
            <div className="text-xl font-mono font-extrabold text-white leading-none">
              {totalMl.toLocaleString("id-ID")}{" "}
              <span className="text-xs font-normal text-zinc-400">ml</span>
            </div>
            <p className="text-[10px] text-zinc-400 mt-0.5">
              {percentage >= 100 ? "🎉 Target harian tercapai!" : "Tetap terhidrasi saat ngoding"}
            </p>
          </div>
        </div>

        {/* Quick Add Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleAddWater(200)}
            disabled={isLogging}
            className="px-2.5 py-1.5 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 text-cyan-300 text-xs font-medium transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>200ml</span>
          </button>
          <button
            type="button"
            onClick={() => handleAddWater(500)}
            disabled={isLogging}
            className="px-2.5 py-1.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-md transition-all active:scale-95 flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            <span>500ml</span>
          </button>
        </div>
      </div>

      {/* Hourly Intake Bar Chart (09:00 - 21:00) */}
      <div className="mt-1 pt-2 border-t border-white/5">
        <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider mb-1 flex justify-between">
          <span>Konsumsi Per Jam (09:00 - 21:00)</span>
          <span>SQLite Real-time</span>
        </div>
        <div className="flex items-end justify-between h-9 gap-1 px-1">
          {hourlyChart.map((item) => {
            const heightPct = item.amount_ml > 0 ? Math.max(16, (item.amount_ml / maxHourlyMl) * 100) : 6;
            const hasIntake = item.amount_ml > 0;
            return (
              <div
                key={item.hour}
                className="flex-1 flex flex-col items-center gap-0.5 group relative"
                title={`${item.hour}: ${item.amount_ml} ml`}
              >
                <div className="w-full bg-white/5 rounded-t-sm h-8 flex items-end overflow-hidden">
                  <div
                    className={`w-full rounded-t-sm transition-all duration-300 ${
                      hasIntake ? "bg-gradient-to-t from-cyan-600 to-cyan-400" : "bg-white/10"
                    }`}
                    style={{ height: `${heightPct}%` }}
                  />
                </div>
                <span className="text-[7.5px] font-mono text-zinc-500">{item.hour.slice(0, 2)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default HydrationSlide;
