import React, { useCallback, useEffect, useRef, useState } from "react";
import { Bell, BellOff, Droplet } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { OfflineNotice, PillProgress } from "./WidgetBits";

interface HydrationSettings {
  daily_target_ml: number;
  glass_ml: number;
  interval_minutes: number;
  reminder_enabled: boolean;
}

interface HourlyPoint {
  hour?: string;
  time?: string;
  amount_ml?: number;
}

interface HydrationToday {
  total_ml: number;
  target_ml: number;
  hourly: HourlyPoint[];
}

const DEFAULT_SETTINGS: HydrationSettings = {
  daily_target_ml: 2000,
  glass_ml: 250,
  interval_minutes: 120,
  reminder_enabled: true,
};
const SIX_HOURS = ["08", "11", "14", "17", "20", "22"];
const LAST_DRINK_KEY = "karsa_water_last_drink";

const liters = (ml: number) => (ml / 1000).toFixed(1);

/**
 * Shared Water data hook (SQLite via /api/v1/hydration/*). All state is server-side, so remounting the widget
 * (resize, dock/undock) never loses anything.
 */
export function useWater() {
  const [settings, setSettings] = useState<HydrationSettings>(DEFAULT_SETTINGS);
  const [today, setToday] = useState<HydrationToday>({ total_ml: 0, target_ml: DEFAULT_SETTINGS.daily_target_ml, hourly: [] });
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/hydration/today");
      if (!res.ok) {
        setOffline(true);
        return;
      }
      setOffline(false);
      {
        const d = await res.json();
        setToday({
          total_ml: typeof d?.total_ml === "number" ? d.total_ml : 0,
          target_ml: typeof d?.target_ml === "number" && d.target_ml > 0 ? d.target_ml : DEFAULT_SETTINGS.daily_target_ml,
          hourly: Array.isArray(d?.hourly_logs) ? d.hourly_logs : [],
        });
      }
    } catch (_) {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/hydration/settings");
        if (res.ok) setSettings({ ...DEFAULT_SETTINGS, ...(await res.json()) });
      } catch (_) {}
      refresh();
    })();
  }, [refresh]);

  const drink = useCallback(async () => {
    try {
      await fetch("/api/v1/hydration/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount_ml: settings.glass_ml }),
      });
      localStorage.setItem(LAST_DRINK_KEY, String(Date.now()));
    } catch (_) {}
    refresh();
  }, [settings.glass_ml, refresh]);

  const save = useCallback(
    async (patch: Partial<HydrationSettings>) => {
      setSettings((s) => ({ ...s, ...patch }));
      try {
        await fetch("/api/v1/hydration/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        if (patch.daily_target_ml !== undefined) refresh();
      } catch (_) {}
    },
    [refresh]
  );

  return { settings, today, drink, save, offline, refresh };
}

/** Always-mounted reminder (lives in the widget layer): notifies every `interval_minutes` since the last drink. */
export function useWaterReminder(paused: boolean) {
  const { settings } = useWater();
  const startedRef = useRef(Date.now());
  useEffect(() => {
    if (paused || !settings.reminder_enabled) return;
    const id = setInterval(() => {
      let last = startedRef.current;
      try {
        last = Math.max(last, Number(localStorage.getItem(LAST_DRINK_KEY)) || 0);
      } catch (_) {}
      if ((Date.now() - last) / 60000 >= settings.interval_minutes) {
        startedRef.current = Date.now();
        try {
          localStorage.setItem(LAST_DRINK_KEY, String(Date.now()));
          if ("Notification" in window && Notification.permission === "granted") {
            new Notification("Waktunya minum air 💧", { body: `Yuk minum segelas (${settings.glass_ml} ml).` });
          }
        } catch (_) {}
      }
    }, 30000);
    return () => clearInterval(id);
  }, [paused, settings.reminder_enabled, settings.interval_minutes, settings.glass_ml]);
}

const chip = (active: boolean) =>
  `px-2 py-0.5 rounded-full text-[10.5px] font-mono font-bold cursor-pointer transition-colors ${
    active ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"
  }`;

