import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Send, X } from "lucide-react";
import { MascotCanvas } from "./MascotCanvas";
import { MicButton } from "./MicButton";
import { MarkdownView } from "./MarkdownView";
import { ChatBridge } from "./widgets/ChatWidget";
import { PendingApprovalData } from "./HitlApprovalPill";
import { OutfitItem, useJellyMood } from "../lib/jelly";

type StageSize = "S" | "M" | "L" | "FULL";
const FRACTION: Record<StageSize, number> = { S: 0.3, M: 0.45, L: 0.68, FULL: 0.92 };
const SIZE_LABEL: Record<StageSize, string> = { S: "S", M: "M", L: "L", FULL: "Penuh" };
const BASE = 240; // internal drawing size; the canvas is scaled with CSS so a huge Karsa stays cheap to draw
const CANVAS_W = Math.round(BASE * 2.4);
const CANVAS_H = Math.round(BASE * 1.6);
const SIZE_KEY = "karsa_stage_size";

const CHIPS = ["Apa yang harus kukerjakan hari ini?", "Catat jajan kopi 15rb", "Bantu aku belajar", "Ceritakan sesuatu yang seru"];

interface KarsaStageProps {
  open: boolean;
  onClose: () => void;
  chat: ChatBridge;
  approvals: PendingApprovalData[];
  onApprovalDecision: (actionId: string, decision: "approve" | "edit" | "reject") => void;
  onDropFile: (files: FileList) => void;
  isDark: boolean;
  mascotColor: string;
  eyeColor: string;
  outfit: OutfitItem[];
}

/**
 * KarsaStage: Karsa grows (S / M / L / Penuh) and talks with the AI agent. The layer is click-through: only the jelly's
 * body, the speech bubble, the input and the small controls catch the mouse, so the desktop stays usable around it.
 * It reacts to the agent: thinks while the AI works, talks while text arrives, worries when an approval is waiting.
 */
