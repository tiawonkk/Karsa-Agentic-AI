import React, { useState, useEffect } from "react";
import { Play, Pause, RotateCcw, Timer, Coffee, Target, CheckCircle2 } from "lucide-react";

interface PomodoroSlideProps {
  isDark: boolean;
}

export const PomodoroSlide: React.FC<PomodoroSlideProps> = ({ isDark }) => {
  const [sessionType, setSessionType] = useState<"focus" | "short_break">("focus");
  const [totalSeconds, setTotalSeconds] = useState(25 * 60);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [isActive, setIsActive] = useState(false);
  const [completedCount, setCompletedCount] = useState(0);

  // Load past focus sessions for today from SQLite
  useEffect(() => {
    const fetchPastSessions = async () => {
      try {
        const res = await fetch("/api/v1/focus/sessions?limit=20");
        if (res.ok) {
          const data = await res.json();
          const today = new Date().toISOString().slice(0, 10);
          const todaySessions = (data.sessions || []).filter((s: any) =>
            s.timestamp?.startsWith(today)
          );
          setCompletedCount(todaySessions.length);
        }
      } catch (e) {
        // silent fail
      }
    };
    fetchPastSessions();
  }, []);

  // Countdown Interval
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isActive && remainingSeconds > 0) {
      timer = setInterval(() => {
        setRemainingSeconds((prev) => prev - 1);
      }, 1000);
    } else if (remainingSeconds === 0 && isActive) {
      setIsActive(false);
      // Log session to SQLite
      const durationMin = sessionType === "focus" ? 25 : 5;
      fetch("/api/v1/focus/sessions/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          duration_minutes: durationMin,
          session_type: sessionType,
        }),
      }).catch(console.error);

      setCompletedCount((prev) => prev + 1);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isActive, remainingSeconds, sessionType]);

  const selectPreset = (type: "focus" | "short_break", minutes: number) => {
    setIsActive(false);
    setSessionType(type);
    setTotalSeconds(minutes * 60);
    setRemainingSeconds(minutes * 60);
  };

  const handleReset = () => {
    setIsActive(false);
    setRemainingSeconds(totalSeconds);
  };

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const timeFormatted = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;

  const progressPct = ((totalSeconds - remainingSeconds) / totalSeconds) * 100;

  return (
    <div
      className={`w-full rounded-2xl p-3.5 transition-colors flex flex-col justify-between ${
        isDark ? "bg-[#0c0c0e] border border-white/8" : "bg-white border border-zinc-200 shadow-sm"
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 font-semibold text-rose-500">
          <Timer className="w-4 h-4" />
          <span>Pomodoro Timer</span>
        </div>
        <div className="flex items-center gap-1 text-[10px] font-mono text-zinc-400">
          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
          <span>{completedCount} sesi selesai</span>
        </div>
      </div>

      {/* Main Countdown Display */}
      <div className="flex items-center justify-between my-2 px-3">
        {/* Stopwatch Coral Ring */}
        <div className="relative w-16 h-16 flex items-center justify-center flex-shrink-0">
          <svg className="w-16 h-16 transform -rotate-90" viewBox="0 0 36 36">
            <path
              className="text-white/10"
              strokeWidth="3.2"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              className="text-rose-500 transition-all duration-300"
              strokeDasharray={`${progressPct}, 100`}
              strokeWidth="3.2"
              strokeLinecap="round"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <Timer className="w-6 h-6 text-rose-500/80" />
          </div>
        </div>

        {/* Digital Time & Status */}
        <div className="text-center flex-1">
          <div className="text-3xl font-mono font-extrabold tracking-tight text-white leading-none">
            {timeFormatted}
          </div>
          <p className="text-[11px] text-zinc-400 mt-1 capitalize font-medium">
            {sessionType === "focus" ? "🎯 Focus Time" : "☕ Short Break"}
          </p>
        </div>

        {/* Reset Action */}
        <button
          type="button"
          onClick={handleReset}
          className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Reset Waktu"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Preset Action Buttons (Short Break, Play/Pause, Focus Time) */}
      <div className="flex items-center justify-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => selectPreset("short_break", 5)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
            sessionType === "short_break"
              ? "bg-amber-500/20 text-amber-300 border border-amber-500/30"
              : "bg-white/5 hover:bg-white/10 text-zinc-400"
          }`}
        >
          <Coffee className="w-3.5 h-3.5" />
          <span>Short Break</span>
        </button>

        <button
          type="button"
          onClick={() => setIsActive((prev) => !prev)}
          className="w-9 h-9 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer"
        >
          {isActive ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => selectPreset("focus", 25)}
          className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
            sessionType === "focus"
              ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
              : "bg-white/5 hover:bg-white/10 text-zinc-400"
          }`}
        >
          <Target className="w-3.5 h-3.5" />
          <span>Focus Time</span>
        </button>
      </div>
    </div>
  );
};

export default PomodoroSlide;
