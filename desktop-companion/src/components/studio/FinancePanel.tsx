import React, { useEffect, useState } from "react";
import { Download, ExternalLink, Newspaper, Sparkles } from "lucide-react";
import { Btn, Card, ErrorLine, Hint, Label, api, field, idr, useAction } from "./shared";

interface Report {
  period: string;
  total_capital_idr: number;
  total_income_idr: number;
  total_spent_idr: number;
  saved_idr: number;
  saving_rate_pct: number | null;
  daily_safe_spend_idr: number;
  remaining_days: number;
  categories: Array<{ category: string; spent: number; allocated: number; share_pct: number; over_budget: boolean }>;
  notes: string[];
  mutations: Array<{ date: string; type: string; category: string; label: string; amount: number }>;
}
interface NewsItem {
  title: string;
  link: string;
  source: string;
  summary: string;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export const FinancePanel: React.FC = () => {
  const [period, setPeriod] = useState(thisMonth());
  const [report, setReport] = useState<Report | null>(null);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [exported, setExported] = useState<{ name: string; url: string } | null>(null);

  const load = useAction(async () => setReport(await api<Report>(`/finance/monthly-report?period=${encodeURIComponent(period)}`)));
  const exp = useAction(async (format: "csv" | "docx") => {
    const r = await api<{ name: string; download_url: string }>("/finance/monthly-report/export", { method: "POST", json: { period, format } });
    setExported({ name: r.name, url: r.download_url });
  });
  const loadNews = useAction(async () => setNews((await api<{ items: NewsItem[] }>("/finance/news?limit=12")).items));
  const summarize = useAction(async () => {
    const r = await api<{ summary: string; items: NewsItem[] }>("/finance/news/summary", { method: "POST" });
    setDigest(r.summary);
    setNews(r.items);
  });

  useEffect(() => {
    load.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period]);

  return (
    <div className="space-y-3">
      <div>
        <Label>Laporan bulanan</Label>
        <div className="flex gap-2">
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className={field} aria-label="Bulan laporan" />
          <Btn tone="plain" onClick={() => exp.run("csv")} busy={exp.busy} title="Ekspor mutasi ke CSV"><Download className="w-3 h-3" />CSV</Btn>
          <Btn tone="plain" onClick={() => exp.run("docx")} busy={exp.busy} title="Ekspor laporan ke Word"><Download className="w-3 h-3" />DOCX</Btn>
        </div>
        <ErrorLine message={load.error ?? exp.error} />
        {exported && (
          <a href={exported.url} download={exported.name} className="text-[11px] text-accent underline">
            Unduh {exported.name}
          </a>
        )}
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["Pemasukan", idr(report.total_income_idr)],
              ["Pengeluaran", idr(report.total_spent_idr)],
              ["Sisa", idr(report.saved_idr)],
              ["Rasio tabungan", report.saving_rate_pct === null ? "-" : `${report.saving_rate_pct}%`],
            ].map(([k, v]) => (
              <Card key={k}>
                <div className="text-[10px] text-ink-muted">{k}</div>
                <div className="text-[13px] font-semibold text-ink">{v}</div>
              </Card>
            ))}
          </div>
          <Hint>
            Daily Safe Spend {idr(report.daily_safe_spend_idr)} per hari ({report.remaining_days} hari tersisa).
          </Hint>
          <Card className="space-y-1.5">
            {report.categories.map((c) => (
              <div key={c.category}>
                <div className="flex justify-between text-[11px] text-ink">
                  <span className="capitalize">{c.category}</span>
                  <span className={c.over_budget ? "text-rose-500 font-semibold" : ""}>
                    {idr(c.spent)} · {c.share_pct}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-pill overflow-hidden">
                  <div className={`h-full rounded-full ${c.over_budget ? "bg-rose-500" : "bg-accent"}`} style={{ width: `${Math.min(100, c.share_pct)}%` }} />
                </div>
              </div>
            ))}
          </Card>
          {report.notes.map((n) => (
            <Hint key={n}>• {n}</Hint>
          ))}
          {report.mutations.length > 0 && (
            <Card className="max-h-32 overflow-y-auto space-y-0.5">
              {report.mutations.map((m, i) => (
                <div key={i} className="flex justify-between gap-2 text-[10.5px] text-ink">
                  <span className="truncate">{m.date.slice(5)} · {m.label}</span>
                  <span className={m.amount < 0 ? "text-rose-500" : "text-emerald-500"}>{m.amount < 0 ? "-" : "+"}{idr(Math.abs(m.amount))}</span>
                </div>
              ))}
            </Card>
          )}
        </>
      )}

      <div>
        <Label>Berita keuangan</Label>
        <div className="flex gap-2">
          <Btn tone="plain" onClick={() => loadNews.run()} busy={loadNews.busy}><Newspaper className="w-3 h-3" />Muat berita</Btn>
          <Btn tone="plain" onClick={() => summarize.run()} busy={summarize.busy}><Sparkles className="w-3 h-3" />Ringkas</Btn>
        </div>
        <ErrorLine message={loadNews.error ?? summarize.error} />
        {digest && <Card className="mt-2 text-[11px] text-ink whitespace-pre-wrap">{digest}</Card>}
        {news && (
          <div className="mt-2 space-y-1.5">
            {news.map((n) => (
              <a key={n.link} href={n.link} target="_blank" rel="noopener noreferrer" className="block rounded-lg bg-pill px-2.5 py-1.5 hover:brightness-110">
                <div className="text-[11.5px] font-medium text-ink flex items-start gap-1">
                  <span className="flex-1">{n.title}</span>
                  <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0 text-ink-muted" />
                </div>
                <div className="text-[9.5px] text-ink-muted">{n.source}</div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
