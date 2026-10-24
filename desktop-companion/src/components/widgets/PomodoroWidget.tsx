import React from "react";
import { Coffee, Pause, Play, RotateCcw, Target, Timer, Volume2, VolumeX } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { PillProgress } from "./WidgetBits";
import { SessionType, formatClock, pomodoro, usePomodoro } from "../../stores/pomodoroStore";

const LABEL: Record<SessionType, string> = {
  focus: "Focus time",
  short_break: "Short break",
  long_break: "Long break",
};

const chip = (active: boolean) =>
  `px-2 py-0.5 rounded-full text-[10.5px] font-mono font-bold cursor-pointer transition-colors ${
    active ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"
  }`;

export const PomodoroBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const p = usePomodoro();
  const pct = p.totalSec > 0 ? ((p.totalSec - p.remainingSec) / p.totalSec) * 100 : 0;

  const playBtn = (cls: string) => (
    <button
      type="button"
      onClick={() => pomodoro.toggle()}
      className={`rounded-full bg-[#ff4d5e] hover:bg-[#ff6070] text-white flex items-center justify-center active:scale-95 transition-transform cursor-pointer ${cls}`}
      title={p.running ? "Jeda Timer" : "Mulai Timer"}
      aria-label={p.running ? "Jeda" : "Mulai"}
    >
      {p.running ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
    </button>
  );

  if (size === "S") {
    return (
      <div className="w-full flex items-center justify-between gap-2 pr-1">
        <span className="font-mono font-bold text-[15px] text-ink flex items-center gap-1.5">
          <span aria-hidden="true">🍅</span>
          {formatClock(p.remainingSec)}
        </span>
        {playBtn("w-7 h-7")}
        <PillProgress pct={pct} color="#fb7185" />
      </div>
    );
  }

  const ring = (
    <div className="relative w-[58px] h-[58px] flex-shrink-0 flex items-center justify-center">
      <svg className="w-[58px] h-[58px] -rotate-90" viewBox="0 0 36 36">
        <path
          stroke="var(--border-subtle)"
          strokeWidth="3.4"
          fill="none"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
        <path
          className="transition-all duration-300"
          stroke="#fb7185"
          strokeDasharray={`${Math.max(pct, 3)}, 100`}
          strokeWidth="3.4"
          strokeLinecap="round"
          fill="none"
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
        />
      </svg>
      <Timer className="absolute w-5 h-5 text-rose-500" />
    </div>
  );

  const mainRow = (
    <div className="flex items-center gap-3">
      {ring}
      <div className="min-w-0">
        <div className="font-mono font-bold text-[28px] leading-none text-ink">{formatClock(p.remainingSec)}</div>
        <div className="text-[11px] text-ink-2 mt-1 font-medium">
          {LABEL[p.sessionType]} · {p.completed} sesi
        </div>
      </div>
    </div>
  );

  const controls = (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => pomodoro.selectSession("short_break")}
        className={`px-2.5 h-7 rounded-full text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
          p.sessionType === "short_break" ? "bg-accent text-white" : "bg-pill text-ink hover:brightness-110"
        }`}
      >
        <Coffee className="w-3 h-3" /> Break
      </button>
      {playBtn("w-12 h-7")}
      <button
        type="button"
        onClick={() => pomodoro.selectSession("focus")}
        className={`px-2.5 h-7 rounded-full text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors ${
          p.sessionType === "focus" ? "bg-accent text-white" : "bg-pill text-ink hover:brightness-110"
        }`}
      >
        <Target className="w-3 h-3" /> Focus
      </button>
      <button
        type="button"
        onClick={() => pomodoro.reset()}
        className="w-7 h-7 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer"
        title="Reset Waktu"
        aria-label="Reset"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
    </div>
  );

  if (size === "M") {
    return (
      <div className="h-full flex flex-col justify-between gap-2.5">
        {mainRow}
        {controls}
      </div>
    );
  }

  // L: full duration settings + alarm toggle
  const presets: Array<{ type: SessionType; label: string; values: number[] }> = [
    { type: "focus", label: "Focus", values: [15, 25, 45, 60] },
    { type: "short_break", label: "Short", values: [5, 10] },
    { type: "long_break", label: "Long", values: [15, 30] },
  ];
  return (
    <div className="h-full flex flex-col gap-3 overflow-y-auto">
      {mainRow}
      {controls}
      <div className="space-y-1.5 border-t border-subtle pt-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Durasi (menit)</div>
        {presets.map((row) => (
          <div key={row.type} className="flex items-center gap-1.5">
            <span className="w-10 text-[10.5px] font-medium text-ink-2">{row.label}</span>
            {row.values.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  pomodoro.setDuration(row.type, m);
                  if (p.sessionType !== row.type) pomodoro.selectSession(row.type);
                }}
                className={chip(p.durations[row.type] === m)}
              >
                {m}
              </button>
            ))}
          </div>
        ))}
        <div className="flex items-center gap-1.5 pt-0.5">
          <span className="w-10 text-[10.5px] font-medium text-ink-2">Atur</span>
          <button type="button" onClick={() => pomodoro.adjustCurrent(-5)} className={chip(false)}>
            -5m
          </button>
          <button type="button" onClick={() => pomodoro.adjustCurrent(5)} className={chip(false)}>
            +5m
          </button>
          <button
            type="button"
            onClick={() => pomodoro.setMuted(!p.muted)}
            className={`ml-auto w-7 h-6 rounded-full flex items-center justify-center cursor-pointer ${
              p.muted ? "bg-rose-500/20 text-rose-500" : "bg-pill text-ink-2 hover:text-ink"
            }`}
            title={p.muted ? "Bunyi alarm mati" : "Bunyi alarm aktif"}
            aria-label="Alarm"
          >
            {p.muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
};
