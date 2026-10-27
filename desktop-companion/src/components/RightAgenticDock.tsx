import React, { useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Maximize2, MessageCircle, Palette, Settings, ShieldCheck, Sparkles } from "lucide-react";
import { WIDGET_IDS, useWidgets } from "../context/WidgetsContext";
import { ThemeToggle } from "../context/ThemeContext";
import { useSystemStatus } from "../context/SystemStatusContext";
import { ChatBody, ChatBridge } from "./widgets/ChatWidget";
import { useApprovals } from "./widgets/ApprovalsWidget";
import { MascotCanvas } from "./MascotCanvas";
import { AUTOMATIONS, AutomationPanel } from "./studio/AutomationPanel";
import { OutfitItem } from "../lib/jelly";
import { AutomationId, openStudio } from "../stores/studioMode";
import { widgetForEvent } from "../stores/shortcuts";

interface RightAgenticDockProps {
  chat: ChatBridge;
  onOpenSettings: () => void;
  onOpenWardrobe: () => void;
  isDark: boolean;
  mascotColor: string;
  eyeColor: string;
  outfit: OutfitItem[];
  isSleeping: boolean;
}

const COLLAPSED_KEY = "karsa_dock_collapsed";
type Tab = "chat" | "auto";

/**
 * RightAgenticDock: the command centre for Karsa's AI work. Header (mascot, active model, theme, Settings, Wardrobe,
 * Full App Mode), a chat with the approval banner, and the 8 automation workspaces (finance+report, PRD-to-App,
 * data, research, article, brain, project hub, business). Daily micro-utilities are NOT here: they live in the Island.
 * The wrapper is click-through; only the panel and the handle capture the mouse.
 */
