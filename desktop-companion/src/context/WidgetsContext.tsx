import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type WidgetId = "pomodoro" | "water" | "todo" | "finance" | "media" | "chat" | "notebook" | "approvals";
export type WidgetSize = "S" | "M" | "L";

export const WIDGET_IDS: WidgetId[] = ["pomodoro", "water", "todo", "finance", "media", "chat", "notebook", "approvals"];

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

const STORAGE_KEY = "karsa_widgets_v1";

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
    // The notebook needs room (tables, drafts): it starts as a floating 400x500 window
    notebook: { open: false, docked: false, size: "L", custom: { w: 400, h: 500 }, x: 140, y: 90 },
    // Approval cards need room for evidence + JSON edit: floating 360x480 by default
    approvals: { open: false, docked: false, size: "L", custom: { w: 360, h: 480 }, x: 170, y: 100 },
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

/** Live drop-zone hint while a widget is being dragged (rendered once by <DropHints/>) */
export interface DragHint {
  zone: "left" | "right" | "dock";
  accent: string;
  dockBox: { left: number; top: number; width: number; height: number } | null;
}

interface WidgetsContextType {
  widgets: WidgetMap;
  dragHint: DragHint | null;
  setDragHint: (hint: DragHint | null) => void;
  /** Detach a docked widget so it floats at the given position (used when it is dragged out of the dock). */
  undockAt: (id: WidgetId, x: number, y: number) => void;
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
  const [dragHint, setDragHint] = useState<DragHint | null>(null);

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
      dragHint,
      setDragHint,
      undockAt: (id, x, y) => patch(id, { docked: false, x, y }),
      toggleOpen: (id) => patch(id, (s) => ({ open: !s.open })),
      openWidget: (id) => patch(id, { open: true }),
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
    [widgets, dragHint, patch]
  );

  return <WidgetsContext.Provider value={value}>{children}</WidgetsContext.Provider>;
};

export const useWidgets = (): WidgetsContextType => {
  const ctx = useContext(WidgetsContext);
  if (!ctx) throw new Error("useWidgets must be used inside <WidgetsProvider>");
  return ctx;
};
