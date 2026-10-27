import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Btn, Card, ErrorLine, Hint, Label, api, field, useAction } from "./shared";

interface ShelfFile {
  id: number;
  name: string;
  type: string;
}
interface MlResult {
  rows: number;
  columns: number;
  target: string | null;
  steps: string[];
  label_mappings: Record<string, Record<string, number>>;
  downloads: { ml_csv: string; stats_csv: string; stats_docx: string; charts: string[] };
}

export const DataPanel: React.FC = () => {
  const [files, setFiles] = useState<ShelfFile[]>([]);
  const [sel, setSel] = useState<number | "">("");
  const [target, setTarget] = useState("");
  const [scale, setScale] = useState("standard");
  const [encode, setEncode] = useState("auto");
  const [result, setResult] = useState<MlResult | null>(null);

  const refresh = useAction(async () => {
    const d = await api<{ files: ShelfFile[] }>("/shelf/files");
    const ds = d.files.filter((f) => f.type === "dataset");
    setFiles(ds);
    setSel((cur) => (cur !== "" && ds.some((f) => f.id === cur) ? cur : ds[0]?.id ?? ""));
  });
  const run = useAction(async () => {
    setResult(null);
    setResult(await api<MlResult>("/studio/data/ml-ready", { method: "POST", json: { shelf_id: sel, target: target.trim() || null, scale, encode } }));
  });

  useEffect(() => {
    refresh.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <Hint>Jatuhkan file CSV atau Excel ke widget <b>Laci File</b>, lalu pilih di sini. File asli tidak diubah; hasil disimpan sebagai file baru.</Hint>
      <div>
        <Label>Dataset dari Laci</Label>
        <div className="flex gap-2">
          <select value={sel} onChange={(e) => setSel(e.target.value ? Number(e.target.value) : "")} className={field} aria-label="Dataset">
            {files.length === 0 && <option value="">Belum ada CSV/Excel di Laci</option>}
            {files.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
          <Btn tone="plain" onClick={() => refresh.run()}>Muat ulang</Btn>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label>Kolom target</Label>
          <input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="opsional" className={field} />
        </div>
        <div>
          <Label>Skala</Label>
          <select value={scale} onChange={(e) => setScale(e.target.value)} className={field}>
            <option value="standard">Z-score</option>
            <option value="minmax">Min-max</option>
            <option value="none">Tanpa</option>
          </select>
        </div>
        <div>
          <Label>Encoding</Label>
          <select value={encode} onChange={(e) => setEncode(e.target.value)} className={field}>
            <option value="auto">One-hot / label</option>
            <option value="label">Label saja</option>
          </select>
        </div>
      </div>
      <Btn onClick={() => run.run()} busy={run.busy} disabled={sel === ""} className="w-full">Bersihkan &amp; Ekspor siap-latih</Btn>
      <ErrorLine message={refresh.error ?? run.error} />

      {result && (
        <Card className="space-y-2">
          <div className="text-[12px] font-semibold text-ink">{result.rows} baris × {result.columns} kolom siap dipakai</div>
          <ul className="text-[10.5px] text-ink-2 list-disc pl-4 space-y-0.5">
            {result.steps.length === 0 ? <li>Data sudah bersih; tidak ada transformasi tambahan.</li> : result.steps.map((s) => <li key={s}>{s}</li>)}
          </ul>
          {Object.keys(result.label_mappings).length > 0 && (
            <Hint>
              Pemetaan label: {Object.entries(result.label_mappings).map(([k, m]) => `${k} → ${Object.entries(m).map(([a, b]) => `${a}=${b}`).join(", ")}`).join(" | ")}
            </Hint>
          )}
          <div className="flex flex-wrap gap-1.5">
            {[
              ["Data siap-latih (.csv)", result.downloads.ml_csv],
              ["Statistik (.csv)", result.downloads.stats_csv],
              ["Statistik (.docx)", result.downloads.stats_docx],
              ...result.downloads.charts.map((c, i) => [`Grafik ${i + 1}`, c]),
            ].map(([label, url]) => (
              <a key={url} href={url} download className="h-7 px-2.5 rounded-full bg-pill text-ink text-[10.5px] font-medium inline-flex items-center gap-1 hover:brightness-110">
                <Download className="w-3 h-3" />{label}
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
