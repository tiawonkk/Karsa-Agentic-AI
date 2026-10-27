import React, { useEffect, useState } from "react";
import { Plus, Rocket, Trash2 } from "lucide-react";
import { Btn, Card, ErrorLine, Hint, Label, api, area, field, idr, useAction } from "./shared";

interface Row {
  name: string;
  cost: string;
}
interface Plan {
  capex_idr: number;
  contingency_idr: number;
  monthly_fixed_idr: number;
  cogs_per_unit_idr: number;
  margin_per_unit_idr: number;
  margin_pct: number | null;
  bep_units: number | null;
  bep_revenue_idr: number | null;
  revenue_month_idr: number;
  profit_month_idr: number;
  working_capital_idr: number;
  total_capital_needed_idr: number;
  payback_months: number | null;
  roi_12m_pct: number | null;
  notes: string[];
}
interface Canvas {
  canvas: Record<string, string>;
  market_notes: string;
  competitor_notes: string;
  assumptions: string[];
  used_llm: boolean;
  note?: string;
}
interface Biz {
  id: number;
  name: string;
  topic: string | null;
  data: { idea?: string; canvas?: Canvas; capital?: Plan };
}

const BLOCKS: Array<[string, string]> = [
  ["problem", "Masalah"],
  ["customer_segments", "Segmen pelanggan"],
  ["unique_value", "Nilai unik"],
  ["solution", "Solusi"],
  ["channels", "Saluran"],
  ["revenue_streams", "Sumber pendapatan"],
  ["cost_structure", "Struktur biaya"],
  ["key_metrics", "Metrik kunci"],
  ["unfair_advantage", "Keunggulan sulit ditiru"],
];

const RowsEditor: React.FC<{ title: string; hint: string; rows: Row[]; onChange: (r: Row[]) => void }> = ({ title, hint, rows, onChange }) => (
  <div>
    <Label>{title}</Label>
    <Hint>{hint}</Hint>
    <div className="space-y-1 mt-1">
      {rows.map((r, i) => (
        <div key={i} className="flex gap-1.5">
          <input value={r.name} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Nama" className={field} aria-label={`${title} nama ${i + 1}`} />
          <input value={r.cost} inputMode="numeric" onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, cost: e.target.value.replace(/[^\d]/g, "") } : x)))} placeholder="Rp" className={`${field} !w-28`} aria-label={`${title} biaya ${i + 1}`} />
          <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} className="w-8 h-8 rounded-full text-ink-2 hover:bg-rose-500 hover:text-white flex items-center justify-center cursor-pointer flex-shrink-0" aria-label="Hapus baris"><Trash2 className="w-3 h-3" /></button>
        </div>
      ))}
      <Btn tone="plain" onClick={() => onChange([...rows, { name: "", cost: "" }])} className="!h-7"><Plus className="w-3 h-3" />Tambah baris</Btn>
    </div>
  </div>
);

const toItems = (rows: Row[]) => rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), cost_idr: Number(r.cost || 0) }));

