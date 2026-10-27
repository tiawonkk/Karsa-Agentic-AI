import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type WidgetId = "pomodoro" | "water" | "todo" | "finance" | "media" | "chat" | "shelf" | "notebook" | "approvals" | "today" | "studio";
export type WidgetSize = "S" | "M" | "L";

export const WIDGET_IDS: WidgetId[] = ["pomodoro", "water", "todo", "finance", "media", "chat", "notebook", "approvals", "today", "shelf", "studio"];

/** Preset sizes: S = nano pill, M = compact card, L = expanded view. */
export const SIZE_DIMS: Record<WidgetSize, { w: number; h: number }> = {
  S: { w: 150, h: 40 },
  M: { w: 250, h: 155 },
  L: { w: 310, h: 280 },
};

export const MIN_DIMS = { w: 150, h: 40 };
export const MAX_DIMS = { w: 520, h: 560 };

/** Which layout a free-form (drag-resized) widget should render. */
export const sizeFromDims = (w: number, h: number): WidgetSize => {
  if (h < 90 || w < 200) return "S";
  if (h >= 230 || w >= 300) return "L";
  return "M";
};

export interface WidgetState {
  open: boolean;
  docked: boolean;
  size: WidgetSize;
  /** Set once the user drag-resizes a floating widget; cleared again by picking S/M/L. */
  custom: { w: number; h: number } | null;
  x: number;
  y: number;
}

type WidgetMap = Record<WidgetId, WidgetState>;

const STORAGE_KEY = "karsa_widgets_v3";

const defaults = (): WidgetMap => {
  const base = (size: WidgetSize, i: number): WidgetState => ({
    open: false,
    docked: true,
    size,
    custom: null,
    x: 120 + i * 28,
    y: 110 + i * 28,
  });
  return {
    pomodoro: base("M", 0),
    water: base("M", 1),
    todo: base("M", 2),
    finance: base("M", 3),
    media: base("M", 4),
    chat: base("L", 5),
    shelf: base("M", 9),
    studio: { ...base("L", 10), docked: false, custom: { w: 460, h: 560 } },
    // heavy modules start as floating windows (too wide for the 275px dock); Hari Ini opens in the dock
    notebook: { ...base("L", 6), docked: false, custom: { w: 420, h: 480 } },
    approvals: { ...base("L", 7), docked: false, custom: { w: 360, h: 480 } },
    today: { ...base("L", 8), open: true },
  };
};

const load = (): WidgetMap => {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (raw && typeof raw === "object") {
      for (const id of WIDGET_IDS) {
        const r = raw[id];
        if (!r || typeof r !== "object") continue;
        d[id] = {
          open: !!r.open,
          docked: r.docked !== false,
          size: r.size === "S" || r.size === "L" ? r.size : "M",
          custom:
            r.custom && typeof r.custom.w === "number" && typeof r.custom.h === "number"
              ? { w: r.custom.w, h: r.custom.h }
              : null,
          x: typeof r.x === "number" ? r.x : d[id].x,
          y: typeof r.y === "number" ? r.y : d[id].y,
        };
      }
    }
  } catch (_) {}
  return d;
};

/** A floating widget that is opened must be fully reachable: pull it back inside the window if it would hang off an edge. */
const onScreen = (s: WidgetState): Partial<WidgetState> => {
  if (s.docked) return {};
  const d = s.custom ?? SIZE_DIMS[s.size];
  return {
    x: Math.max(12, Math.min(s.x, window.innerWidth - d.w - 12)),
    y: Math.max(56, Math.min(s.y, window.innerHeight - d.h - 12)),
  };
};

interface WidgetsContextType {
  widgets: WidgetMap;
  toggleOpen: (id: WidgetId) => void;
  openWidget: (id: WidgetId) => void;
  closeWidget: (id: WidgetId) => void;
  setSize: (id: WidgetId, size: WidgetSize) => void;
  toggleDock: (id: WidgetId) => void;
  setPos: (id: WidgetId, x: number, y: number) => void;
  setCustom: (id: WidgetId, dims: { w: number; h: number }) => void;
}

const WidgetsContext = createContext<WidgetsContextType | null>(null);

export const WidgetsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [widgets, setWidgets] = useState<WidgetMap>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
    } catch (_) {}
  }, [widgets]);

  const patch = useCallback((id: WidgetId, p: Partial<WidgetState> | ((s: WidgetState) => Partial<WidgetState>)) => {
    setWidgets((prev) => ({ ...prev, [id]: { ...prev[id], ...(typeof p === "function" ? p(prev[id]) : p) } }));
  }, []);

  const value = useMemo<WidgetsContextType>(
    () => ({
      widgets,
      toggleOpen: (id) => patch(id, (s) => (s.open ? { open: false } : { open: true, ...onScreen(s) })),
      openWidget: (id) => patch(id, (s) => ({ open: true, ...onScreen(s) })),
      closeWidget: (id) => patch(id, { open: false }),
      setSize: (id, size) => patch(id, { size, custom: null }),
      toggleDock: (id) =>
        patch(id, (s) => {
          if (s.docked) {
            // Undock next to the dock (right side) so the widget does not jump across the screen
            const dims = s.custom ?? SIZE_DIMS[s.size];
            return {
              docked: false,
              x: Math.max(12, window.innerWidth - 275 - 24 - dims.w),
              y: Math.max(60, Math.min(s.y, window.innerHeight - dims.h - 12)),
            };
          }
          return { docked: true, custom: null };
        }),
      setPos: (id, x, y) => patch(id, { x, y }),
      setCustom: (id, dims) => patch(id, { custom: dims }),
    }),
    [widgets, patch]
  );

  return <WidgetsContext.Provider value={value}>{children}</WidgetsContext.Provider>;
};

export const useWidgets = (): WidgetsContextType => {
  const ctx = useContext(WidgetsContext);
  if (!ctx) throw new Error("useWidgets must be used inside <WidgetsProvider>");
  return ctx;
};
