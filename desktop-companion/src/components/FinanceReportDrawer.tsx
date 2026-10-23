import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, TrendingDown, Calendar, Wallet, AlertCircle, ShoppingBag } from "lucide-react";

interface FinanceReportDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isDark?: boolean;
}

interface FinanceReportData {
  snapshot: {
    period: string;
    total_capital_idr: number;
    total_spent_idr: number;
    total_remaining_idr: number;
    remaining_days: number;
    daily_safe_spend_idr: number;
    categories: Record<
      string,
      { allocated: number; spent: number; remaining: number }
    >;
  };
  transactions: Array<{
    id: number;
    period: string;
    txn_date: string;
    amount_idr: number;
    category: string;
    merchant: string | null;
    description: string;
    source: string;
  }>;
  category_spending: Array<{
    category: string;
    total_spent: number;
    count: number;
  }>;
}

function formatRupiah(amount: number): string {
  return "Rp " + Math.round(amount).toLocaleString("id-ID");
}

export const FinanceReportDrawer: React.FC<FinanceReportDrawerProps> = ({
  isOpen,
  onClose,
  isDark = true,
}) => {
  const [data, setData] = useState<FinanceReportData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    fetch("/api/v1/finance/report")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => setData(d))
      .catch((e) => console.error(e))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const snap = data?.snapshot;

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-12 pb-6 bg-black/65 backdrop-blur-md overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
        className={`w-full max-w-[440px] h-[80vh] max-h-[620px] rounded-3xl overflow-hidden flex flex-col border shadow-2xl ${
          isDark
            ? "bg-[#18181B] border-white/10 text-zinc-100"
            : "bg-[#FAF9F6] border-zinc-200 text-zinc-900"
        }`}
        style={{
          boxShadow: isDark
            ? "0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)"
            : "0 24px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)",
        }}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 flex items-center justify-between border-b ${
            isDark ? "border-white/5 bg-white/[0.02]" : "border-zinc-200/80 bg-black/[0.01]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
              <Wallet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-semibold tracking-tight">Laporan Finansial @Money</h2>
              <p className="text-[10px] text-zinc-400">
                Periode {snap?.period ?? "Bulan Ini"} • Data Riil SQLite
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isDark ? "hover:bg-white/10 text-zinc-400" : "hover:bg-zinc-200 text-zinc-600"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {loading && !data ? (
            <div className="text-center py-10 text-zinc-400">Mengambil data SQLite...</div>
          ) : !snap ? (
            <div className="text-center py-10 text-zinc-400">Gagal memuat data keuangan.</div>
          ) : (
            <>
              {/* Daily Safe Spend Card */}
              <div
                className={`p-4 rounded-2xl border ${
                  isDark
                    ? "bg-gradient-to-br from-emerald-500/10 to-transparent border-emerald-500/20"
                    : "bg-emerald-50/70 border-emerald-200/80"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-zinc-400 font-medium">Daily Safe Spend Hari Ini</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 font-medium">
                    {snap.remaining_days} hari tersisa
                  </span>
                </div>
                <div className="text-xl font-bold tracking-tight text-emerald-500 font-mono">
                  {formatRupiah(snap.daily_safe_spend_idr)}
                  <span className="text-xs font-normal text-zinc-400"> / hari</span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1">
                  (Sisa Pagu Makanan + Kesenangan) ÷ Sisa Hari Bulan Ini
                </p>
              </div>

              {/* Capital & Spent Summary */}
              <div className="grid grid-cols-2 gap-2.5">
                <div
                  className={`p-3 rounded-xl border ${
                    isDark ? "bg-black/25 border-white/5" : "bg-white border-zinc-200/80"
                  }`}
                >
                  <div className="text-[10px] text-zinc-400">Total Modal Bulan Ini</div>
                  <div className="font-mono font-bold text-xs mt-0.5">
                    {formatRupiah(snap.total_capital_idr)}
                  </div>
                </div>
                <div
                  className={`p-3 rounded-xl border ${
                    isDark ? "bg-black/25 border-white/5" : "bg-white border-zinc-200/80"
                  }`}
                >
                  <div className="text-[10px] text-zinc-400">Total Terpakai</div>
                  <div className="font-mono font-bold text-xs mt-0.5 text-amber-500">
                    {formatRupiah(snap.total_spent_idr)}
                  </div>
                </div>
              </div>

              {/* 5 Categories Breakdown */}
              <div
                className={`p-3.5 rounded-2xl border space-y-2.5 ${
                  isDark ? "bg-black/20 border-white/5" : "bg-white border-zinc-200/80"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  Alokasi 5 Kategori Pagu
                </div>
                {Object.entries(snap.categories || {}).map(([cat, info]) => {
                  const pct = info.allocated > 0 ? Math.min(100, Math.round((info.spent / info.allocated) * 100)) : 0;
                  return (
                    <div key={cat} className="space-y-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="capitalize font-medium">{cat}</span>
                        <span className="font-mono text-[10px] text-zinc-400">
                          {formatRupiah(info.spent)} / {formatRupiah(info.allocated)}
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-zinc-700/20 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            pct >= 90 ? "bg-rose-500" : pct >= 70 ? "bg-amber-500" : "bg-emerald-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Recent Transactions List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                    Riwayat Transaksi Terakhir ({data.transactions.length})
                  </span>
                </div>

                {data.transactions.length === 0 ? (
                  <div
                    className={`p-6 rounded-2xl border text-center space-y-1.5 ${
                      isDark ? "bg-white/[0.02] border-white/5" : "bg-white border-zinc-200/80"
                    }`}
                  >
                    <ShoppingBag className="w-6 h-6 text-zinc-400 mx-auto opacity-40" />
                    <p className="text-xs font-medium text-zinc-400">Belum ada transaksi tercatat</p>
                    <p className="text-[10px] text-zinc-500">
                      Ketik misal <code className="text-orange-400">@Money -25k makan siang</code> di input Notch!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {data.transactions.map((tx) => (
                      <div
                        key={tx.id}
                        className={`p-2.5 rounded-xl border flex items-center justify-between ${
                          isDark ? "bg-white/[0.02] border-white/5" : "bg-white border-zinc-200/60"
                        }`}
                      >
                        <div className="min-w-0 flex-1 pr-2">
                          <div className="font-medium text-xs truncate">{tx.description}</div>
                          <div className="text-[10px] text-zinc-400 flex items-center gap-1.5 mt-0.5">
                            <span className="capitalize px-1.5 py-0.2 rounded bg-zinc-500/15 text-zinc-300">
                              {tx.category}
                            </span>
                            <span>• {tx.txn_date.split(" ")[0]}</span>
                          </div>
                        </div>
                        <div className="font-mono font-bold text-xs text-rose-400 flex-shrink-0">
                          -{formatRupiah(tx.amount_idr)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
