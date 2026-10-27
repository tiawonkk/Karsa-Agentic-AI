import React, { useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, CheckSquare, Keyboard, MessageCircle, Send, Wallet, X } from "lucide-react";
import { WidgetId, WidgetSize, useWidgets } from "../../context/WidgetsContext";
import { MicButton } from "../MicButton";
import { OfflineNotice } from "./WidgetBits";
import { ChatBridge } from "./ChatWidget";
import { openShortcutsSheet } from "../../stores/shortcuts";

interface Nudge {
  id: string;
  tone: "warn" | "info";
  text: string;
  action: string | null;
  action_label: string | null;
}
interface TodayData {
  greeting: string;
  tasks: { pending_count: number; focus: Array<{ id: number; title: string; hours_left: number | null }> };
  money: { daily_safe_spend_idr: number; total_remaining_idr: number; total_capital_idr: number; remaining_days: number };
  water: { total_ml: number; target_ml: number };
  nudges: Nudge[];
}

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const rpShort = (n: number) => (n >= 1_000_000 ? `Rp${(n / 1_000_000).toFixed(1)}jt` : `Rp${Math.round(n / 1000)}rb`);
const ONBOARD_KEY = "karsa_onboarded";
const SIMPLE_KEY = "karsa_simple_mode";

const readLS = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch (_) {
    return null;
  }
};
const writeLS = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch (_) {}
};

const dueLabel = (h: number | null): string => {
  if (h === null) return "";
  if (h < 0) return "lewat tenggat";
  if (h < 1) return "< 1 jam";
  if (h < 24) return `${Math.round(h)} jam lagi`;
  return `${Math.round(h / 24)} hari lagi`;
};

export function useToday() {
  const [data, setData] = useState<TodayData | null>(null);
  const [offline, setOffline] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/today");
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setOffline(false);
    } catch (_) {
      setOffline(true);
      setTimeout(refresh, 3000); // the server may still be starting: look again soon
    }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [refresh]);
  return { data, offline, refresh };
}

const FOCUS_CHOICES: Array<{ key: string; label: string; example: string; icon: React.ReactNode; open: WidgetId }> = [
  { key: "money", label: "Uang", example: "kopi 15rb", icon: <Wallet className="w-4 h-4" />, open: "finance" },
  { key: "tasks", label: "Tugas", example: "tugas kimia besok", icon: <CheckSquare className="w-4 h-4" />, open: "todo" },
  { key: "study", label: "Belajar", example: "rangkum materi kuliah", icon: <BookOpen className="w-4 h-4" />, open: "chat" },
];

