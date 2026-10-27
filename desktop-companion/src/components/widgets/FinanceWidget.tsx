import React, { useCallback, useEffect, useState } from "react";
import { WidgetSize } from "../../context/WidgetsContext";
import { OfflineNotice } from "./WidgetBits";
import { LedgerForm, LedgerList } from "./LedgerPanel";
import { useWidgets } from "../../context/WidgetsContext";

interface Snapshot {
  period: string;
  total_capital_idr: number;
  total_income_idr?: number;
  total_spent_idr: number;
  total_remaining_idr: number;
  remaining_days: number;
  daily_safe_spend_idr: number;
  categories: Record<string, { allocated: number; spent: number; remaining: number }>;
}

interface Txn {
  id: number;
  txn_date: string;
  amount_idr: number;
  category: string;
  merchant: string | null;
  description: string;
}

interface Report {
  snapshot: Snapshot;
  transactions: Txn[];
}

const rupiah = (n: number) => "Rp " + Math.round(n).toLocaleString("id-ID");
/** Rp45k style for the nano pill */
const rupiahShort = (n: number) => {
  const v = Math.abs(Math.round(n));
  const sign = n < 0 ? "-" : "";
  if (v >= 1_000_000) return `${sign}Rp${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}jt`;
  if (v >= 1000) return `${sign}Rp${Math.round(v / 1000)}k`;
  return `${sign}Rp${v}`;
};

const CATEGORY_META: Record<string, { label: string; emoji: string }> = {
  makanan: { label: "Makanan", emoji: "🍽️" },
  pelajaran: { label: "Pelajaran", emoji: "📚" },
  kesehatan: { label: "Kesehatan", emoji: "🏥" },
  investment: { label: "Investasi", emoji: "📈" },
  kesenangan: { label: "Kesenangan", emoji: "☕" },
};

/** Real budget + transactions from SQLite (/api/v1/finance/report). No report yet means an honest empty state. */
export function useFinance() {
  const [report, setReport] = useState<Report | null>(null);
  const [offline, setOffline] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/finance/report");
      if (!res.ok) {
        setOffline(true);
        return;
      }
      setOffline(false);
      setReport(await res.json());
    } catch (_) {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);
  return { report, offline, refresh };
}

export const FinanceBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const { report, offline, refresh } = useFinance();
  const { setSize } = useWidgets();
  const [tab, setTab] = useState<"ringkas" | "catat" | "riwayat">("ringkas");
  const [ledgerKey, setLedgerKey] = useState(0);
  const snap = report?.snapshot;

  if (offline && !report) return <OfflineNotice onRetry={refresh} compact={size === "S"} />;

  if (size === "S") {
    return (
      <div className="w-full flex items-center gap-2 pr-1 text-[13px] font-semibold text-ink whitespace-nowrap overflow-hidden">
        <span aria-hidden="true">💰</span>
        <span className="text-ink-2 font-medium">Sisa:</span>
        <span className="font-mono font-bold">{snap ? `${rupiahShort(snap.daily_safe_spend_idr)}/hr` : "—"}</span>
      </div>
    );
  }

  if (!snap) {
    return <div className="h-full flex items-center text-[11.5px] text-ink-muted">Memuat data keuangan… Ketik @Money untuk mulai mencatat.</div>;
  }

  const spentPct = snap.total_capital_idr > 0 ? Math.min(100, (snap.total_spent_idr / snap.total_capital_idr) * 100) : 0;

  const head = (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Daily Safe Spend</div>
      <div className="font-mono font-bold text-[21px] leading-tight text-ink">
        {rupiah(snap.daily_safe_spend_idr)}
        <span className="text-[12px] font-medium text-ink-2"> /hari</span>
      </div>
    </div>
  );

  const bar = (
    <div>
      <div className="w-full h-1.5 rounded-full bg-pill overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-[#059669] via-[#10B981] to-[#34D399] transition-all duration-300"
          style={{ width: `${spentPct}%` }}
        />
      </div>
      <div className="flex justify-between mt-1.5 text-[10.5px] font-mono text-ink-2">
        <span>Terpakai {rupiah(snap.total_spent_idr)}</span>
        <span>{snap.remaining_days} hari lagi</span>
      </div>
    </div>
  );

  if (size === "M") {
    return (
      <div className="h-full flex flex-col justify-between">
        {head}
        {bar}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => setSize("finance", "L")} className="flex-1 h-7 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold cursor-pointer active:scale-95">
            − Catat keluar
          </button>
          <button type="button" onClick={() => setSize("finance", "L")} className="flex-1 h-7 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold cursor-pointer active:scale-95">
            + Catat masuk
          </button>
        </div>
      </div>
    );
  }

  const txns = (report?.transactions ?? []).slice(0, 6);
  const changed = () => {
    setLedgerKey((k) => k + 1);
    refresh();
  };
  const tabs = (
    <div role="tablist" className="flex items-center gap-1 flex-shrink-0">
      {([["ringkas", "Ringkas"], ["catat", "Catat"], ["riwayat", "Riwayat"]] as const).map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`h-6 px-3 rounded-full text-[10.5px] font-semibold cursor-pointer ${tab === id ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"}`}>
          {label}
        </button>
      ))}
    </div>
  );
  if (tab !== "ringkas") {
    return (
      <div className="h-full flex flex-col gap-2 min-h-0">
        {tabs}
        <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
          {tab === "catat" ? <LedgerForm onSaved={changed} /> : <LedgerList refreshKey={ledgerKey} onChanged={changed} />}
        </div>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col gap-2.5 overflow-y-auto">
      {tabs}
      {head}
      {bar}
      {snap.total_income_idr ? <div className="text-[10.5px] font-mono text-emerald-600 dark:text-emerald-400">+ Pemasukan bulan ini {rupiah(snap.total_income_idr)}</div> : null}
      <div className="space-y-1.5 border-t border-subtle pt-2">
        {Object.entries(snap.categories ?? {}).map(([key, c]) => {
          const meta = CATEGORY_META[key] ?? { label: key, emoji: "•" };
          const pct = c.allocated > 0 ? Math.min(100, (c.spent / c.allocated) * 100) : 0;
          return (
            <div key={key} className="flex items-center gap-2 text-[10.5px]">
              <span className="w-[88px] truncate text-ink-2 font-medium">
                {meta.emoji} {meta.label}
              </span>
              <div className="flex-1 h-1 rounded-full bg-pill overflow-hidden">
                <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-[58px] text-right font-mono text-ink-2">{rupiahShort(c.remaining)}</span>
            </div>
          );
        })}
      </div>
      <div className="border-t border-subtle pt-2 space-y-1">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Transaksi terakhir</div>
        {txns.length === 0 ? (
          <div className="text-[11px] text-ink-muted">Belum ada transaksi. Coba “@Money -25k makan siang”.</div>
        ) : (
          txns.map((t) => (
            <div key={`e${t.id}`} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-ink">{t.merchant || t.description}</span>
              <span className="font-mono font-semibold text-ink-2 flex-shrink-0">-{rupiahShort(t.amount_idr)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
