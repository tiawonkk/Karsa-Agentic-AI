import React, { useCallback, useEffect, useState } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";

export type EntryKind = "expense" | "income";
export interface LedgerEntry {
  kind: EntryKind;
  id: number;
  txn_date: string;
  amount_idr: number;
  category: string | null;
  label: string;
  description: string | null;
}

export const CATEGORIES: Array<{ id: string; label: string; emoji: string }> = [
  { id: "makanan", label: "Makanan", emoji: "🍽️" },
  { id: "pelajaran", label: "Pelajaran", emoji: "📚" },
  { id: "kesehatan", label: "Kesehatan", emoji: "🏥" },
  { id: "investment", label: "Investasi", emoji: "📈" },
  { id: "kesenangan", label: "Kesenangan", emoji: "☕" },
];

const rp = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
const today = () => new Date().toISOString().slice(0, 10);

/** "25rb", "1,5jt", "25.000" -> 25000 (null when it is not a clear amount) */
export function parseAmount(text: string): number | null {
  const t = text.toLowerCase().replace(/rp\.?/g, "").replace(/\s+/g, "");
  const m = /^(\d+(?:[.,]\d+)?)(k|rb|ribu|jt|juta)?$/.exec(t);
  if (!m) return null;
  const unit = m[2];
  if (!unit) {
    // plain digits: "25.000" uses the dot as a thousands separator
    const plain = m[1].replace(/\./g, "").replace(",", ".");
    const v = Number(plain);
    return Number.isInteger(v) ? v : null;
  }
  const base = Number(m[1].replace(",", "."));
  const v = Math.round(base * (unit === "jt" || unit === "juta" ? 1_000_000 : 1000));
  return Number.isFinite(v) ? v : null;
}

async function call(url: string, init?: RequestInit): Promise<{ ok: boolean; body: any }> {
  try {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, body: res.ok ? body : typeof body.detail === "string" ? body.detail : `Gagal (${res.status})` };
  } catch (_) {
    return { ok: false, body: "Server tidak terjangkau" };
  }
}

const field = "h-8 px-2.5 rounded-lg bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent min-w-0";

/** Add an expense or income by hand. Errors from the server are shown as they are. */
export const LedgerForm: React.FC<{ onSaved: () => void; initialKind?: EntryKind }> = ({ onSaved, initialKind = "expense" }) => {
  const [kind, setKind] = useState<EntryKind>(initialKind);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("makanan");
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(today());
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseAmount(amount);
    if (n === null || n <= 0) {
      setMsg({ ok: false, text: "Isi nominal dengan angka, mis. 25000, 25rb, atau 1,5jt." });
      return;
    }
    setBusy(true);
    const r = await call("/api/v1/finance/transactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        amount_idr: n,
        category: kind === "expense" ? category : null,
        merchant: label.trim() || null,
        description: null,
        date,
      }),
    });
    setBusy(false);
    if (!r.ok) {
      setMsg({ ok: false, text: r.body });
      return;
    }
    setMsg({ ok: true, text: `${kind === "expense" ? "Pengeluaran" : "Pemasukan"} ${rp(n)} tersimpan.` });
    setAmount("");
    setLabel("");
    onSaved();
  };

  return (
    <form onSubmit={submit} className="space-y-2">
      <div role="group" aria-label="Jenis catatan" className="grid grid-cols-2 gap-1 p-0.5 rounded-full bg-pill">
        {(["expense", "income"] as EntryKind[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`h-7 rounded-full text-[11.5px] font-semibold cursor-pointer ${kind === k ? (k === "expense" ? "bg-rose-500 text-white" : "bg-emerald-500 text-white") : "text-ink-2 hover:text-ink"}`}
          >
            {k === "expense" ? "− Pengeluaran" : "+ Pemasukan"}
          </button>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="Nominal: 25rb, 1,5jt" aria-label="Nominal" className={`${field} flex-1 font-mono`} />
        {kind === "expense" ? (
          <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategori" className={`${field} w-[124px] cursor-pointer`}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.emoji} {c.label}
              </option>
            ))}
          </select>
        ) : null}
      </div>
      <div className="flex gap-1.5">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={kind === "expense" ? "Catatan / toko (opsional)" : "Sumber: uang saku, beasiswa…"} aria-label="Keterangan" maxLength={80} className={`${field} flex-1`} />
        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} aria-label="Tanggal" className={`${field} w-[128px]`} />
      </div>
      {msg && <div className={`text-[10.5px] ${msg.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500"}`}>{msg.text}</div>}
      <button type="submit" disabled={busy} className="w-full h-8 rounded-full bg-accent text-white text-[12px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-[0.98]">
        <Check className="w-3.5 h-3.5" /> Simpan
      </button>
    </form>
  );
};

