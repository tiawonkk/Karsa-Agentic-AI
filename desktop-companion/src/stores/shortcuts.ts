import { useSyncExternalStore } from "react";
import { WIDGET_IDS, WidgetId } from "../context/WidgetsContext";

/**
 * In-app keyboard shortcuts: one action per widget ("toggle_<widget>"), user-rebindable and switchable off.
 * A combo always needs a modifier (Alt/Ctrl/Meta) so typing in a text field can never trigger anything.
 * Persisted in localStorage; global (outside-the-app) hotkeys need the Tauri shell and are not handled here.
 */
const KEY = "karsa_shortcuts_v1";

interface State {
  enabled: boolean;
  custom: Record<string, string>;
}

const read = (): State => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && typeof raw === "object") {
      const custom: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw.custom ?? {})) if (typeof v === "string") custom[k] = v;
      return { enabled: raw.enabled !== false, custom };
    }
  } catch (_) {}
  return { enabled: true, custom: {} };
};

let state: State = read();
const listeners = new Set<() => void>();
const commit = (next: State) => {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (_) {}
  listeners.forEach((l) => l());
};

export const actionFor = (id: WidgetId) => `toggle_${id}`;
export const widgetOf = (action: string): WidgetId | null =>
  action.startsWith("toggle_") && (WIDGET_IDS as string[]).includes(action.slice(7)) ? (action.slice(7) as WidgetId) : null;

/** Alt+1.. in widget order (unchanged from before: Alt+1 Pomodoro ... Alt+8 Approvals, Alt+9 Hari Ini). */
export const defaultCombo = (action: string): string => {
  const w = widgetOf(action);
  return w ? `alt+${WIDGET_IDS.indexOf(w) + 1}` : "";
};

/** "" = unbound (the user cleared it). */
export const bindingOf = (action: string, s: State = state): string => (action in s.custom ? s.custom[action] : defaultCombo(action));

const MODS = new Set(["control", "alt", "shift", "meta"]);
export const comboFromEvent = (e: KeyboardEvent): string | null => {
  if (MODS.has(e.key.toLowerCase())) return null;
  if (!e.altKey && !e.ctrlKey && !e.metaKey) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.metaKey) parts.push("meta");
  parts.push(e.key === " " ? "space" : e.key.toLowerCase());
  return parts.join("+");
};

export const prettyCombo = (combo: string): string =>
  combo
    ? combo
        .split("+")
        .map((p) => (p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)))
        .join(" + ")
    : "Tidak ada";

/** Combos the app or the OS already uses: refused so a rebind cannot break something else. */
const RESERVED = new Set(["alt+space", "alt+f4", "alt+tab", "ctrl+w", "ctrl+r", "ctrl+q", "ctrl+c", "ctrl+v", "ctrl+x", "ctrl+a", "ctrl+z"]);

export const setBinding = (action: string, combo: string | null): { ok: boolean; reason?: string } => {
  if (combo) {
    if (RESERVED.has(combo)) return { ok: false, reason: `${prettyCombo(combo)} sudah dipakai sistem atau Karsa.` };
    const clash = WIDGET_IDS.map(actionFor).find((a) => a !== action && bindingOf(a) === combo);
    if (clash) return { ok: false, reason: `${prettyCombo(combo)} sudah dipakai fungsi lain.` };
  }
  commit({ ...state, custom: { ...state.custom, [action]: combo ?? "" } });
  return { ok: true };
};

export const resetBindings = () => commit({ ...state, custom: {} });
export const setShortcutsEnabled = (enabled: boolean) => commit({ ...state, enabled });

/** Which widget does this key press toggle (null when shortcuts are off or nothing matches). */
export const widgetForEvent = (e: KeyboardEvent): WidgetId | null => {
  if (!state.enabled) return null;
  const combo = comboFromEvent(e);
  if (!combo) return null;
  for (const id of WIDGET_IDS) if (bindingOf(actionFor(id)) === combo) return id;
  return null;
};

export function useShortcuts(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
}

export const OPEN_SHEET_EVENT = "karsa:shortcuts";
export const openShortcutsSheet = () => window.dispatchEvent(new Event(OPEN_SHEET_EVENT));
