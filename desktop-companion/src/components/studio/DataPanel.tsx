import React, { useState } from "react";
import { Download, FolderOpen, Sparkles } from "lucide-react";
import { Btn, Card, ErrorLine, Hint, Label, api, field, useAction } from "./shared";
import { DatasetPreview, FileDropzone, UploadResult } from "./FileDropzone";
import { FolderBar } from "./FolderBar";
import { projectFolder, useProjectFolder } from "../../stores/projectFolder";

interface MlResult {
  rows: number;
  columns: number;
  target: string | null;
  steps: string[];
  label_mappings: Record<string, Record<string, number>>;
  downloads: { ml_csv: string; stats_csv: string; stats_docx: string; charts: string[] };
}
interface CleanResult {
  steps?: string[];
  rows_before?: number;
  rows_after?: number;
  files: Array<{ format: string; path: string; name: string }>;
  saved_in: string;
  in_project_folder: boolean;
  sample: Array<Record<string, string | null>>;
  columns_after: string[];
  [k: string]: unknown;
}

const Table: React.FC<{ cols: string[]; rows: Array<Record<string, string | null>> }> = ({ cols, rows }) => (
  <div className="overflow-x-auto rounded-lg border border-subtle">
    <table className="text-[10.5px] text-ink w-full">
      <thead>
        <tr className="bg-pill text-ink-2">
          {cols.map((c) => (
            <th key={c} className="px-2 py-1 text-left font-semibold whitespace-nowrap">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-subtle">
            {cols.map((c) => (
              <td key={c} className={`px-2 py-1 whitespace-nowrap ${r[c] === null || r[c] === undefined ? "text-rose-400 italic" : ""}`}>{r[c] ?? "kosong"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/** Data Science: upload a real CSV/XLSX/JSON, see its true profile, clean it, and save the results in the project folder. */
export const DataPanel: React.FC = () => {
  const folder = useProjectFolder();
  const [file, setFile] = useState<UploadResult | null>(null);
  const [fill, setFill] = useState("none");
  const [target, setTarget] = useState("");
  const [scale, setScale] = useState("standard");
  const [clean, setClean] = useState<CleanResult | null>(null);
  const [ml, setMl] = useState<MlResult | null>(null);

  const preview: DatasetPreview | undefined = file?.preview;

  const doClean = useAction(async () => {
    setClean(null);
    setClean(await api<CleanResult>("/files/dataset/clean", { method: "POST", json: { path: file!.path, options: { fill_missing: fill }, save_to_project: true, formats: ["csv", "xlsx"] } }));
  });
  const doMl = useAction(async () => {
    setMl(null);
    setMl(await api<MlResult>("/studio/data/ml-ready", { method: "POST", json: { path: file!.path, target: target.trim() || null, scale, encode: "auto" } }));
  });

  return (
    <div className="space-y-3">
      <FolderBar compact hint="Pilih folder agar hasil bersih (.csv dan .xlsx) langsung tersimpan di sana." />
      <FileDropzone
        kind="dataset"
        accept=".csv,.xlsx,.xls,.json"
        label="Upload Dataset"
        hint="Klik atau seret file .csv, .xlsx, .xls, .json (maks 50 MB). File asli tidak diubah."
        onUploaded={(r) => {
          setFile(r[0] as UploadResult);
          setClean(null);
          setMl(null);
        }}
      />

      {file && preview && (
        <Card className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-ink truncate">{file.name}</div>
            <div className="text-[10.5px] text-ink-muted whitespace-nowrap">{preview.rows} baris × {preview.columns} kolom</div>
          </div>
          <div className="grid grid-cols-3 gap-1.5 text-center">
            {[
              ["Baris", preview.rows],
              ["Nilai kosong", preview.missing_total],
              ["Duplikat", preview.duplicates],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-pill py-1.5">
                <div className="text-[14px] font-bold text-ink leading-none">{v}</div>
                <div className="text-[9.5px] text-ink-muted mt-0.5">{k}</div>
              </div>
            ))}
          </div>
          <Label>Pratinjau {preview.head.length} baris pertama</Label>
          <Table cols={preview.column_info.map((c) => c.name)} rows={preview.head} />
          <Label>Tipe data &amp; nilai kosong per kolom</Label>
          <div className="flex flex-wrap gap-1">
            {preview.column_info.map((c) => (
              <span key={c.name} className="px-2 py-0.5 rounded-full bg-pill text-[10px] text-ink" title={`${c.unique} nilai unik`}>
                <b>{c.name}</b> · {c.dtype}
                {c.missing > 0 && <span className="text-rose-400"> · {c.missing} kosong</span>}
              </span>
            ))}
          </div>

          <div className="flex items-end gap-2">
            <div className="w-40">
              <Label>Nilai kosong</Label>
              <select value={fill} onChange={(e) => setFill(e.target.value)} className={field} aria-label="Isi nilai kosong">
                <option value="none">Biarkan</option>
                <option value="median">Isi median/modus</option>
                <option value="drop">Hapus barisnya</option>
              </select>
            </div>
            <Btn onClick={() => doClean.run()} busy={doClean.busy} className="flex-1">
              <Sparkles className="w-3 h-3" /> Bersihkan Dataset Otomatis
            </Btn>
          </div>
          <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Kolom target (ML)</Label>
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
            </div>
            <Btn tone="plain" onClick={() => doMl.run()} busy={doMl.busy}>Ekspor siap-latih ML</Btn>
          </div>
          <ErrorLine message={doClean.error ?? doMl.error} />
        </Card>
      )}

      {clean && (
        <Card className="space-y-2">
          <div className="text-[12px] font-semibold text-ink">Dataset bersih tersimpan</div>
          <Hint>
            {clean.in_project_folder ? "Di folder project:" : "Belum ada folder project, jadi disimpan di folder output Karsa:"} <span className="font-mono">{clean.saved_in}</span>
          </Hint>
          <div className="flex flex-wrap gap-1.5">
            {clean.files.map((f) => (
              <span key={f.path} className="h-7 px-2.5 rounded-full bg-pill text-ink text-[10.5px] font-mono inline-flex items-center gap-1">
                <Download className="w-3 h-3" /> {f.name}
              </span>
            ))}
            {clean.in_project_folder && folder.path && (
              <button type="button" onClick={() => projectFolder.open("explorer")} className="h-7 px-2.5 rounded-full karsa-grad text-[10.5px] font-semibold inline-flex items-center gap-1 cursor-pointer">
                <FolderOpen className="w-3 h-3" /> Buka folder
              </button>
            )}
          </div>
          {clean.sample.length > 0 && (
            <>
              <Label>Hasil (10 baris pertama)</Label>
              <Table cols={clean.columns_after} rows={clean.sample} />
            </>
          )}
        </Card>
      )}

      {ml && (
        <Card className="space-y-2">
          <div className="text-[12px] font-semibold text-ink">{ml.rows} baris × {ml.columns} kolom siap dipakai untuk ML</div>
          <ul className="text-[10.5px] text-ink-2 list-disc pl-4 space-y-0.5">
            {ml.steps.length === 0 ? <li>Data sudah bersih; tidak ada transformasi tambahan.</li> : ml.steps.map((s) => <li key={s}>{s}</li>)}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            {[
              ["Data siap-latih (.csv)", ml.downloads.ml_csv],
              ["Statistik (.csv)", ml.downloads.stats_csv],
              ["Statistik (.docx)", ml.downloads.stats_docx],
              ...ml.downloads.charts.map((c, i) => [`Grafik ${i + 1}`, c]),
            ].map(([label, url]) => (
              <a key={url} href={url} download className="h-7 px-2.5 rounded-full bg-pill text-ink text-[10.5px] font-medium inline-flex items-center gap-1 hover:brightness-110">
                <Download className="w-3 h-3" />
                {label}
              </a>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
};
