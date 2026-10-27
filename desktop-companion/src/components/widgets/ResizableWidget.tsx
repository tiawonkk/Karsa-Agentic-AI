import React, { useCallback, useState } from "react";
import { Maximize2, Minus, X } from "lucide-react";
import {
  MAX_DIMS,
  MIN_DIMS,
  SIZE_DIMS,
  WidgetId,
  WidgetSize,
  sizeFromDims,
  useWidgets,
} from "../../context/WidgetsContext";

interface WidgetContainerProps {
  id: WidgetId;
  title: string;
  icon: React.ReactNode;
  /** The module's accent colour (top accent line and focus cues) */
  accent: string;
  /** Render the body for the layout that fits the current size. */
  children: (size: WidgetSize) => React.ReactNode;
}

type DropZone = null | "left" | "right" | "dock";

const EDGE_PX = 36;
const headerBtn =
  "w-[22px] h-[22px] rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-pill transition-colors cursor-pointer";

const dockRect = (): DOMRect | null => null; // the right side is the Agentic workspace now: widgets no longer dock there

const zoneAt = (cx: number, cy: number): DropZone => {
  const d = dockRect();
  if (d && cx >= d.left && cx <= d.right && cy >= d.top && cy <= d.bottom) return "dock";
  if (cx <= EDGE_PX) return "left";
  if (cx >= window.innerWidth - 12) return "right";
  return null;
};

/**
 * WidgetContainer: the frame every function (Pomodoro, Water, Todo, Finance, Media, Chat) lives in.
 * - Docked: fills the right-side dock. Undocked: a floating card you drag by its header (or by the pill itself in S).
 * - Sizes: S nano pill (150x40), M compact card (250x155), L expanded view (310x280); floating widgets can also be
 *   drag-resized from the bottom-right corner.
 * - Header: [S|M|L] size, [⇄] dock/undock, [—] minimize to the S pill, [×] close.
 * - Gestures (floating): drag onto the dock to dock it, drag against the left screen edge to hide it, or
 *   double-click it to hide it. Hidden widgets come back from the dock launcher (press its icon again to hide).
 */