export const WaterBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const { settings, today, drink, save, offline, refresh } = useWater();
  const pct = Math.min(100, Math.round((today.total_ml / Math.max(today.target_ml, 1)) * 100));

  const drinkBtn = (cls: string, label?: string) => (
    <button
      type="button"
      onClick={drink}
      className={`rounded-full bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] text-white flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer ${cls}`}
      title={`Minum ${settings.glass_ml} ml`}
      aria-label="Minum"
    >
      <Droplet className="w-3.5 h-3.5 fill-current" />
      {label && <span className="text-[11px] font-semibold">{label}</span>}
    </button>
  );

  if (offline) return <OfflineNotice onRetry={refresh} compact={size === "S"} />;

  if (size === "S") {
    return (
      <div className="w-full flex items-center justify-between gap-2 pr-1">
        <span className="font-mono font-bold text-[14px] text-ink flex items-center gap-1.5 whitespace-nowrap">
          <span aria-hidden="true">💧</span>
          {liters(today.total_ml)}/{liters(today.target_ml)}L
        </span>
        {drinkBtn("w-7 h-7")}
        <PillProgress pct={pct} color="#0ea5e9" />
      </div>
    );
  }

  const progress = (
    <div className="w-full h-1.5 rounded-full bg-pill overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[#0284C7] via-[#0EA5E9] to-[#38BDF8] transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  );

  const head = (
    <div>
      <div className="font-mono font-bold text-[26px] leading-none text-ink">
        {liters(today.total_ml)}
        <span className="text-[13px] font-medium text-ink-2"> / {liters(today.target_ml)} L</span>
      </div>
      <div className="text-[11px] text-ink-2 mt-1 font-medium">
        Hari ini · <span className="text-accent font-bold">{pct}%</span>
        {pct >= 100 ? " · target tercapai" : ""}
      </div>
    </div>
  );

  const actions = (
    <div className="flex items-center gap-2">
      {drinkBtn("h-8 px-3.5 flex-1", `+ Minum (${settings.glass_ml}ml)`)}
      <button
        type="button"
        onClick={() => save({ reminder_enabled: !settings.reminder_enabled })}
        className={`w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition-colors ${
          settings.reminder_enabled ? "bg-accent/20 text-accent" : "bg-pill text-ink-muted"
        }`}
        title={settings.reminder_enabled ? `Pengingat aktif (tiap ${settings.interval_minutes / 60} jam)` : "Pengingat mati"}
        aria-label="Pengingat"
      >
        {settings.reminder_enabled ? <Bell className="w-3.5 h-3.5 fill-current" /> : <BellOff className="w-3.5 h-3.5" />}
      </button>
    </div>
  );

  if (size === "M") {
    return (
      <div className="h-full flex flex-col justify-between gap-2">
        {head}
        {progress}
        {actions}
      </div>
    );
  }

  // L: six-capsule hourly chart + health settings
  const byHour: Record<string, number> = {};
  (today.hourly ?? []).forEach((p) => {
    const h = String(p?.hour ?? p?.time ?? "").slice(0, 2);
    if (h) byHour[h] = (byHour[h] || 0) + (p?.amount_ml || 0);
  });
  return (
    <div className="h-full flex flex-col gap-2.5 overflow-y-auto">
      {head}
      {progress}
      {actions}
      <div className="flex items-end justify-between gap-2 px-1 pt-1">
        {SIX_HOURS.map((hr) => {
          const amt = byHour[hr] || 0;
          const fill = amt > 0 ? Math.min(100, Math.max(16, (amt / 400) * 100)) : 0;
          return (
            <div key={hr} className="flex flex-col items-center gap-1" title={`${hr}:00 — ${amt} ml`}>
              <div className="w-2.5 h-14 rounded-full bg-pill overflow-hidden flex items-end">
                <div className="w-full rounded-full bg-gradient-to-t from-sky-500 to-cyan-300" style={{ height: `${fill}%` }} />
              </div>
              <span className="text-[9.5px] font-mono text-ink-muted">{hr}</span>
            </div>
          );
        })}
      </div>
      <div className="space-y-1.5 border-t border-subtle pt-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="w-12 text-[10.5px] font-medium text-ink-2">Target</span>
          {[1500, 2000, 2500, 3000].map((t) => (
            <button key={t} type="button" onClick={() => save({ daily_target_ml: t })} className={chip(settings.daily_target_ml === t)}>
              {t / 1000}L
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="w-12 text-[10.5px] font-medium text-ink-2">Gelas</span>
          {[150, 250, 350, 500].map((g) => (
            <button key={g} type="button" onClick={() => save({ glass_ml: g })} className={chip(settings.glass_ml === g)}>
              {g}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="w-12 text-[10.5px] font-medium text-ink-2">Ingatkan</span>
          {[
            { l: "1j", m: 60 },
            { l: "1.5j", m: 90 },
            { l: "2j", m: 120 },
            { l: "3j", m: 180 },
          ].map((i) => (
            <button key={i.m} type="button" onClick={() => save({ interval_minutes: i.m })} className={chip(settings.interval_minutes === i.m)}>
              {i.l}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
