import React, { useEffect } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Check, Edit3, X } from "lucide-react";

export interface PendingApprovalData {
  action_id: string;
  session_thread_id: string;
  module: string;
  action_name: string;
  risk_level: "high" | "critical";
  request: {
    summary: string;
    preview?: string;
    proposed_args?: Record<string, any>;
  };
}

interface HitlApprovalPillProps {
  approval: PendingApprovalData;
  onDecision: (actionId: string, decision: "approve" | "edit" | "reject") => void;
}

export const HitlApprovalPill: React.FC<HitlApprovalPillProps> = ({ approval, onDecision }) => {
  // Tactile Keyboard Shortcuts: Enter to approve, E to edit, Esc to reject (Section 5)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        onDecision(approval.action_id, "approve");
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        onDecision(approval.action_id, "edit");
      } else if (e.key === "Escape") {
        e.preventDefault();
        onDecision(approval.action_id, "reject");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [approval.action_id, onDecision]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.95, rotate: -0.5 }}
      animate={{ opacity: 1, y: 0, scale: 1, rotate: -0.5 }}
      exit={{ opacity: 0, scale: 0.9, y: -8 }}
      transition={{ type: "spring", stiffness: 350, damping: 26 }}
      className="p-3.5 rounded-2xl bg-[#1A1917] border border-[#D95D39]/30 text-white shadow-tactile-lifted relative overflow-hidden"
    >
      {/* Subtle Tint Accent Top Bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-[#D95D39]" />

      <div className="flex items-start gap-2.5">
        <div className="p-1.5 rounded-xl bg-[#D95D39]/15 text-[#D95D39] shrink-0 mt-0.5">
          <AlertCircle className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          {/* Header row: Solid Terracotta Badge + Action Name */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-sans font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#D95D39] text-white">
              Butuh Izin Kamu
            </span>
            <span className="text-[11px] font-mono text-[#D95D39]/80 uppercase">
              [{approval.module}]
            </span>
            <span className="text-xs font-semibold text-neutral-200">
              {approval.action_name}
            </span>
          </div>

          {/* Context: Lugas Student Phrasing */}
          <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">
            {approval.request.summary.startsWith("Karsa mau")
              ? approval.request.summary
              : `Karsa mau: ${approval.request.summary}`}
          </p>

          {/* Proof / Code Diff Box (JetBrains Mono) */}
          {approval.request.preview && (
            <div className="mt-2.5 p-2.5 rounded-xl bg-[#121212] border border-white/5 font-mono text-[11px] text-[#FAF9F6]/90 max-h-28 overflow-y-auto leading-relaxed shadow-inner">
              <pre className="whitespace-pre-wrap">{approval.request.preview}</pre>
            </div>
          )}

          {/* 3 Tactile Buttons with Shortcut Hints (Section 5) */}
          <div className="flex items-center gap-2 mt-3 pt-1">
            <button
              onClick={() => onDecision(approval.action_id, "approve")}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-semibold bg-[#D95D39] hover:bg-[#B84827] text-white shadow-tactile-rest transition-all hover:scale-[1.02] active:scale-[0.98]"
              title="Setujui eksekusi aksi (Enter)"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Izinkan</span>
              <kbd className="text-[9px] bg-black/25 px-1 py-0.2 rounded font-mono opacity-80">↵</kbd>
            </button>

            <button
              onClick={() => onDecision(approval.action_id, "edit")}
              className="flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-xl text-xs font-medium bg-[#242220] hover:bg-[#2E2C29] text-[#FAF9F6] border border-white/10 transition hover:scale-[1.02] active:scale-[0.98]"
              title="Ubah parameter terlebih dahulu (E)"
            >
              <Edit3 className="w-3.5 h-3.5 text-neutral-400" />
              <span>Ubah Dulu</span>
              <kbd className="text-[9px] bg-black/30 px-1 py-0.2 rounded font-mono text-neutral-400">E</kbd>
            </button>

            <button
              onClick={() => onDecision(approval.action_id, "reject")}
              className="flex items-center justify-center gap-1.5 py-1.5 px-2.5 rounded-xl text-xs font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition"
              title="Batalkan aksi (Esc)"
            >
              <X className="w-3.5 h-3.5" />
              <span>Batalkan</span>
              <kbd className="text-[9px] bg-white/5 px-1 py-0.2 rounded font-mono">Esc</kbd>
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
