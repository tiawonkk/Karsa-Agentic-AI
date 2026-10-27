import React, { useCallback, useEffect, useState } from "react";
import { Check, CheckSquare, Droplet, Home, Inbox, MessageCircle, Plus, Send, ShieldCheck, Trash2, Upload, Wallet, X } from "lucide-react";
import { ApiError, Area, call, forgetToken, getToken, idr, initToken, useSync } from "./mobileApi";

type Tab = "home" | "tasks" | "money" | "approve" | "shelf" | "chat";

const card = "rounded-2xl bg-card border border-subtle p-3";
const input = "w-full h-11 px-3 rounded-xl bg-pill text-ink placeholder:text-ink-muted text-[14px] outline-none border border-transparent focus:border-accent";
const btn = "h-11 px-4 rounded-xl text-[14px] font-semibold inline-flex items-center justify-center gap-2 active:scale-95 disabled:opacity-50";

interface Today {
  greeting: string;
  tasks: { pending_count: number; focus: Array<{ id: number; title: string; hours_left: number | null }> };
  money: { daily_safe_spend_idr: number; total_remaining_idr: number; remaining_days: number };
  water: { total_ml: number; target_ml: number };
  nudges: Array<{ id: string; text?: string; title?: string; message?: string }>;
}
interface Task {
  id: number;
  title: string;
  status: string;
  due_at: string | null;
  quadrant?: string;
}
interface Entry {
  kind: "expense" | "income";
  id: number;
  amount_idr: number;
  category?: string | null;
  label?: string | null;
  description?: string | null;
  merchant?: string | null;
  date?: string;
  txn_date?: string;
}
interface Approval {
  action_id: string;
  session_thread_id: string;
  action_name: string;
  risk_level: string;
  summary?: string | null;
}
interface ShelfFile {
  id: number;
  name: string;
  size: number;
}

const useData = <T,>(loader: () => Promise<T>, version: number, onError: (e: unknown) => void): [T | null, () => void] => {
  const [data, setData] = useState<T | null>(null);
  const reload = useCallback(() => {
    loader().then(setData).catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    reload();
  }, [version, reload]);
  return [data, reload];
};

const Err: React.FC<{ msg: string | null }> = ({ msg }) => (msg ? <div role="alert" className="text-[13px] text-rose-500">{msg}</div> : null);

// ------------------------------------------------------------------------------------------------------ screens
const HomeScreen: React.FC<{ v: Record<Area, number>; onError: (e: unknown) => void }> = ({ v, onError }) => {
  const [t, reload] = useData(() => call<Today>("/today"), v.tasks + v.hydration + v.expenses + v.income, onError);
  const [msg, setMsg] = useState<string | null>(null);
  const drink = async () => {
    try {
      await call("/hydration/log", { method: "POST", json: { amount_ml: 250 } });
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gagal");
    }
  };
  const done = async (id: number) => {
    try {
      await call(`/tasks/${id}/complete`, { method: "POST" });
      reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gagal");
    }
  };
  if (!t) return <div className="text-ink-muted text-[14px]">Memuat…</div>;
  const pct = t.water.target_ml ? Math.min(100, Math.round((t.water.total_ml / t.water.target_ml) * 100)) : 0;
  return (
    <div className="space-y-3">
      <h1 className="text-[20px] font-semibold text-ink">{t.greeting}</h1>
      <div className={card}>
        <div className="text-[12px] text-ink-muted">Boleh dipakai hari ini</div>
        <div className="text-[24px] font-bold text-ink font-mono">{idr(t.money.daily_safe_spend_idr)}</div>
        <div className="text-[12px] text-ink-muted">Sisa {idr(t.money.total_remaining_idr)} untuk {t.money.remaining_days} hari</div>
      </div>
      <div className={card}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[12px] text-ink-muted flex items-center gap-1"><Droplet className="w-3.5 h-3.5 text-sky-500" />Air minum</div>
            <div className="text-[18px] font-semibold text-ink font-mono">{t.water.total_ml} / {t.water.target_ml} ml</div>
          </div>
          <button type="button" onClick={drink} className={`${btn} bg-sky-500 text-white`}>+ 250 ml</button>
        </div>
        <div className="mt-2 h-2 rounded-full bg-pill overflow-hidden"><div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className={card}>
        <div className="text-[12px] text-ink-muted mb-1">Fokus ({t.tasks.pending_count} tugas menunggu)</div>
        {t.tasks.focus.length === 0 && <div className="text-[14px] text-ink-2">Tidak ada tugas menunggu. 🎉</div>}
        {t.tasks.focus.map((x) => (
          <button key={x.id} type="button" onClick={() => done(x.id)} className="w-full flex items-center gap-3 py-2 text-left active:opacity-60">
            <span className="w-6 h-6 rounded-full border-2 border-subtle flex-shrink-0" />
            <span className="text-[14px] text-ink flex-1">{x.title}</span>
            {x.hours_left !== null && x.hours_left !== undefined && <span className="text-[11px] text-ink-muted">{x.hours_left < 24 ? `${Math.max(0, Math.round(x.hours_left))} j` : `${Math.round(x.hours_left / 24)} h`}</span>}
          </button>
        ))}
      </div>
      {t.nudges.map((n) => <div key={n.id} className="rounded-2xl bg-pill p-3 text-[13px] text-ink-2">{n.text ?? n.message ?? n.title}</div>)}
      <Err msg={msg} />
    </div>
  );
};

