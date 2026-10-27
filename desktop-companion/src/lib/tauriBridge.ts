import { useEffect } from "react";

/**
 * Bridge to the Tauri shell (src-tauri). It does nothing in a normal browser, so the same UI keeps working in Chrome
 * and on the phone. In the desktop app it (1) tells the shell which rectangles are clickable so everything else is
 * click-through, (2) turns global hotkeys and tray menu items into the same events the keyboard handlers already use.
 */
interface TauriGlobal {
  core?: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
  event?: { listen: (name: string, cb: (e: { payload: unknown }) => void) => Promise<() => void> };
}

const tauri = (): TauriGlobal | null => ((window as unknown as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null);

export const inDesktopShell = (): boolean => !!tauri()?.core;

const invoke = (cmd: string, args?: Record<string, unknown>) => tauri()?.core?.invoke(cmd, args).catch(() => undefined);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Everything the user can click: elements that opt in to the mouse (`pointer-events-auto`) or are marked `data-hit`. */
export function collectInteractiveRects(root: ParentNode = document): Rect[] {
  const out: Rect[] = [];
  root.querySelectorAll<HTMLElement>(".pointer-events-auto, [data-hit]").forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.pointerEvents === "none") return;
    out.push({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  });
  return out;
}

const sameRects = (a: Rect[], b: Rect[]) => a.length === b.length && a.every((r, i) => r.x === b[i].x && r.y === b[i].y && r.w === b[i].w && r.h === b[i].h);

export function useTauriBridge(): void {
  useEffect(() => {
    if (!inDesktopShell()) return;
    let last: Rect[] = [];
    let queued = false;

    const push = () => {
      queued = false;
      const next = collectInteractiveRects();
      if (!sameRects(next, last)) {
        last = next;
        invoke("set_interactive_regions", { regions: next });
      }
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(push);
    };

    const mo = new MutationObserver(schedule);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    window.addEventListener("resize", schedule);
    const tick = setInterval(schedule, 250); // animations move boxes without touching the DOM tree
    schedule();

    // a widget being dragged must keep the mouse even when the pointer outruns the reported rectangles
    const down = () => invoke("set_drag_lock", { lock: true });
    const up = () => invoke("set_drag_lock", { lock: false });
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    window.addEventListener("blur", up);

    // hotkeys and tray items arrive as events; reuse the keyboard handlers that already exist
    const unlisten: Array<() => void> = [];
    const ev = tauri()?.event;
    const key = (init: KeyboardEventInit) => window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    ev?.listen("karsa://hotkey", (e) => {
      if (e.payload === "omni") key({ key: " ", code: "Space", altKey: true });
      else if (e.payload === "karsa") key({ key: "k", code: "KeyK", altKey: true });
    }).then((u) => unlisten.push(u));
    ev?.listen("karsa://toggle-sleep", () => window.dispatchEvent(new CustomEvent("karsa:toggle-sleep"))).then((u) => unlisten.push(u));
    ev?.listen("karsa://backend-offline", (e) => window.dispatchEvent(new CustomEvent("karsa:backend-offline", { detail: e.payload }))).then((u) => unlisten.push(u));

    return () => {
      mo.disconnect();
      clearInterval(tick);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
      window.removeEventListener("blur", up);
      unlisten.forEach((u) => u());
    };
  }, []);
}
