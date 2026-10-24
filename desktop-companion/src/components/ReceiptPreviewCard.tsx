import React, { useEffect, useState } from "react";
import { Receipt, Loader2, AlertTriangle, Check } from "lucide-react";
import { FloatingPopupCard } from "./FloatingPopupCard";

const CATEGORIES = [
  { value: "makanan", label: "🍽️ Makanan" },
  { value: "pelajaran", label: "📚 Pelajaran" },
  { value: "kesehatan", label: "🏥 Kesehatan" },
  { value: "investment", label: "📈 Investasi" },
  { value: "kesenangan", label: "☕ Kesenangan" },
];

interface ReceiptItem {
  name: string;
  qty: number;
  price_idr: number;
}

interface ReceiptDraft {
  merchant: string;
  date: string | null;
  total_idr: string; // kept as text so the user can edit freely; validated on confirm
  category: string;
  description: string;
  items: ReceiptItem[];
}

type Phase =
  | { kind: "scanning" }
  | { kind: "error"; message: string }
  | { kind: "editing"; draft: ReceiptDraft; saving: boolean; error?: string }
  | { kind: "done"; message: string };

interface ReceiptPreviewCardProps {
  file: File | null;
  isDark: boolean;
  onClose: () => void;
  onRecorded?: () => void;
}

export const isImageFile = (f: File | null | undefined): boolean =>
  !!f && (f.type.startsWith("image/") || /\.(jpe?g|png|webp|heic)$/i.test(f.name));

const formatRupiah = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");