/** The ledger: every entry can be corrected or removed. Deleting asks once. */
export const LedgerList: React.FC<{ refreshKey: number; onChanged: () => void }> = ({ refreshKey, onChanged }) => {
  const [items, setItems] = useState<LedgerEntry[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [draft, setDraft] = useState({ amount: "", category: "makanan", label: "", date: "" });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await call("/api/v1/finance/transactions?limit=50");
    if (r.ok) setItems(r.body.items);
    else setError(r.body);
  }, []);
  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const key = (e: LedgerEntry) => `${e.kind}:${e.id}`;
  const startEdit = (e: LedgerEntry) => {
    setEditing(key(e));
    setError(null);
    setDraft({ amount: String(e.amount_idr), category: e.category ?? "makanan", label: e.label ?? "", date: e.txn_date.slice(0, 10) });
  };
  const save = async (e: LedgerEntry) => {
    const n = parseAmount(draft.amount);
    if (n === null || n <= 0) return setError("Nominal harus angka lebih dari 0.");
    const body: Record<string, unknown> = { amount_idr: n, date: draft.date };
    if (e.kind === "expense") {
      body.category = draft.category;
      body.merchant = draft.label.trim() || null;
    } else body.label = draft.label.trim() || "Pemasukan";
    const r = await call(`/api/v1/finance/transactions/${e.kind}/${e.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) return setError(r.body);
    setEditing(null);
    setError(null);
    await load();
    onChanged();
  };
  const remove = async (e: LedgerEntry) => {
    const r = await call(`/api/v1/finance/transactions/${e.kind}/${e.id}`, { method: "DELETE" });
    setConfirm(null);
    if (!r.ok) return setError(r.body);
    await load();
    onChanged();
  };

  if (items === null) return <div className="text-[11px] text-ink-muted">{error ?? "Memuat…"}</div>;
  if (items.length === 0) return <div className="text-[11.5px] text-ink-muted py-4 text-center">Belum ada catatan. Buka tab Catat atau ketik “@Money -25k makan siang” di notch.</div>;

  return (
    <div className="space-y-1">
      {error && <div className="text-[10.5px] text-rose-500">{error}</div>}
      {items.map((e) => {
        const isEditing = editing === key(e);
        const meta = CATEGORIES.find((c) => c.id === e.category);
        if (isEditing)
          return (
            <div key={key(e)} className="rounded-xl border border-accent bg-card p-2 space-y-1.5">
              <div className="flex gap-1.5">
                <input value={draft.amount} onChange={(ev) => setDraft({ ...draft, amount: ev.target.value })} aria-label="Nominal" className={`${field} w-[96px] font-mono`} />
                {e.kind === "expense" && (
                  <select value={draft.category} onChange={(ev) => setDraft({ ...draft, category: ev.target.value })} aria-label="Kategori" className={`${field} flex-1 cursor-pointer`}>
                    {CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.emoji} {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-1.5">
                <input value={draft.label} onChange={(ev) => setDraft({ ...draft, label: ev.target.value })} aria-label="Keterangan" className={`${field} flex-1`} />
                <input type="date" value={draft.date} max={today()} onChange={(ev) => setDraft({ ...draft, date: ev.target.value })} aria-label="Tanggal" className={`${field} w-[128px]`} />
              </div>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => save(e)} className="h-6 px-3 rounded-full bg-accent text-white text-[10.5px] font-semibold cursor-pointer">
                  Simpan
                </button>
                <button type="button" onClick={() => setEditing(null)} className="h-6 px-3 rounded-full bg-pill text-ink-2 text-[10.5px] cursor-pointer">
                  Batal
                </button>
              </div>
            </div>
          );
        return (
          <div key={key(e)} className="group flex items-center gap-2 px-2 py-1.5 rounded-xl bg-card border border-subtle text-[11.5px]">
            <span aria-hidden="true">{e.kind === "income" ? "💵" : meta?.emoji ?? "•"}</span>
            <span className="flex-1 min-w-0">
              <span className="block truncate text-ink font-medium">{e.label}</span>
              <span className="block text-[9.5px] text-ink-muted font-mono">{e.txn_date.slice(0, 10)}</span>
            </span>
            <span className={`font-mono font-semibold flex-shrink-0 ${e.kind === "income" ? "text-emerald-600 dark:text-emerald-400" : "text-ink"}`}>
              {e.kind === "income" ? "+" : "−"}
              {rp(e.amount_idr)}
            </span>
            {confirm === key(e) ? (
              <span className="flex items-center gap-1 flex-shrink-0">
                <button type="button" onClick={() => remove(e)} className="h-5 px-2 rounded-full bg-rose-500 text-white text-[10px] font-semibold cursor-pointer">
                  Hapus?
                </button>
                <button type="button" onClick={() => setConfirm(null)} className="h-5 px-1.5 rounded-full bg-pill text-ink-2 text-[10px] cursor-pointer">
                  Batal
                </button>
              </span>
            ) : (
              <span className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
                <button type="button" onClick={() => startEdit(e)} className="text-ink-muted hover:text-ink cursor-pointer" aria-label={`Ubah ${e.label}`} title="Ubah">
                  <Pencil className="w-3 h-3" />
                </button>
                <button type="button" onClick={() => setConfirm(key(e))} className="text-ink-muted hover:text-rose-500 cursor-pointer" aria-label={`Hapus ${e.label}`} title="Hapus">
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};