export const RightAgenticDock: React.FC<RightAgenticDockProps> = ({ chat, onOpenSettings, onOpenWardrobe, isDark, mascotColor, eyeColor, outfit, isSleeping }) => {
  const { openWidget, toggleOpen } = useWidgets();
  const { isApiConnected, activeBadge } = useSystemStatus();
  const { pending } = useApprovals();
  const [tab, setTab] = useState<Tab>("chat");
  const [active, setActive] = useState<AutomationId | null>(null);
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

  // Widget shortcuts (Alt+1 ...) still open the floating widgets; rebindable from the "?" sheet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const id = widgetForEvent(e);
      if (id && WIDGET_IDS.includes(id)) {
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
          className="pointer-events-auto flex items-center justify-center rounded-l-full bg-glass border border-r-0 border-subtle opacity-90 hover:opacity-100 transition-opacity cursor-pointer text-ink-2"
          style={{ width: 22, height: 72, boxShadow: "var(--shadow-soft)" }}
          title="Buka Panel Agentic Karsa"
          aria-label="Buka Panel Agentic Karsa"
        >
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  const current = AUTOMATIONS.find((a) => a.id === active) ?? null;

  return (
    <div className="fixed right-3 top-16 bottom-4 z-40 pointer-events-none flex items-start gap-1 font-sans">
      <button
        type="button"
        onClick={() => setCollapsedPersist(true)}
        className="pointer-events-auto mt-24 w-4 h-12 rounded-full bg-glass border border-subtle text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer"
        title="Sembunyikan Panel Agentic"
        aria-label="Sembunyikan Panel Agentic"
      >
        <ChevronRight className="w-3 h-3" strokeWidth={2.5} />
      </button>

      <aside
        className="karsa-surface karsa-panel pointer-events-auto w-[360px] max-h-full h-[640px] flex flex-col overflow-hidden"
        aria-label="Panel Agentic"
      >
        {/* Agentic header */}
        <div className="flex items-center gap-2 px-3.5 pt-3 pb-2 flex-shrink-0">
          <button
            type="button"
            onClick={onOpenWardrobe}
            className="w-11 h-11 rounded-[16px] karsa-nested flex items-center justify-center cursor-pointer flex-shrink-0 overflow-hidden"
            title="Karsa — buka Wardrobe"
          >
            <MascotCanvas size={40} bodyColor={mascotColor} eyeColor={eyeColor} outfit={outfit} isSleeping={isSleeping} isDark={isDark} showStarOrbit={false} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-ink leading-tight">Karsa Agentic</div>
            <button
              type="button"
              onClick={onOpenSettings}
              title={isApiConnected ? "Model aktif" : "Klik untuk memasang API key"}
              className={`mt-0.5 max-w-full truncate text-[10px] font-mono font-semibold px-2 h-5 rounded-full border cursor-pointer inline-flex items-center gap-1 ${
                isApiConnected ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-rose-500/10 text-rose-500 border-rose-500/30"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isApiConnected ? "bg-emerald-500" : "bg-rose-500"}`} />
              <span className="truncate">{activeBadge}</span>
            </button>
          </div>
          <ThemeToggle />
          <button type="button" onClick={onOpenSettings} className="w-7 h-7 rounded-full bg-pill text-ink hover:brightness-110 flex items-center justify-center cursor-pointer" title="Settings" aria-label="Settings">
            <Settings className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
          <button type="button" onClick={onOpenWardrobe} className="w-7 h-7 rounded-full bg-pill text-ink hover:brightness-110 flex items-center justify-center cursor-pointer" title="Wardrobe" aria-label="Wardrobe">
            <Palette className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
          <button
            type="button"
            onClick={() => openStudio(active ?? "chat")}
            className="w-7 h-7 rounded-full karsa-grad flex items-center justify-center cursor-pointer"
            title="Mode Aplikasi Besar (Alt+Shift+K)"
            aria-label="Mode Aplikasi Besar"
          >
            <Maximize2 className="w-3.5 h-3.5" strokeWidth={2.25} />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-3.5 pb-2 flex-shrink-0">
          <div role="tablist" className="flex rounded-full bg-pill p-0.5">
            {([
              ["chat", "Chat & Persetujuan", <MessageCircle key="c" className="w-3 h-3" />],
              ["auto", "Otomasi", <Sparkles key="a" className="w-3 h-3" />],
            ] as Array<[Tab, string, React.ReactNode]>).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 h-7 rounded-full text-[11px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer transition-colors ${tab === id ? "karsa-grad" : "text-ink-2 hover:text-ink"}`}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 min-h-0 px-3.5 pb-3.5 flex flex-col gap-2">
          {tab === "chat" && (
            <>
              {pending.length > 0 && (
                <button
                  type="button"
                  onClick={() => openWidget("approvals")}
                  className="flex-shrink-0 karsa-nested px-3 py-2 flex items-center gap-2 text-left cursor-pointer"
                >
                  <ShieldCheck className="w-4 h-4 text-teal-500 flex-shrink-0 animate-pulse" />
                  <span className="text-[11.5px] text-ink">
                    <b>{pending.length}</b> persetujuan menunggu keputusanmu
                  </span>
                </button>
              )}
              <div className="flex-1 min-h-0 karsa-nested p-3">
                <ChatBody size="L" chat={chat} onOpenSettings={onOpenSettings} />
              </div>
            </>
          )}

          {tab === "auto" && !current && (
            <div className="flex-1 min-h-0 overflow-y-auto grid grid-cols-2 gap-2 content-start pr-0.5">
              {AUTOMATIONS.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setActive(a.id)}
                  className="karsa-nested p-3 text-left cursor-pointer active:scale-[0.97] transition-transform hover:brightness-105 flex flex-col gap-2"
                >
                  <span className="w-8 h-8 rounded-[12px] flex items-center justify-center text-white" style={{ background: a.tint, boxShadow: "inset 0 1px 0 rgba(255,255,255,.5)" }}>
                    {a.icon}
                  </span>
                  <span>
                    <span className="block text-[11.5px] font-semibold text-ink leading-tight">
                      <span className="text-ink-muted font-mono mr-1">{a.no}</span>
                      {a.label}
                    </span>
                    <span className="block mt-0.5 text-[10px] text-ink-muted leading-snug">{a.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {tab === "auto" && current && (
            <>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button type="button" onClick={() => setActive(null)} className="w-7 h-7 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer" aria-label="Kembali ke daftar otomasi">
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[12.5px] font-semibold text-ink truncate">{current.label}</span>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto karsa-nested p-3 select-text">
                <AutomationPanel id={current.id} onGo={(id) => setActive(id)} />
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
};

export default RightAgenticDock;
