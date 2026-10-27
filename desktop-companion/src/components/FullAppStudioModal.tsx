import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, Minimize2, Palette, Settings } from "lucide-react";
import { ThemeToggle } from "../context/ThemeContext";
import { useSystemStatus } from "../context/SystemStatusContext";
import { ChatBody, ChatBridge } from "./widgets/ChatWidget";
import { MascotCanvas } from "./MascotCanvas";
import { AUTOMATIONS, AutomationPanel } from "./studio/AutomationPanel";
import { OutfitItem } from "../lib/jelly";
import { StudioTarget, closeStudio, setStudioTarget, toggleStudio, useStudioMode } from "../stores/studioMode";

interface FullAppStudioModalProps {
  chat: ChatBridge;
  onOpenSettings: () => void;
  onOpenWardrobe: () => void;
  isDark: boolean;
  mascotColor: string;
  eyeColor: string;
  outfit: OutfitItem[];
  isSleeping: boolean;
}

/**
 * Full App Mode: the Agentic workspace as a roomy desktop window (85vw, max 1180px, 82vh). Left: Karsa's stage and the
 * navigation of the automations. Centre: the working canvas. Toggled with Alt+Shift+K, closed with Esc or "Kembali".
 * No backdrop: the rest of the screen stays click-through.
 */
export const FullAppStudioModal: React.FC<FullAppStudioModalProps> = ({ chat, onOpenSettings, onOpenWardrobe, isDark, mascotColor, eyeColor, outfit, isSleeping }) => {
  const { open, target } = useStudioMode();
  const { isApiConnected, activeBadge } = useSystemStatus();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && e.code === "KeyK") {
        e.preventDefault();
        toggleStudio();
      } else if (e.key === "Escape" && open) {
        closeStudio();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const current = AUTOMATIONS.find((a) => a.id === target) ?? null;
  const navBtn = (active: boolean) =>
    `w-full flex items-center gap-2.5 px-2.5 py-2 rounded-[16px] text-left text-[12px] cursor-pointer transition-colors ${active ? "karsa-grad font-semibold" : "text-ink-2 hover:bg-pill hover:text-ink"}`;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[58] pointer-events-none flex items-center justify-center font-sans">
          <motion.div
            key="studio"
            initial={{ opacity: 0, scale: 0.9, x: 120 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.92, x: 120 }}
            transition={{ type: "spring", stiffness: 300, damping: 30, mass: 0.9 }}
            className="karsa-surface karsa-panel pointer-events-auto flex overflow-hidden text-ink"
            style={{ width: "min(85vw, 1180px)", height: "82vh" }}
            role="dialog"
            aria-label="Mode Aplikasi Besar"
          >
            {/* Left rail: stage + navigation */}
            <div className="w-[236px] flex-shrink-0 p-3 flex flex-col gap-3 border-r border-subtle">
              <div className="karsa-nested p-3 flex flex-col items-center gap-1">
                <MascotCanvas size={104} bodyColor={mascotColor} eyeColor={eyeColor} outfit={outfit} isSleeping={isSleeping} isDark={isDark} showStarOrbit={false} />
                <div className="text-[13px] font-semibold">Karsa</div>
                <button
                  type="button"
                  onClick={onOpenWardrobe}
                  className="h-7 px-3 rounded-full bg-pill text-[11px] font-semibold text-ink-2 hover:text-ink inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Palette className="w-3 h-3" /> Wardrobe
                </button>
              </div>
              <nav className="flex-1 min-h-0 overflow-y-auto space-y-1" aria-label="Modul Agentic">
                <button type="button" onClick={() => setStudioTarget("chat")} className={navBtn(target === "chat")}>
                  <MessageCircle className="w-4 h-4" /> Chat & Persetujuan
                </button>
                {AUTOMATIONS.map((a) => (
                  <button key={a.id} type="button" onClick={() => setStudioTarget(a.id as StudioTarget)} className={navBtn(target === a.id)}>
                    {a.icon}
                    <span className="min-w-0">
                      <span className="block truncate">{a.label}</span>
                    </span>
                  </button>
                ))}
              </nav>
            </div>

            {/* Main canvas */}
            <div className="flex-1 min-w-0 flex flex-col p-3 gap-3">
              <div className="flex items-center gap-2 flex-shrink-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold truncate">{current ? current.label : "Chat & Persetujuan"}</div>
                  <div className="text-[11px] text-ink-muted truncate">{current ? current.blurb : "Bicara langsung dengan Karsa; keputusan HITL muncul di sini"}</div>
                </div>
                <span
                  className={`text-[10.5px] font-mono font-semibold px-2.5 h-6 rounded-full border inline-flex items-center gap-1 ${
                    isApiConnected ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30" : "bg-rose-500/10 text-rose-500 border-rose-500/30"
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isApiConnected ? "bg-emerald-500" : "bg-rose-500"}`} />
                  {activeBadge}
                </span>
                <ThemeToggle />
                <button type="button" onClick={onOpenSettings} className="w-7 h-7 rounded-full bg-pill text-ink flex items-center justify-center cursor-pointer" aria-label="Settings" title="Settings">
                  <Settings className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={closeStudio} className="h-7 px-3 rounded-full karsa-grad text-[11px] font-semibold inline-flex items-center gap-1.5 cursor-pointer">
                  <Minimize2 className="w-3 h-3" /> Kembali ke Mode Compact Dock
                </button>
              </div>

              <div className="flex-1 min-h-0 karsa-nested p-4 overflow-y-auto select-text">
                {current ? (
                  <div className="max-w-[860px] mx-auto">
                    <AutomationPanel id={current.id} onGo={(id) => setStudioTarget(id)} />
                  </div>
                ) : (
                  <ChatBody size="L" chat={chat} onOpenSettings={onOpenSettings} />
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default FullAppStudioModal;
