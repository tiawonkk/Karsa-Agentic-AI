import React, { useCallback } from "react";
import { ArrowLeftRight, Maximize2, Minus, X } from "lucide-react";
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
const DETACH_MARGIN = 8;

const EDGE_PX = 36;
const headerBtn =
  "w-[22px] h-[22px] rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-pill transition-colors cursor-pointer";

const dockRect = (): DOMRect | null =>
  document.querySelector('aside[aria-label="Layar Kanan"]')?.getBoundingClientRect() ?? null;

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
  const { widgets, setSize, toggleDock, closeWidget, setPos, setCustom, setDragHint, undockAt } = useWidgets();
  const st = widgets[id];
  const dims = st.custom ?? SIZE_DIMS[st.size];
  const size: WidgetSize = st.custom ? sizeFromDims(dims.w, dims.h) : st.size;

  /**
   * One drag path for both states. A floating widget follows the pointer immediately. A docked widget stays put until
   * the pointer leaves the dock panel, then detaches (undocks) and keeps following the same drag, so you can pull a
   * widget straight out of the Dock. Drop zones: onto the dock = dock, against the left screen edge = hide.
   */
  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button, input, textarea, select, a")) return;
      const frameEl = (e.currentTarget as HTMLElement).closest("[data-widget]") as HTMLElement | null;
      const rect = frameEl?.getBoundingClientRect();
      // where inside the widget the pointer grabbed it (kept so the card does not jump under the cursor)
      const grab = st.docked
        ? { x: Math.min(e.clientX - (rect?.left ?? e.clientX), dims.w - 40), y: e.clientY - (rect?.top ?? e.clientY) }
        : { x: e.clientX - st.x, y: e.clientY - st.y };
      let detached = !st.docked;
      let last = { x: e.clientX, y: e.clientY };

      const place = (cx: number, cy: number) => ({
        // horizontally the card may slide partly off-screen so it can be pushed against an edge to hide it
        x: Math.min(Math.max(-dims.w + 40, cx - grab.x), window.innerWidth - 40),
        y: Math.min(Math.max(0, cy - grab.y), window.innerHeight - 40),
      });

      const move = (ev: PointerEvent) => {
        last = { x: ev.clientX, y: ev.clientY };
        if (!detached) {
          const d = dockRect();
          const outside =
            !d ||
            ev.clientX < d.left - DETACH_MARGIN ||
            ev.clientX > d.right + DETACH_MARGIN ||
            ev.clientY < d.top - DETACH_MARGIN ||
            ev.clientY > d.bottom + DETACH_MARGIN;
          if (!outside) return;
          detached = true;
          const p = place(ev.clientX, ev.clientY);
          undockAt(id, p.x, p.y);
        }
        const p = place(ev.clientX, ev.clientY);
        setPos(id, p.x, p.y);
        const z = zoneAt(ev.clientX, ev.clientY);
        const d = dockRect();
        setDragHint(
          z
            ? { zone: z, accent, dockBox: d ? { left: d.left, top: d.top, width: d.width, height: d.height } : null }
            : null
        );
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        setDragHint(null);
        if (!detached) return; // a plain click on a docked header: nothing to do
        const z = zoneAt(last.x, last.y);
        // Always leave a visible, in-bounds position behind (so the widget reappears on screen when reopened)
        const p = place(last.x, last.y);
        setPos(
          id,
          Math.max(8, Math.min(p.x, window.innerWidth - dims.w - 8)),
          Math.max(8, Math.min(p.y, window.innerHeight - dims.h - 8))
        );
        if (z === "dock") toggleDock(id);
        else if (z === "left" || z === "right") closeWidget(id);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [accent, closeWidget, dims.h, dims.w, id, setDragHint, setPos, st.docked, st.x, st.y, toggleDock, undockAt]
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
      className="karsa-surface karsa-widget relative flex flex-col overflow-hidden rounded-2xl pointer-events-auto font-sans select-none"
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
          title={
            st.docked
              ? "Tarik keluar dari Dock untuk melepasnya"
              : "Geser ke tepi kiri layar, atau klik dua kali, untuk menyembunyikan"
          }
          className="flex items-center justify-between gap-1 px-3 h-[34px] flex-shrink-0 border-b border-subtle cursor-grab active:cursor-grabbing"
        >
          <div className="flex items-center gap-1.5 min-w-0 text-ink">
            <span className="flex-shrink-0">{icon}</span>
            <span className="text-[12px] font-semibold tracking-tight truncate">{title}</span>
          </div>
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {sizeButtons}
            <button
              type="button"
              onClick={() => toggleDock(id)}
              className={headerBtn}
              title={st.docked ? "Lepas ke layar (floating)" : "Masukkan ke Layar Kanan"}
              aria-label={st.docked ? "Lepas ke layar" : "Masukkan ke Layar Kanan"}
            >
              <ArrowLeftRight className="w-3 h-3" strokeWidth={2.25} />
            </button>
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

  // The S-pill controls sit on the pill's top-LEFT edge, above its text and clear of its action button on the
  // right (play / drink / send), so nothing is ever covered.
  const pillBtn =
    "w-4 h-4 rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-pill cursor-pointer";
  const pillControls =
    size === "S" ? (
      <div className="absolute -top-2.5 left-3 z-10 hidden group-hover:flex items-center gap-px rounded-full karsa-surface p-px pointer-events-auto">
        <button type="button" onClick={() => toggleDock(id)} className={pillBtn} title={st.docked ? "Lepas ke layar (floating)" : "Masukkan ke Layar Kanan"} aria-label={st.docked ? "Lepas ke layar" : "Masukkan ke Layar Kanan"}>
          <ArrowLeftRight className="w-2.5 h-2.5" strokeWidth={2.5} />
        </button>
        <button type="button" onClick={() => setSize(id, "M")} className={pillBtn} title="Perbesar (M)" aria-label="Perbesar">
          <Maximize2 className="w-2.5 h-2.5" strokeWidth={2.5} />
        </button>
        <button type="button" onClick={() => closeWidget(id)} className={`${pillBtn} hover:!bg-rose-500 hover:!text-white`} title="Tutup widget" aria-label="Tutup">
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
    </div>
  );
};

export default WidgetContainer;