const TasksScreen: React.FC<{ v: Record<Area, number>; onError: (e: unknown) => void }> = ({ v, onError }) => {
  const [d, reload] = useData(() => call<{ tasks: Task[] }>("/tasks?recent_done_hours=24&limit=100"), v.tasks, onError);
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await call("/tasks", { method: "POST", json: { title: title.trim() } });
      setTitle("");
      reload();
    } catch (er) {
      setMsg(er instanceof Error ? er.message : "Gagal");
    }
  };
  const toggle = async (t: Task) => {
    try {
      await call(`/tasks/${t.id}/${t.status === "done" ? "reopen" : "complete"}`, { method: "POST" });
      reload();
    } catch (er) {
      setMsg(er instanceof Error ? er.message : "Gagal");
    }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={add} className="flex gap-2">
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tugas baru…" className={input} aria-label="Tugas baru" />
        <button type="submit" className={`${btn} bg-accent text-white`} aria-label="Tambah"><Plus className="w-5 h-5" /></button>
      </form>
      <Err msg={msg} />
      {d && d.tasks.length === 0 && <div className="text-[14px] text-ink-2">Belum ada tugas.</div>}
      <div className="space-y-2">
        {d?.tasks.map((t) => (
          <button key={t.id} type="button" onClick={() => toggle(t)} className={`${card} w-full flex items-center gap-3 text-left active:opacity-60`}>
            <span className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${t.status === "done" ? "bg-emerald-500 border-emerald-500" : "border-subtle"}`}>{t.status === "done" && <Check className="w-4 h-4 text-white" />}</span>
            <span className={`flex-1 text-[14px] ${t.status === "done" ? "line-through text-ink-muted" : "text-ink"}`}>{t.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

const CATS = ["makanan", "pelajaran", "kesehatan", "investment", "kesenangan"];

const MoneyScreen: React.FC<{ v: Record<Area, number>; onError: (e: unknown) => void }> = ({ v, onError }) => {
  const [d, reload] = useData(() => call<{ items: Entry[] }>("/finance/transactions?limit=20"), v.expenses + v.income, onError);
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState(CATS[0]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await call("/finance/transactions", {
        method: "POST",
        json: kind === "expense" ? { kind, amount_idr: Number(amount), category: cat, description: note || null } : { kind, amount_idr: Number(amount), merchant: note || null },
      });
      setAmount("");
      setNote("");
      reload();
    } catch (er) {
      setMsg(er instanceof Error ? er.message : "Gagal");
    }
  };
  const del = async (x: Entry) => {
    try {
      await call(`/finance/transactions/${x.kind}/${x.id}`, { method: "DELETE" });
      reload();
    } catch (er) {
      setMsg(er instanceof Error ? er.message : "Gagal");
    }
  };
  return (
    <div className="space-y-3">
      <form onSubmit={save} className={`${card} space-y-2`}>
        <div className="flex rounded-xl bg-pill p-1">
          {(["expense", "income"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)} className={`flex-1 h-9 rounded-lg text-[13px] font-semibold ${kind === k ? "bg-accent text-white" : "text-ink-2"}`}>{k === "expense" ? "Pengeluaran" : "Pemasukan"}</button>
          ))}
        </div>
        <input value={amount} inputMode="numeric" onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} placeholder="Jumlah (Rp)" className={input} aria-label="Jumlah" />
        {kind === "expense" && (
          <select value={cat} onChange={(e) => setCat(e.target.value)} className={input} aria-label="Kategori">{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "expense" ? "Catatan (mis. makan siang)" : "Sumber (mis. uang saku)"} className={input} />
        <button type="submit" disabled={!amount || Number(amount) <= 0} className={`${btn} bg-accent text-white w-full`}>Simpan</button>
        <Err msg={msg} />
      </form>
      <div className="space-y-2">
        {d?.items.map((x) => (
          <div key={`${x.kind}${x.id}`} className={`${card} flex items-center gap-3`}>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] text-ink truncate">{x.kind === "expense" ? (x.description || x.merchant || x.category) : (x.label || x.merchant || "Pemasukan")}</div>
              <div className="text-[11px] text-ink-muted">{(x.txn_date ?? x.date ?? "").slice(0, 10)}{x.category ? ` · ${x.category}` : ""}</div>
            </div>
            <div className={`font-mono text-[14px] font-semibold ${x.kind === "income" ? "text-emerald-500" : "text-ink"}`}>{x.kind === "income" ? "+" : "-"}{idr(x.amount_idr)}</div>
            <button type="button" onClick={() => del(x)} className="w-9 h-9 rounded-full text-ink-muted active:bg-rose-500 active:text-white flex items-center justify-center" aria-label="Hapus"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
};

const ApproveScreen: React.FC<{ v: Record<Area, number>; onError: (e: unknown) => void }> = ({ v, onError }) => {
  const [d, reload] = useData(() => call<{ approvals?: Approval[]; pending?: Approval[] }>("/approvals/pending"), v.approvals, onError);
  const [msg, setMsg] = useState<string | null>(null);
  const list = d?.approvals ?? d?.pending ?? [];
  const decide = async (a: Approval, decision: "approve" | "reject") => {
    try {
      await call(`/threads/${encodeURIComponent(a.session_thread_id)}/resume`, { method: "POST", json: { action_id: a.action_id, decision, reviewer_id: "hp" } });
      reload();
    } catch (er) {
      setMsg(er instanceof Error ? er.message : "Gagal");
    }
  };
  return (
    <div className="space-y-3">
      <Err msg={msg} />
      {d && list.length === 0 && <div className="text-[14px] text-ink-2">Tidak ada permintaan izin. Karsa akan memberi tahu di sini saat butuh persetujuanmu.</div>}
      {list.map((a) => (
        <div key={a.action_id} className={`${card} space-y-2`}>
          <div className="text-[11px] font-semibold uppercase text-rose-500">{a.risk_level === "critical" ? "Kritis" : "Penting"} · {a.action_name}</div>
          <div className="text-[14px] text-ink">{a.summary ?? "Karsa meminta izin menjalankan aksi."}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => decide(a, "approve")} className={`${btn} bg-emerald-500 text-white flex-1`}><Check className="w-4 h-4" />Izinkan</button>
            <button type="button" onClick={() => decide(a, "reject")} className={`${btn} bg-pill text-ink flex-1`}><X className="w-4 h-4" />Tolak</button>
          </div>
          <div className="text-[11px] text-ink-muted">Ingin mengubah isinya dulu? Buka Karsa di laptop.</div>
        </div>
      ))}
    </div>
  );
};

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

const ShelfScreen: React.FC<{ v: Record<Area, number>; onError: (e: unknown) => void }> = ({ v, onError }) => {
  const [d, reload] = useData(() => call<{ files: ShelfFile[] }>("/shelf/files"), v.shelf, onError);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setMsg(null);
    for (const f of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", f);
      try {
        await call("/shelf/upload", { method: "POST", body: fd });
      } catch (er) {
        setMsg(er instanceof Error ? er.message : "Gagal");
      }
    }
    setBusy(false);
    reload();
  };
  const del = async (id: number) => {
    try {
      await call(`/shelf/files/${id}`, { method: "DELETE" });
      reload();
    } catch (er) {
      setMsg(er instanceof Error ? er.message : "Gagal");
    }
  };
  return (
    <div className="space-y-3">
      <label className={`${btn} bg-accent text-white w-full cursor-pointer`}>
        <Upload className="w-4 h-4" />{busy ? "Mengirim…" : "Kirim file ke laptop"}
        <input type="file" multiple className="hidden" onChange={(e) => { upload(e.target.files); e.target.value = ""; }} />
      </label>
      <Err msg={msg} />
      {d && d.files.length === 0 && <div className="text-[14px] text-ink-2">Laci kosong. File yang kamu kirim muncul juga di widget Laci File di laptop.</div>}
      {d?.files.map((f) => (
        <div key={f.id} className={`${card} flex items-center gap-3`}>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] text-ink truncate">{f.name}</div>
            <div className="text-[11px] text-ink-muted">{fmtSize(f.size)}</div>
          </div>
          <a href={`/api/v1/shelf/files/${f.id}/download?token=${encodeURIComponent(getToken())}`} className="h-9 px-3 rounded-full bg-pill text-ink text-[12px] font-semibold flex items-center">Unduh</a>
          <button type="button" onClick={() => del(f.id)} className="w-9 h-9 rounded-full text-ink-muted active:bg-rose-500 active:text-white flex items-center justify-center" aria-label={`Hapus ${f.name}`}><Trash2 className="w-4 h-4" /></button>
        </div>
      ))}
    </div>
  );
};

const ChatScreen: React.FC = () => {
  const [msgs, setMsgs] = useState<Array<{ role: "me" | "ai"; text: string }>>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread] = useState(() => `hp_${Date.now()}`);
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    setMsgs((m) => [...m, { role: "me", text: t }]);
    setBusy(true);
    try {
      const r = await call<{ response: string }>("/chat", { method: "POST", json: { message: t, thread_id: thread } });
      setMsgs((m) => [...m, { role: "ai", text: r.response }]);
    } catch (er) {
      setMsgs((m) => [...m, { role: "ai", text: `⚠️ ${er instanceof Error ? er.message : "Gagal"}` }]);
    }
    setBusy(false);
  };
  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-1 space-y-2 overflow-y-auto">
        {msgs.length === 0 && <div className="text-[14px] text-ink-2">Tanya Karsa apa saja, atau ketik perintah seperti <code>@Money -25k makan siang</code> atau <code>@Todo laprak jumat</code>.</div>}
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === "me" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[88%] rounded-2xl px-3 py-2 text-[14px] whitespace-pre-wrap ${m.role === "me" ? "bg-accent text-white" : "bg-card border border-subtle text-ink"}`}>{m.text}</div>
          </div>
        ))}
        {busy && <div className="text-[13px] text-ink-muted">Karsa sedang berpikir…</div>}
      </div>
      <form onSubmit={send} className="flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Tanya Karsa…" className={input} aria-label="Pesan" />
        <button type="submit" disabled={!text.trim() || busy} className={`${btn} bg-accent text-white`} aria-label="Kirim"><Send className="w-5 h-5" /></button>
      </form>
    </div>
  );
};

