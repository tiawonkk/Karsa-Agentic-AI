import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Keyboard, RotateCcw, X } from "lucide-react";
import { WIDGET_IDS } from "../context/WidgetsContext";
import { WIDGET_DEFS } from "./widgets/WidgetLayer";
import {
  OPEN_SHEET_EVENT,
  actionFor,
  bindingOf,
  comboFromEvent,
  prettyCombo,
  resetBindings,
  setBinding,
  setShortcutsEnabled,
  useShortcuts,
} from "../stores/shortcuts";

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);

const FIXED: Array<[string, string]> = [
  ["Alt + Spasi", "Buka kotak pencarian Karsa (saat Karsa aktif)"],
  ["?", "Buka lembar pintasan ini"],
  ["Enter / E / Esc", "Setujui / Ubah / Tolak pada kartu izin di notch"],
];

/** Cheat sheet + rebinding. A small floating card (no backdrop), opened with `?` or from the Hari Ini widget. */
export const ShortcutsSheet: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const sc = useShortcuts();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recording) return; // the recorder below owns the keyboard
      if (e.key === "?" && !isTyping(e.target) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHEET_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHEET_EVENT, onOpen);
    };
  }, [open, recording]);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return; // only a modifier so far: keep waiting
      const res = setBinding(recording, combo);
      setMessage(res.ok ? null : res.reason ?? "Tidak bisa dipakai.");
      if (res.ok) setRecording(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording]);

  if (!open) return null;
  return createPortal(
    <div
      role="dialog"
      aria-label="Pintasan keyboard"
      className="karsa-surface pointer-events-auto fixed top-16 left-1/2 -translate-x-1/2 z-[60] w-[340px] max-w-[calc(100vw-1.5rem)] max-h-[78vh] overflow-y-auto rounded-2xl p-3.5 font-sans select-none"
    >
      <div className="flex items-center gap-2 mb-2">
        <Keyboard className="w-4 h-4 text-ink-2" />
        <span className="text-[13px] font-semibold text-ink">Pintasan keyboard</span>
        <button type="button" onClick={() => setOpen(false)} className="ml-auto w-6 h-6 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer" aria-label="Tutup">
          <X className="w-3.5 h-3.5" strokeWidth={2.25} />
        </button>
      </div>

      <label className="flex items-center gap-2 text-[11.5px] text-ink mb-2.5 cursor-pointer">
        <input type="checkbox" checked={sc.enabled} onChange={(e) => setShortcutsEnabled(e.target.checked)} className="accent-[var(--accent,#6366f1)]" />
        Aktifkan pintasan widget
      </label>

      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Buka / tutup widget</div>
      <div className="space-y-1 mb-3">
        {WIDGET_IDS.map((id) => {
          const action = actionFor(id);
          const combo = bindingOf(action, sc);
          const isRec = recording === action;
          return (
            <div key={id} className="flex items-center gap-2 text-[11.5px]">
              <span className="flex-1 min-w-0 truncate text-ink">{WIDGET_DEFS[id].title}</span>
              <kbd className={`px-2 py-0.5 rounded-md font-mono text-[10.5px] border border-subtle ${isRec ? "bg-accent text-white" : "bg-pill text-ink"} ${!sc.enabled ? "opacity-50" : ""}`}>
                {isRec ? "Tekan tombol…" : prettyCombo(combo)}
              </kbd>
              <button
                type="button"
                onClick={() => {
                  setMessage(null);
                  setRecording(isRec ? null : action);
                }}
                className="text-[10.5px] font-medium text-ink-2 hover:text-ink underline-offset-2 hover:underline cursor-pointer"
              >
                {isRec ? "Batal" : "Ubah"}
              </button>
              {combo && !isRec && (
                <button type="button" onClick={() => setBinding(action, null)} className="text-ink-muted hover:text-rose-500 cursor-pointer" aria-label={`Hapus pintasan ${WIDGET_DEFS[id].title}`} title="Hapus pintasan">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {message && <div className="text-[10.5px] text-rose-500 mb-2">{message}</div>}

      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Tetap</div>
      <div className="space-y-1 mb-3">
        {FIXED.map(([k, v]) => (
          <div key={k} className="flex items-start gap-2 text-[11px]">
            <kbd className="px-2 py-0.5 rounded-md font-mono text-[10.5px] bg-pill border border-subtle text-ink whitespace-nowrap">{k}</kbd>
            <span className="text-ink-2 leading-snug">{v}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => (resetBindings(), setMessage(null))} className="h-7 px-3 rounded-full bg-pill text-ink-2 hover:text-ink text-[11px] font-medium flex items-center gap-1.5 cursor-pointer">
          <RotateCcw className="w-3 h-3" /> Kembalikan awal
        </button>
      </div>
      <p className="text-[10px] text-ink-muted mt-2.5 leading-snug">
        Pintasan ini bekerja saat Karsa sedang aktif. Pintasan global (dari aplikasi lain) butuh versi desktop Tauri yang belum tersedia.
      </p>
    </div>,
    document.body
  );
};