/** @Business: idea -> Lean Canvas -> capital plan (RAB, COGS, BEP, ROI) -> hand over to the app builder. */
export const BusinessPanel: React.FC<{ onBuildCreated: () => void }> = ({ onBuildCreated }) => {
  const [list, setList] = useState<Biz[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [idea, setIdea] = useState("");
  const [start, setStart] = useState<Row[]>([{ name: "", cost: "" }]);
  const [fixed, setFixed] = useState<Row[]>([{ name: "", cost: "" }]);
  const [unit, setUnit] = useState<Row[]>([{ name: "", cost: "" }]);
  const [price, setPrice] = useState("");
  const [units, setUnits] = useState("");
  const [dir, setDir] = useState("");

  const cur = list.find((b) => b.id === sel) ?? null;
  const load = useAction(async () => {
    const d = await api<{ projects: Biz[] }>("/studio/projects?kind=business");
    setList(d.projects);
    setSel((s) => (s !== null && d.projects.some((b) => b.id === s) ? s : d.projects[0]?.id ?? null));
  });
  const create = useAction(async () => {
    const name = idea.trim().split(/\s+/).slice(0, 6).join(" ").slice(0, 80);
    const p = await api<Biz>("/studio/projects", { method: "POST", json: { kind: "business", name, topic: idea } });
    setSel(p.id);
    await api(`/studio/business/${p.id}/canvas`, { method: "POST", json: { idea } });
    await load.run();
  });
  const canvas = useAction(async () => {
    await api(`/studio/business/${sel}/canvas`, { method: "POST", json: { idea: cur?.data.idea || cur?.topic || idea } });
    await load.run();
  });
  const calc = useAction(async () => {
    await api(`/studio/business/${sel}/capital`, {
      method: "POST",
      json: { start_items: toItems(start), monthly_fixed: toItems(fixed), unit_costs: toItems(unit), price_idr: Number(price || 0), units_per_month: Number(units || 0) },
    });
    await load.run();
  });
  const develop = useAction(async () => {
    await api(`/studio/business/${sel}/develop`, { method: "POST", json: { target_dir: dir } });
    onBuildCreated();
  });
  const del = useAction(async () => {
    await api(`/studio/projects/${sel}`, { method: "DELETE" });
    setSel(null);
    await load.run();
  });

  useEffect(() => {
    load.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const plan = cur?.data.capital;
  const cv = cur?.data.canvas;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Ide bisnis baru</Label>
        <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={2} placeholder="Tulis idemu dalam satu-dua kalimat" className={area} />
        <Btn onClick={() => create.run()} busy={create.busy} disabled={idea.trim().length < 10}><Plus className="w-3 h-3" />Buat &amp; isi Lean Canvas</Btn>
      </div>
      <ErrorLine message={create.error ?? load.error ?? canvas.error ?? calc.error ?? develop.error ?? del.error} />

      {list.length > 0 && (
        <div className="flex gap-2">
          <select value={sel ?? ""} onChange={(e) => setSel(Number(e.target.value))} className={field} aria-label="Pilih bisnis">
            {list.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <button type="button" onClick={() => del.run()} className="w-8 h-8 rounded-full text-ink-2 hover:bg-rose-500 hover:text-white flex items-center justify-center cursor-pointer flex-shrink-0" aria-label="Hapus bisnis"><Trash2 className="w-3 h-3" /></button>
        </div>
      )}

      {cur && (
        <>
          <Card className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>Lean Canvas</Label>
              <Btn tone="plain" onClick={() => canvas.run()} busy={canvas.busy} className="!h-7">Buat ulang</Btn>
            </div>
            {cv?.note && <Hint>{cv.note}</Hint>}
            <div className="grid grid-cols-1 gap-1.5">
              {BLOCKS.map(([k, label]) => (
                <div key={k} className="rounded-lg bg-pill px-2 py-1">
                  <div className="text-[9.5px] font-semibold text-ink-muted">{label}</div>
                  <div className="text-[11px] text-ink whitespace-pre-wrap">{cv?.canvas[k] || "—"}</div>
                </div>
              ))}
            </div>
            {cv?.market_notes && <Hint>Pasar: {cv.market_notes}</Hint>}
            {cv?.competitor_notes && <Hint>Pesaing: {cv.competitor_notes}</Hint>}
            {cv && cv.assumptions.length > 0 && <Hint>Asumsi yang perlu diverifikasi: {cv.assumptions.join("; ")}</Hint>}
          </Card>

          <Card className="space-y-3">
            <Label>Hitung kebutuhan modal</Label>
            <RowsEditor title="RAB awal" hint="Biaya sekali bayar: alat, renovasi, perizinan." rows={start} onChange={setStart} />
            <RowsEditor title="Biaya tetap bulanan" hint="Sewa, internet, gaji, langganan." rows={fixed} onChange={setFixed} />
            <RowsEditor title="Biaya per unit (HPP)" hint="Bahan dan kemasan untuk satu produk." rows={unit} onChange={setUnit} />
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Harga jual / unit</Label><input value={price} inputMode="numeric" onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ""))} placeholder="Rp" className={field} /></div>
              <div><Label>Target unit / bulan</Label><input value={units} inputMode="numeric" onChange={(e) => setUnits(e.target.value.replace(/[^\d]/g, ""))} placeholder="0" className={field} /></div>
            </div>
            <Btn onClick={() => calc.run()} busy={calc.busy} className="w-full">Hitung</Btn>
            {plan && (
              <div className="space-y-1 text-[11px] text-ink">
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    ["Total modal dibutuhkan", idr(plan.total_capital_needed_idr)],
                    ["RAB + cadangan", idr(plan.capex_idr + plan.contingency_idr)],
                    ["HPP / unit", idr(plan.cogs_per_unit_idr)],
                    ["Margin / unit", `${idr(plan.margin_per_unit_idr)}${plan.margin_pct !== null ? ` (${plan.margin_pct}%)` : ""}`],
                    ["Titik impas (BEP)", plan.bep_units === null ? "-" : `${plan.bep_units} unit · ${idr(plan.bep_revenue_idr)}`],
                    ["Laba / bulan", idr(plan.profit_month_idr)],
                    ["Balik modal", plan.payback_months === null ? "-" : `${plan.payback_months} bulan`],
                    ["ROI 12 bulan", plan.roi_12m_pct === null ? "-" : `${plan.roi_12m_pct}%`],
                  ].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-pill px-2 py-1"><div className="text-[9.5px] text-ink-muted">{k}</div><div className="font-semibold">{v}</div></div>
                  ))}
                </div>
                {plan.notes.map((n) => <Hint key={n}>⚠ {n}</Hint>)}
              </div>
            )}
          </Card>

          <Card className="space-y-2">
            <Label>Lanjut ke Developing</Label>
            <Hint>Cetak biru bisnis menjadi PRD untuk pembuat aplikasi. Kamu tetap meninjau dan menyetujui rencana sebelum ada file dibuat.</Hint>
            <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Folder tujuan, mis. D:\Proyek\TokoKu" className={field} />
            <Btn onClick={() => develop.run()} busy={develop.busy} disabled={!dir.trim()}><Rocket className="w-3 h-3" />Buat PRD &amp; siapkan aplikasi</Btn>
          </Card>
        </>
      )}
    </div>
  );
};