async function readDetail(res: Response): Promise<string> {
  try {
    const body = await res.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch (_) {}
  return `Gagal memproses struk (HTTP ${res.status}).`;
}

export const ReceiptPreviewCard: React.FC<ReceiptPreviewCardProps> = ({
  file,
  isDark,
  onClose,
  onRecorded,
}) => {
  const [phase, setPhase] = useState<Phase>({ kind: "scanning" });

  // Scan once per dropped file; a stale response must not overwrite a newer drop.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setPhase({ kind: "scanning" });

    (async () => {
      try {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/v1/finance/receipt/scan", { method: "POST", body: form });
        if (cancelled) return;
        if (!res.ok) {
          setPhase({ kind: "error", message: await readDetail(res) });
          return;
        }
        const data = await res.json();
        const r = data?.receipt ?? {};
        setPhase({
          kind: "editing",
          saving: false,
          draft: {
            merchant: r?.merchant ?? "",
            date: r?.date ?? null,
            total_idr: String(r?.total_idr ?? ""),
            category: CATEGORIES.some((c) => c.value === r?.category) ? r.category : "makanan",
            description: r?.description ?? "Struk belanja",
            items: Array.isArray(r?.items) ? r.items : [],
          },
        });
      } catch (_) {
        if (!cancelled) {
          setPhase({ kind: "error", message: "Backend Karsa tidak terjangkau. Pastikan server berjalan." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [file]);

  const updateDraft = (patch: Partial<ReceiptDraft>) =>
    setPhase((p) => (p.kind === "editing" ? { ...p, error: undefined, draft: { ...p.draft, ...patch } } : p));

  const handleConfirm = async () => {
    if (phase.kind !== "editing" || phase.saving) return;
    const { draft } = phase;
    const total = parseInt(draft.total_idr.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(total) || total <= 0) {
      setPhase({ ...phase, error: "Total harus berupa angka rupiah lebih dari 0." });
      return;
    }
    setPhase({ ...phase, saving: true, error: undefined });
    try {
      const res = await fetch("/api/v1/finance/receipt/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          total_idr: total,
          category: draft.category,
          merchant: draft.merchant.trim() || null,
          description: draft.description.trim() || "Struk belanja",
        }),
      });
      if (!res.ok) {
        setPhase({ ...phase, saving: false, error: await readDetail(res) });
        return;
      }
      const data = await res.json();
      const safe = data?.budget?.daily_safe_spend_idr;
      setPhase({
        kind: "done",
        message:
          `Tercatat ${formatRupiah(total)} (${draft.category}).` +
          (typeof safe === "number" ? ` Daily Safe Spend sekarang ${formatRupiah(safe)}/hari.` : ""),
      });
      onRecorded?.();
    } catch (_) {
      setPhase({ ...phase, saving: false, error: "Backend Karsa tidak terjangkau." });
    }
  };

  const fieldClass = `w-full h-7 text-xs px-2 rounded-lg border outline-none font-sans ${
    isDark
      ? "bg-white/[0.06] border-white/10 text-zinc-100 focus:border-white/30"
      : "bg-slate-100/80 border-slate-200/70 text-slate-900 focus:border-indigo-400"
  }`;
  const labelClass = "text-[10px] font-semibold text-slate-500 dark:text-zinc-400 block mb-0.5";

  return (
    <FloatingPopupCard
      isOpen={file !== null}
      onClose={onClose}
      title="Baca Struk"
      badge="@Money"
      icon={<Receipt className="w-3.5 h-3.5 text-emerald-500" />}
      isDark={isDark}
    >
      {phase.kind === "scanning" && (
        <div className="flex items-center gap-2 py-4 justify-center text-slate-500 dark:text-zinc-400">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Membaca struk {file?.name ? `“${file.name}”` : ""}…</span>
        </div>
      )}

      {phase.kind === "error" && (
        <div className="space-y-2">
          <div className="flex items-start gap-1.5 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{phase.message}</span>
          </div>
          <div className="text-[10px] text-slate-500 dark:text-zinc-400">
            Kamu masih bisa mencatat manual: <span className="font-mono">@Money -25k makan siang</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-white/15 hover:bg-slate-200/60 dark:hover:bg-white/10"
          >
            Tutup
          </button>
        </div>
      )}

      {phase.kind === "editing" && (
        <div className="space-y-2">
          <div className="text-[10px] text-slate-500 dark:text-zinc-400">
            Periksa hasil baca struk{phase.draft.date ? ` (${phase.draft.date})` : ""}. Belum tercatat sampai kamu
            menekan “Catat”.
          </div>

          <div>
            <label className={labelClass}>Toko</label>
            <input
              className={fieldClass}
              value={phase.draft.merchant}
              onChange={(e) => updateDraft({ merchant: e.target.value })}
              placeholder="Nama toko"
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Total (Rp)</label>
              <input
                className={`${fieldClass} font-mono font-bold`}
                inputMode="numeric"
                value={phase.draft.total_idr}
                onChange={(e) => updateDraft({ total_idr: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Kategori</label>
              <select
                className={fieldClass}
                value={phase.draft.category}
                onChange={(e) => updateDraft({ category: e.target.value })}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Catatan</label>
            <input
              className={fieldClass}
              value={phase.draft.description}
              onChange={(e) => updateDraft({ description: e.target.value })}
            />
          </div>

          {phase.draft.items.length > 0 && (
            <div className="max-h-16 overflow-y-auto text-[10px] font-mono text-slate-600 dark:text-zinc-400 space-y-0.5">
              {phase.draft.items.map((it, i) => (
                <div key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {it?.qty ?? 1}× {it?.name}
                  </span>
                  <span>{formatRupiah((it?.qty ?? 1) * (it?.price_idr ?? 0))}</span>
                </div>
              ))}
            </div>
          )}

          {phase.error && <div className="text-[10.5px] text-rose-600 dark:text-rose-400">{phase.error}</div>}

          <div className="flex gap-2 pt-0.5">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={phase.saving}
              className="flex-1 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-semibold flex items-center justify-center gap-1 disabled:opacity-50"
            >
              {phase.saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              <span>Catat</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-white/15 hover:bg-slate-200/60 dark:hover:bg-white/10"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {phase.kind === "done" && (
        <div className="space-y-2">
          <div className="flex items-start gap-1.5 text-emerald-600 dark:text-emerald-400">
            <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>{phase.message}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded-lg text-[11px] font-semibold border border-slate-300 dark:border-white/15 hover:bg-slate-200/60 dark:hover:bg-white/10"
          >
            Selesai
          </button>
        </div>
      )}
    </FloatingPopupCard>
  );
};

export default ReceiptPreviewCard;