export const TodayBody: React.FC<{ size: WidgetSize; chat: ChatBridge }> = ({ size, chat }) => {
  const { data, offline, refresh } = useToday();
  const { openWidget } = useWidgets();
  const [text, setText] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(() => readLS(ONBOARD_KEY));
  const [simple, setSimple] = useState(() => readLS(SIMPLE_KEY) === "1");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const example = FOCUS_CHOICES.find((c) => c.key === focus)?.example ?? "kopi 15rb, tugas kimia besok…";

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || chat.isStreaming) return;
    chat.onSend(v);
    setText("");
    setSent(v);
    openWidget("chat");
    setTimeout(refresh, 2500);
    setTimeout(() => setSent(null), 4000);
  };

  const pick = (c: (typeof FOCUS_CHOICES)[number]) => {
    writeLS(ONBOARD_KEY, c.key);
    setFocus(c.key);
    openWidget(c.open);
    inputRef.current?.focus();
  };

  const snooze = async (n: Nudge) => {
    await fetch(`/api/v1/today/nudges/${n.id}/snooze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: 24 }) }).catch(() => {});
    refresh();
  };
  const act = (n: Nudge) => {
    const map: Record<string, WidgetId> = { pomodoro: "pomodoro", finance: "finance", water: "water", todo: "todo" };
    if (n.action && map[n.action]) openWidget(map[n.action]);
  };

  if (offline && !data) return size === "S" ? <span className="text-[11px] text-rose-500">Server offline</span> : <OfflineNotice onRetry={refresh} />;
  if (!data) return <div className="text-[11px] text-ink-muted">Memuat…</div>;

  if (size === "S") {
    return (
      <div className="h-full flex items-center gap-2 px-1 text-[11.5px] font-medium text-ink whitespace-nowrap overflow-hidden">
        <span>☀️</span>
        <span>{data.tasks.pending_count} tugas</span>
        <span className="font-mono text-ink-2">{rpShort(data.money.daily_safe_spend_idr)}/hr</span>
      </div>
    );
  }

  const box = (
    <form onSubmit={send} className="flex items-center gap-1.5">
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`Tulis apa saja: ${example}`}
        aria-label="Tulis apa saja untuk Karsa"
        className={`flex-1 min-w-0 px-3 rounded-full bg-pill text-ink placeholder:text-ink-muted outline-none border border-transparent focus:border-accent ${simple ? "h-10 text-[13px]" : "h-8 text-[11.5px]"}`}
      />
      <MicButton onText={setText} />
      <button type="submit" disabled={!text.trim() || chat.isStreaming} className="w-8 h-8 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 cursor-pointer flex-shrink-0 active:scale-95" aria-label="Kirim">
        <Send className="w-3.5 h-3.5" />
      </button>
    </form>
  );

  const nudgeList = (limit: number) =>
    data.nudges.slice(0, limit).map((n) => (
      <div key={n.id} className={`rounded-xl px-2.5 py-2 text-[11px] leading-snug border ${n.tone === "warn" ? "bg-orange-500/10 border-orange-500/25" : "bg-sky-500/10 border-sky-500/25"}`}>
        <div className="text-ink">{n.text}</div>
        <div className="flex items-center gap-2 mt-1.5">
          {n.action_label && (
            <button type="button" onClick={() => act(n)} className="h-6 px-2.5 rounded-full bg-accent text-white text-[10.5px] font-semibold cursor-pointer active:scale-95">
              {n.action_label}
            </button>
          )}
          <button type="button" onClick={() => snooze(n)} className="text-[10.5px] text-ink-muted hover:text-ink cursor-pointer">
            Diam dulu
          </button>
        </div>
      </div>
    ));

  if (size === "M") {
    const top = data.tasks.focus[0];
    return (
      <div className="h-full flex flex-col gap-2 justify-between">
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-ink truncate">{data.greeting}</div>
          <div className="text-[11px] text-ink-2 truncate">{top ? `Fokus: ${top.title}` : "Belum ada tugas"}</div>
          <div className="text-[11px] font-mono text-ink-2">Aman belanja {rp(data.money.daily_safe_spend_idr)}/hari</div>
        </div>
        {box}
      </div>
    );
  }

  // L
  return (
    <div className="h-full overflow-y-auto pr-0.5 space-y-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0">
          <div className="font-display text-[17px] text-ink leading-tight">{data.greeting}</div>
          <div className="text-[10.5px] text-ink-muted">{data.tasks.pending_count} tugas menunggu · air {data.water.total_ml}/{data.water.target_ml} ml</div>
        </div>
        <button
          type="button"
          onClick={() => {
            const v = !simple;
            setSimple(v);
            writeLS(SIMPLE_KEY, v ? "1" : "0");
          }}
          aria-pressed={simple}
          title="Tampilan sederhana: tombol besar, tulisan besar"
          className={`ml-auto h-6 px-2.5 rounded-full text-[10px] font-semibold cursor-pointer flex-shrink-0 ${simple ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"}`}
        >
          Sederhana
        </button>
      </div>

      {focus === null && (
        <div className="rounded-2xl border border-subtle bg-pill/60 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <div className="flex-1 text-[12px] font-semibold text-ink leading-snug">Halo, aku Karsa. Apa yang paling bikin kamu pusing sekarang?</div>
            <button type="button" onClick={() => (writeLS(ONBOARD_KEY, "skip"), setFocus("skip"))} className="text-ink-muted hover:text-ink cursor-pointer" aria-label="Lewati" title="Lewati">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {FOCUS_CHOICES.map((c) => (
              <button key={c.key} type="button" onClick={() => pick(c)} className="h-14 rounded-xl bg-card border border-subtle text-ink flex flex-col items-center justify-center gap-1 text-[11px] font-semibold cursor-pointer hover:border-accent active:scale-95">
                {c.icon}
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {box}
      {sent && <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400">Terkirim: “{sent}”. Jawaban ada di widget AI Chat.</div>}

      {simple ? (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Catat", icon: <Wallet className="w-6 h-6" />, run: () => inputRef.current?.focus() },
            { label: "Tugas", icon: <CheckSquare className="w-6 h-6" />, run: () => openWidget("todo") },
            { label: "Tanya", icon: <MessageCircle className="w-6 h-6" />, run: () => openWidget("chat") },
          ].map((b) => (
            <button key={b.label} type="button" onClick={b.run} className="h-20 rounded-2xl bg-card border border-subtle text-ink flex flex-col items-center justify-center gap-1.5 text-[14px] font-semibold cursor-pointer hover:border-accent active:scale-95">
              {b.icon}
              {b.label}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">Fokus hari ini</div>
            {data.tasks.focus.length === 0 ? (
              <div className="text-[11.5px] text-ink-2">Belum ada tugas. Ketik satu di kotak atas.</div>
            ) : (
              <ul className="space-y-1">
                {data.tasks.focus.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 text-[11.5px]">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${t.hours_left !== null && t.hours_left < 24 ? "bg-orange-500" : "bg-emerald-500"}`} />
                    <span className="flex-1 min-w-0 truncate text-ink">{t.title}</span>
                    <span className="text-[10px] text-ink-muted whitespace-nowrap">{dueLabel(t.hours_left)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl bg-pill px-3 py-2 flex items-center gap-2">
            <Wallet className="w-4 h-4 text-amber-500 flex-shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] text-ink-muted">Aman belanja hari ini</div>
              <div className="font-mono font-semibold text-[13px] text-ink">{rp(data.money.daily_safe_spend_idr)}</div>
            </div>
            <div className="ml-auto text-right text-[10px] text-ink-muted">sisa {data.money.remaining_days} hari</div>
          </div>
        </>
      )}

      {data.nudges.length > 0 && <div className="space-y-1.5">{nudgeList(simple ? 1 : 3)}</div>}

      <button type="button" onClick={openShortcutsSheet} className="flex items-center gap-1.5 text-[10.5px] text-ink-muted hover:text-ink cursor-pointer">
        <Keyboard className="w-3 h-3" /> Pintasan keyboard (tekan ?)
      </button>
    </div>
  );
};
