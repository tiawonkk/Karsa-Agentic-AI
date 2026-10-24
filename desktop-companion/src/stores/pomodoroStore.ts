import { useSyncExternalStore } from "react";

/**
 * Pomodoro engine that lives OUTSIDE React. A widget can be closed, resized or moved between the dock and the
 * desktop (which remounts it) without losing the running timer, and the alarm still fires when no widget is open.
 */
export type SessionType = "focus" | "short_break" | "long_break";

export interface PomodoroState {
  sessionType: SessionType;
  totalSec: number;
  remainingSec: number;
  running: boolean;
  completed: number;
  muted: boolean;
  durations: Record<SessionType, number>; // minutes
}

const STORAGE_KEY = "karsa_pomodoro_v1";
const DEFAULT_DURATIONS: Record<SessionType, number> = { focus: 25, short_break: 5, long_break: 15 };

const load = (): Pick<PomodoroState, "durations" | "muted"> => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (raw && typeof raw === "object") {
      const d = raw.durations ?? {};
      const pick = (v: unknown, fallback: number) => (typeof v === "number" && v >= 1 && v <= 180 ? v : fallback);
      return {
        durations: {
          focus: pick(d.focus, DEFAULT_DURATIONS.focus),
          short_break: pick(d.short_break, DEFAULT_DURATIONS.short_break),
          long_break: pick(d.long_break, DEFAULT_DURATIONS.long_break),
        },
        muted: !!raw.muted,
      };
    }
  } catch (_) {}
  return { durations: { ...DEFAULT_DURATIONS }, muted: false };
};

const persisted = load();
let state: PomodoroState = {
  sessionType: "focus",
  totalSec: persisted.durations.focus * 60,
  remainingSec: persisted.durations.focus * 60,
  running: false,
  completed: 0,
  muted: persisted.muted,
  durations: persisted.durations,
};

const listeners = new Set<() => void>();
let endAt = 0;
let timer: ReturnType<typeof setInterval> | null = null;

const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<PomodoroState>) => {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ durations: state.durations, muted: state.muted }));
  } catch (_) {}
  emit();
};

const playChime = () => {
  if (state.muted) return;
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    // Crystal arpeggio: C6 E6 G6 C7
    [1046.5, 1318.51, 1567.98, 2093.0].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const t = ctx.currentTime + i * 0.12;
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.001, t);
      gain.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.9);
    });
  } catch (_) {}
};

const finish = () => {
  stopTimer();
  const finished = state.sessionType;
  const minutes = state.durations[finished];
  playChime();
  try {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(finished === "focus" ? "Sesi fokus selesai! 🍅" : "Istirahat selesai ☕", {
        body: finished === "focus" ? "Saatnya istirahat sejenak." : "Siap lanjut fokus?",
      });
    }
  } catch (_) {}
  // Every finished session is saved to SQLite (focus_sessions)
  fetch("/api/v1/focus/sessions/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ duration_minutes: minutes, session_type: finished === "focus" ? "focus" : "break" }),
  }).catch(() => {});
  set({
    running: false,
    remainingSec: state.totalSec,
    completed: finished === "focus" ? state.completed + 1 : state.completed,
  });
};

const tick = () => {
  const remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000));
  if (remaining <= 0) {
    finish();
  } else if (remaining !== state.remainingSec) {
    set({ remainingSec: remaining });
  }
};

const stopTimer = () => {
  if (timer) clearInterval(timer);
  timer = null;
};

export const pomodoro = {
  getState: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  toggle() {
    if (state.running) {
      stopTimer();
      set({ running: false });
      return;
    }
    try {
      if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
    } catch (_) {}
    endAt = Date.now() + state.remainingSec * 1000;
    timer = setInterval(tick, 500);
    set({ running: true });
  },
  reset() {
    stopTimer();
    set({ running: false, remainingSec: state.totalSec });
  },
  selectSession(type: SessionType) {
    stopTimer();
    const total = state.durations[type] * 60;
    set({ sessionType: type, totalSec: total, remainingSec: total, running: false });
  },
  setDuration(type: SessionType, minutes: number) {
    const m = Math.min(180, Math.max(1, Math.round(minutes)));
    const durations = { ...state.durations, [type]: m };
    if (type === state.sessionType) {
      stopTimer();
      set({ durations, totalSec: m * 60, remainingSec: m * 60, running: false });
    } else {
      set({ durations });
    }
  },
  adjustCurrent(deltaMinutes: number) {
    pomodoro.setDuration(state.sessionType, state.durations[state.sessionType] + deltaMinutes);
  },
  setMuted(muted: boolean) {
    set({ muted });
  },
};

export const usePomodoro = (): PomodoroState => useSyncExternalStore(pomodoro.subscribe, pomodoro.getState);

export const formatClock = (secs: number): string =>
  `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`;
