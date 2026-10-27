import React, { useEffect, useState } from "react";
import { ChevronRight, Palette, Settings } from "lucide-react";
import { WIDGET_IDS, WidgetId, useWidgets } from "../context/WidgetsContext";
import { ThemeToggle } from "../context/ThemeContext";
import { useSystemStatus } from "../context/SystemStatusContext";
import { WIDGET_DEFS, WidgetView } from "./widgets/WidgetLayer";
import { usePomodoro } from "../stores/pomodoroStore";
import { priorityOf, useTasks } from "./widgets/TodoWidget";
import { ChatBridge } from "./widgets/ChatWidget";
import { useApprovals } from "./widgets/ApprovalsWidget";
import { bindingOf, prettyCombo, actionFor, widgetForEvent } from "../stores/shortcuts";

interface RightSideDockProps {
  chat: ChatBridge;
  onOpenSettings: () => void;
  onOpenWardrobe: () => void;
}

const COLLAPSED_KEY = "karsa_dock_collapsed";

/**
 * RightSideDock: the small screen on the right edge (275px). Holds the docked widgets, a header with the theme toggle,
 * AI status, Settings and Wardrobe, and a launcher row. It collapses into an 8x64 tab so it never gets in the way.
 * The wrapper is click-through; only the panel and the handle capture pointer events.
 */
export const RightSideDock: React.FC<RightSideDockProps> = ({ chat, onOpenSettings, onOpenWardrobe }) => {
  const { widgets, toggleOpen } = useWidgets();
  const { isApiConnected, activeBadge } = useSystemStatus();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch (_) {
      return false;
    }
  });

  const setCollapsedPersist = (v: boolean) => {
    setCollapsed(v);
    try {
      localStorage.setItem(COLLAPSED_KEY, v ? "1" : "0");
    } catch (_) {}
  };

  const docked = WIDGET_IDS.filter((id) => widgets[id].open && widgets[id].docked);

  // Live status for the launcher: a running Pomodoro (minutes left) and open P1 tasks, even when those widgets are hidden
  const pomo = usePomodoro();
  const { tasks } = useTasks();
  const p1Open = tasks.filter((t) => t.status !== "done" && priorityOf(t) === 1).length;
  const { pending: pendingApprovals } = useApprovals();
  const badgeFor = (id: WidgetId): { text: string; pulse: boolean } | null => {
    if (id === "pomodoro" && pomo.running) return { text: String(Math.max(1, Math.ceil(pomo.remainingSec / 60))), pulse: true };
    if (id === "todo" && p1Open > 0) return { text: String(p1Open), pulse: false };
    if (id === "approvals" && pendingApprovals.length > 0) return { text: String(pendingApprovals.length), pulse: true };
    return null;
  };

  // Widget shortcuts (default Alt+1 Pomodoro ... Alt+9 Hari Ini), rebindable from the "?" sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = widgetForEvent(e);
      if (id) {
        e.preventDefault();
        toggleOpen(id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleOpen]);

  if (collapsed) {
    return (
      <div className="fixed right-0 top-1/2 -translate-y-1/2 z-40 pointer-events-none">
        <button
          type="button"
          onClick={() => setCollapsedPersist(false)}
          className="pointer-events-auto block p-0 rounded-l-full bg-glass border border-r-0 border-subtle opacity-80 hover:opacity-100 transition-opacity cursor-pointer"
          style={{ width: 8, height: 64, minWidth: 0, boxShadow: "var(--shadow-soft)" }}
          title="Buka Layar Kanan"
          aria-label="Buka Layar Kanan"
        />
      </div>
    );
  }

  return (
    <div className="fixed right-3 top-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center gap-1 font-sans">
      <button
        type="button"
        onClick={() => setCollapsedPersist(true)}
        className="pointer-events-auto w-4 h-12 rounded-full bg-glass border border-subtle text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer"
        title="Sembunyikan Layar Kanan"
        aria-label="Sembunyikan Layar Kanan"
      >
        <ChevronRight className="w-3 h-3" strokeWidth={2.5} />
      </button>

      <aside
        className="karsa-surface pointer-events-auto w-[275px] min-h-[260px] max-h-[78vh] rounded-2xl flex flex-col overflow-hidden"
        aria-label="Layar Kanan"
      >
        {/* Mini header */}
        <div className="flex items-center justify-between gap-1.5 px-3 py-2 border-b border-subtle flex-shrink-0">
          <ThemeToggle />
          <button
            type="button"
            onClick={onOpenSettings}
            className={`min-w-0 truncate text-[10px] font-mono font-semibold px-2 h-6 rounded-full border cursor-pointer ${
              isApiConnected
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : "bg-rose-500/10 text-rose-500 border-rose-500/30"
            }`}
            title={isApiConnected ? "AI terhubung" : "Klik untuk memasang API key"}
          >
            {activeBadge}
          </button>
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              type="button"
              onClick={onOpenSettings}
              className="w-6 h-6 rounded-full bg-pill text-ink hover:brightness-110 flex items-center justify-center cursor-pointer"
              title="Settings"
              aria-label="Settings"
            >
              <Settings className="w-3.5 h-3.5" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={onOpenWardrobe}
              className="w-6 h-6 rounded-full bg-pill text-ink hover:brightness-110 flex items-center justify-center cursor-pointer"
              title="Wardrobe"
              aria-label="Wardrobe"
            >
              <Palette className="w-3.5 h-3.5" strokeWidth={2.25} />
            </button>
          </div>
        </div>

        {/* Docked widgets */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">
          {docked.length === 0 ? (
            <div className="h-full min-h-[120px] flex flex-col items-center justify-center text-center gap-1 text-ink-muted">
              <span className="text-[12px] font-medium text-ink-2">Belum ada widget</span>
              <span className="text-[10.5px]">Pilih dari ikon di bawah untuk menampilkannya di sini.</span>
            </div>
          ) : (
            docked.map((id) => <WidgetView key={id} id={id} chat={chat} onOpenSettings={onOpenSettings} />)
          )}
        </div>

        {/* Quick widget launcher */}
        <div className="flex items-center justify-between px-3 py-2 border-t border-subtle flex-shrink-0">
          {WIDGET_IDS.map((id: WidgetId) => {
            const def = WIDGET_DEFS[id];
            const open = widgets[id].open;
            const badge = badgeFor(id);
            return (
              <button
                key={id}
                type="button"
                onClick={() => toggleOpen(id)}
                title={`${open ? "Sembunyikan" : "Tampilkan"} ${def.title}${bindingOf(actionFor(id)) ? ` (${prettyCombo(bindingOf(actionFor(id)))})` : ""}`}
                aria-label={`${open ? "Sembunyikan" : "Tampilkan"} ${def.title}`}
                aria-pressed={open}
                className={`relative w-[26px] h-[26px] rounded-xl flex items-center justify-center transition-all cursor-pointer active:scale-95 ${
                  open ? "text-white" : "bg-pill text-ink-2 hover:text-ink"
                }`}
                style={open ? { background: def.accent } : undefined}
              >
                {def.launcherIcon}
                {badge && (
                  <span
                    className={`absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-mono font-bold flex items-center justify-center ring-2 ring-[var(--bg-widget)] ${
                      badge.pulse ? "animate-pulse" : ""
                    }`}
                    aria-hidden="true"
                  >
                    {badge.text}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </aside>
    </div>
  );
};

export default RightSideDock;