export const WidgetContainer: React.FC<WidgetContainerProps> = ({ id, title, icon, accent, children }) => {
  const { widgets, setSize, toggleDock, closeWidget, setPos, setCustom } = useWidgets();
  const st = widgets[id];
  const dims = st.custom ?? SIZE_DIMS[st.size];
  const size: WidgetSize = st.custom ? sizeFromDims(dims.w, dims.h) : st.size;
  const [zone, setZone] = useState<DropZone>(null);
  const [dockBox, setDockBox] = useState<DOMRect | null>(null);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (st.docked || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const origin = { x: st.x, y: st.y };
      let last = { x: e.clientX, y: e.clientY };
      setDockBox(dockRect());

      const move = (ev: PointerEvent) => {
        last = { x: ev.clientX, y: ev.clientY };
        // Horizontally the card may slide partly off-screen so it can be pushed against an edge to hide it
        const x = Math.min(Math.max(-dims.w + 40, origin.x + ev.clientX - startX), window.innerWidth - 40);
        const y = Math.min(Math.max(0, origin.y + ev.clientY - startY), window.innerHeight - 40);
        setPos(id, x, y);
        setZone(zoneAt(ev.clientX, ev.clientY));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        const z = zoneAt(last.x, last.y);
        setZone(null);
        setDockBox(null);
        // Always leave a visible, in-bounds position behind (so the widget reappears on screen when reopened)
        const clampX = (x: number) => Math.max(8, Math.min(x, window.innerWidth - dims.w - 8));
        const clampY = (y: number) => Math.max(8, Math.min(y, window.innerHeight - dims.h - 8));
        setPos(id, clampX(origin.x + last.x - startX), clampY(origin.y + last.y - startY));
        if (z === "dock") toggleDock(id);
        else if (z === "left" || z === "right") closeWidget(id);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [closeWidget, dims.h, dims.w, id, setPos, st.docked, st.x, st.y, toggleDock]
  );

  const hideOnDoubleClick = (e: React.MouseEvent) => {
    if (st.docked) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return;
    closeWidget(id);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { ...dims };
    const move = (ev: PointerEvent) => {
      setCustom(id, {
        w: Math.round(Math.min(MAX_DIMS.w, Math.max(MIN_DIMS.w, origin.w + ev.clientX - startX))),
        h: Math.round(Math.min(MAX_DIMS.h, Math.max(MIN_DIMS.h, origin.h + ev.clientY - startY))),
      });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const sizeButtons = (
    <div role="group" aria-label="Ukuran widget" className="flex items-center rounded-full bg-pill p-0.5">
      {(["S", "M", "L"] as WidgetSize[]).map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => setSize(id, s)}
          title={s === "S" ? "Nano pill" : s === "M" ? "Kartu ringkas" : "Tampilan lengkap"}
          aria-pressed={!st.custom && st.size === s}
          className={`w-[18px] h-[18px] rounded-full text-[9.5px] font-mono font-bold cursor-pointer transition-colors ${
            !st.custom && st.size === s ? "text-white" : "text-ink-2 hover:text-ink"
          }`}
          style={!st.custom && st.size === s ? { background: accent } : undefined}
        >
          {s}
        </button>
      ))}
    </div>
  );

  const frame = (
    <div
      onPointerDown={size === "S" ? startDrag : undefined}
      onDoubleClick={size === "S" ? hideOnDoubleClick : undefined}
      data-widget={id}
      className="karsa-surface karsa-widget relative flex flex-col overflow-hidden rounded-[28px] pointer-events-auto font-sans select-none"
      style={{ width: "100%", height: dims.h }}
    >
      {/* module accent line */}
      <div
        aria-hidden="true"
        className="absolute top-0 left-4 right-4 h-[2.5px] rounded-b-full pointer-events-none"
        style={{ background: accent }}
      />

      {size !== "S" && (
        <div
          onPointerDown={startDrag}
          onDoubleClick={hideOnDoubleClick}
          title={st.docked ? undefined : "Geser ke tepi kiri layar, atau klik dua kali, untuk menyembunyikan"}
          className={`flex items-center justify-between gap-1 px-3 h-[34px] flex-shrink-0 border-b border-subtle ${
            st.docked ? "" : "cursor-grab active:cursor-grabbing"
          }`}
        >
          <div className="flex items-center gap-1.5 min-w-0 text-ink">
            <span className="flex-shrink-0">{icon}</span>
            <span className="text-[12px] font-semibold tracking-tight truncate">{title}</span>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {sizeButtons}
            <button
              type="button"
              onClick={() => setSize(id, "S")}
              className={headerBtn}
              title="Minimize ke Nano Pill"
              aria-label="Minimize"
            >
              <Minus className="w-3 h-3" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={() => closeWidget(id)}
              className={`${headerBtn} hover:!bg-rose-500 hover:!text-white`}
              title="Tutup widget"
              aria-label="Tutup"
            >
              <X className="w-3 h-3" strokeWidth={2.25} />
            </button>
          </div>
        </div>
      )}

      <div className={`flex-1 min-h-0 min-w-0 ${size === "S" ? "px-3 flex items-center" : "p-3.5"}`}>
        {children(size)}
      </div>

      {/* Drag-to-resize corner (floating widgets only) */}
      {!st.docked && (
        <div
          onPointerDown={startResize}
          className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-[3px]"
          title="Tarik untuk mengubah ukuran"
          aria-label="Ubah ukuran"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-ink-muted" aria-hidden="true">
            <path d="M7 1 L1 7 M7 4 L4 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );

  // The S-pill controls live OUTSIDE the clipped frame, on its top edge, so they never cover the pill's own button.
  const pillControls =
    size === "S" ? (
      <div className="absolute -top-2.5 right-3 z-10 hidden group-hover:flex items-center gap-0.5 rounded-full karsa-surface p-0.5 pointer-events-auto">
        <button type="button" onClick={() => setSize(id, "M")} className="w-5 h-5 rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-pill cursor-pointer" title="Perbesar (M)" aria-label="Perbesar">
          <Maximize2 className="w-2.5 h-2.5" strokeWidth={2.5} />
        </button>
        <button type="button" onClick={() => closeWidget(id)} className="w-5 h-5 rounded-full flex items-center justify-center text-ink-2 hover:!bg-rose-500 hover:!text-white cursor-pointer" title="Tutup widget" aria-label="Tutup">
          <X className="w-2.5 h-2.5" strokeWidth={2.5} />
        </button>
      </div>
    ) : null;

  const wrapped = (
    <div className="group relative" style={{ width: st.docked ? "100%" : dims.w }}>
      {frame}
      {pillControls}
    </div>
  );

  if (st.docked) return wrapped;

  return (
    <div className="fixed z-[45] pointer-events-none" style={{ left: st.x, top: st.y }}>
      {wrapped}

      {/* Drop-zone hints while dragging */}
      {zone === "dock" && dockBox && (
        <div
          className="fixed rounded-2xl ring-2 pointer-events-none flex items-end justify-center pb-3"
          style={{ left: dockBox.left, top: dockBox.top, width: dockBox.width, height: dockBox.height, background: `${accent}22`, boxShadow: `0 0 0 2px ${accent}` }}
        >
          <span className="px-3 py-1 rounded-full text-[11px] font-semibold text-white" style={{ background: accent }}>
            Lepas untuk memasukkan ke Dock
          </span>
        </div>
      )}
      {(zone === "left" || zone === "right") && (
        <>
          <div
            className="fixed top-0 bottom-0 w-2 pointer-events-none"
            style={{ [zone]: 0, background: accent, boxShadow: `0 0 18px 4px ${accent}` } as React.CSSProperties}
          />
          <span
            className="fixed top-1/2 -translate-y-1/2 px-3 py-1 rounded-full text-[11px] font-semibold text-white pointer-events-none"
            style={{ [zone]: 14, background: accent } as React.CSSProperties}
          >
            Lepas untuk menyembunyikan
          </span>
        </>
      )}
    </div>
  );
};

export default WidgetContainer;