// ------------------------------------------------------------------------------------------------------ shell
const NAV: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
  { id: "home", label: "Beranda", icon: <Home className="w-5 h-5" /> },
  { id: "tasks", label: "Tugas", icon: <CheckSquare className="w-5 h-5" /> },
  { id: "money", label: "Uang", icon: <Wallet className="w-5 h-5" /> },
  { id: "approve", label: "Izin", icon: <ShieldCheck className="w-5 h-5" /> },
  { id: "shelf", label: "Laci", icon: <Inbox className="w-5 h-5" /> },
  { id: "chat", label: "Chat", icon: <MessageCircle className="w-5 h-5" /> },
];

export const MobileApp: React.FC = () => {
  const [token, setToken] = useState<string | null>(() => initToken());
  const [tab, setTab] = useState<Tab>("home");
  const [error, setError] = useState<string | null>(null);
  const unpair = useCallback(() => {
    forgetToken();
    setToken(null);
  }, []);
  const { online, versions } = useSync(unpair);
  const [pending, setPending] = useState(0);

  useEffect(() => {
    document.documentElement.classList.add("mobile");
  }, []);
  useEffect(() => {
    if (!token) return;
    call<{ approvals?: unknown[]; pending?: unknown[] }>("/approvals/pending")
      .then((d) => setPending((d.approvals ?? d.pending ?? []).length))
      .catch(() => {});
  }, [token, versions.approvals]);

  const onError = useCallback(
    (e: unknown) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        if (e.status === 401) unpair();
        setError(e.message);
      } else setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
    },
    [unpair]
  );

  if (!token) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center bg-[var(--bg-widget)]">
        <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center"><span className="w-2 h-5 bg-white rounded-full mx-0.5" /><span className="w-2 h-5 bg-white rounded-full mx-0.5" /></div>
        <h1 className="text-[20px] font-semibold text-ink">Pasangkan HP dengan Karsa</h1>
        <p className="text-[14px] text-ink-2 max-w-xs">Di laptop, buka Karsa → Settings → <b>Koneksi HP</b>, lalu pindai kode QR dengan kamera HP ini. Pastikan laptop dan HP satu Wi-Fi.</p>
        {error && <p className="text-[13px] text-rose-500 max-w-xs">{error}</p>}
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-widget)] text-ink select-text" style={{ paddingTop: "env(safe-area-inset-top)" }}>
      <header className="flex items-center justify-between px-4 h-12 flex-shrink-0">
        <span className="text-[16px] font-semibold">Karsa</span>
        <span className={`text-[11px] font-mono flex items-center gap-1.5 ${online ? "text-emerald-500" : "text-amber-500"}`}>
          <span className={`w-2 h-2 rounded-full ${online ? "bg-emerald-500" : "bg-amber-500 animate-pulse"}`} />
          {online ? "Tersinkron" : "Menyambung…"}
        </span>
      </header>
      {error && (
        <div className="mx-4 mb-2 rounded-xl bg-rose-500/10 text-rose-500 text-[13px] px-3 py-2 flex items-start gap-2" role="alert">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Tutup"><X className="w-4 h-4" /></button>
        </div>
      )}
      <main className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
        {tab === "home" && <HomeScreen v={versions} onError={onError} />}
        {tab === "tasks" && <TasksScreen v={versions} onError={onError} />}
        {tab === "money" && <MoneyScreen v={versions} onError={onError} />}
        {tab === "approve" && <ApproveScreen v={versions} onError={onError} />}
        {tab === "shelf" && <ShelfScreen v={versions} onError={onError} />}
        {tab === "chat" && <ChatScreen />}
      </main>
      <nav className="flex border-t border-subtle bg-card flex-shrink-0" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Menu">
        {NAV.map((n) => (
          <button key={n.id} type="button" onClick={() => setTab(n.id)} aria-current={tab === n.id} className={`relative flex-1 py-2 flex flex-col items-center gap-0.5 text-[10px] font-medium ${tab === n.id ? "text-accent" : "text-ink-muted"}`}>
            {n.icon}
            {n.label}
            {n.id === "approve" && pending > 0 && <span className="absolute top-1 right-[22%] min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-white text-[9px] font-bold flex items-center justify-center">{pending}</span>}
          </button>
        ))}
      </nav>
    </div>
  );
};