export const KarsaStage: React.FC<KarsaStageProps> = ({ open, onClose, chat, approvals, onApprovalDecision, onDropFile, isDark, mascotColor, eyeColor, outfit }) => {
  const [size, setSize] = useState<StageSize>(() => {
    try {
      const v = localStorage.getItem(SIZE_KEY);
      return v === "S" || v === "M" || v === "L" || v === "FULL" ? v : "L";
    } catch (_) {
      return "L";
    }
  });
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [text, setText] = useState("");
  const [poke, setPoke] = useState(0);
  const mood = useJellyMood();
  const bubbleRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const last = chat.messages[chat.messages.length - 1];
  const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
  useEffect(() => {
    bubbleRef.current?.scrollTo({ top: bubbleRef.current.scrollHeight });
  }, [lastAssistant?.text, chat.isStreaming]);

  if (!open) return null;

  const pickSize = (s: StageSize) => {
    setSize(s);
    try {
      localStorage.setItem(SIZE_KEY, s);
    } catch (_) {}
  };
  // CSS scale: the canvas height follows a share of the viewport, never wider than the viewport
  const scale = Math.max(0.5, Math.min((FRACTION[size] * vp.h) / CANVAS_H, (0.96 * vp.w) / CANVAS_W));
  const cssW = CANVAS_W * scale;
  const cssH = CANVAS_H * scale;
  const R = BASE * 0.52 * scale;
  const hit = R * 2.15;

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || chat.isStreaming) return;
    chat.onSend(v);
    setText("");
  };

  const pending = approvals[0];
  const bubbleText = chat.isStreaming && !lastAssistant?.text ? "" : last?.role === "user" ? "" : lastAssistant?.text ?? "";
  const placeholder = mood === "listening" ? "Aku dengerin…" : "Ngobrol sama Karsa…";

  return createPortal(
    <div className="fixed inset-0 z-[55] pointer-events-none font-sans select-none" aria-label="Karsa">
      {/* controls (top right) */}
      <div className="absolute top-3 right-3 flex items-center gap-1 pointer-events-auto karsa-surface rounded-full px-1.5 py-1">
        {(Object.keys(FRACTION) as StageSize[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => pickSize(s)}
            aria-pressed={size === s}
            className={`h-6 px-2.5 rounded-full text-[10.5px] font-semibold cursor-pointer ${size === s ? "bg-accent text-white" : "text-ink-2 hover:text-ink"}`}
          >
            {SIZE_LABEL[s]}
          </button>
        ))}
        <button type="button" onClick={onClose} className="w-6 h-6 rounded-full bg-pill text-ink-2 hover:bg-rose-500 hover:text-white flex items-center justify-center cursor-pointer" title="Tutup (Esc)" aria-label="Tutup Karsa">
          <X className="w-3.5 h-3.5" strokeWidth={2.25} />
        </button>
      </div>

      {/* the jelly: the canvas itself is click-through; a round hit area over the body catches clicks and file drops */}
      <div className="absolute left-1/2 -translate-x-1/2" style={{ top: "50%", marginTop: -cssH / 2 - vp.h * 0.04, width: cssW, height: cssH }}>
        <div style={{ width: cssW, height: cssH, pointerEvents: "none" }}>
          <MascotCanvas
            size={BASE}
            bodyColor={mascotColor}
            eyeColor={eyeColor}
            outfit={outfit}
            isDark={isDark}
            showStarOrbit={false}
            passThrough
            displayScale={scale}
            pokeKey={poke}
          />
        </div>
        <div
          className="absolute rounded-full pointer-events-auto cursor-pointer"
          style={{ width: hit, height: hit, left: cssW / 2 - hit / 2, top: cssH / 2 - hit / 2 }}
          onClick={() => setPoke((p) => p + 1)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) onDropFile(e.dataTransfer.files);
          }}
          title="Colek Karsa! Seret file ke sini untuk dimakan"
        />
      </div>

      {/* speech bubble / approval card + input (bottom centre) */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-4 w-[min(560px,calc(100vw-1.5rem))] flex flex-col gap-2 items-stretch">
        {pending ? (
          <div className="pointer-events-auto karsa-surface rounded-3xl p-3.5 border-2" style={{ borderColor: "var(--accent-primary)" }}>
            <div className="text-[11px] font-semibold text-accent mb-1">Karsa butuh izinmu</div>
            <div className="text-[12.5px] text-ink leading-snug">{pending.request.summary}</div>
            {pending.evidence?.impact && <div className="text-[11px] text-ink-2 mt-1">{pending.evidence.impact}</div>}
            <div className="flex items-center gap-2 mt-2.5">
              <button type="button" onClick={() => onApprovalDecision(pending.action_id, "approve")} className="h-8 px-4 rounded-full bg-emerald-500 text-white text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer active:scale-95">
                <Check className="w-3.5 h-3.5" /> Setujui
              </button>
              <button type="button" onClick={() => onApprovalDecision(pending.action_id, "reject")} className="h-8 px-4 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[12px] font-semibold cursor-pointer active:scale-95">
                Tolak
              </button>
              {approvals.length > 1 && <span className="text-[10.5px] text-ink-muted ml-auto">+{approvals.length - 1} lainnya</span>}
            </div>
          </div>
        ) : (
          (bubbleText || chat.isStreaming) && (
            <div ref={bubbleRef} className="pointer-events-auto karsa-surface rounded-3xl px-4 py-3 max-h-[34vh] overflow-y-auto text-[13px] text-ink leading-relaxed">
              {bubbleText ? <MarkdownView content={bubbleText} /> : <span className="text-ink-2">Karsa lagi mikir…</span>}
            </div>
          )
        )}

        {!chat.isStreaming && !bubbleText && !pending && (
          <div className="flex flex-wrap justify-center gap-1.5 pointer-events-auto">
            {CHIPS.map((c) => (
              <button key={c} type="button" onClick={() => chat.onSend(c)} className="karsa-surface rounded-full px-3 h-7 text-[11.5px] text-ink hover:brightness-105 cursor-pointer active:scale-95">
                {c}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={send} className="pointer-events-auto karsa-surface rounded-full flex items-center gap-1.5 p-1.5">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            aria-label="Ngobrol dengan Karsa"
            className="flex-1 min-w-0 h-9 px-4 rounded-full bg-pill text-ink placeholder:text-ink-muted text-[13px] outline-none border border-transparent focus:border-accent"
          />
          <MicButton onText={setText} className="!w-9 !h-9" />
          <button type="submit" disabled={!text.trim() || chat.isStreaming} className="w-9 h-9 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 cursor-pointer active:scale-95" aria-label="Kirim">
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>,
    document.body
  );
};
