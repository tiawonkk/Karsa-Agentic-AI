import React, { useRef, useState } from "react";
import { Loader2, UploadCloud } from "lucide-react";

export interface UploadResult {
  kind: string;
  name: string;
  path: string;
  size: number;
  text?: string;
  truncated?: boolean;
  summary?: { title: string; headings: string[]; chars: number; lines: number };
  preview?: DatasetPreview;
}

export interface DatasetPreview {
  rows: number;
  columns: number;
  missing_total: number;
  duplicates: number;
  column_info: Array<{ name: string; dtype: string; missing: number; unique: number }>;
  head: Array<Record<string, string | null>>;
}

interface FileDropzoneProps {
  /** Backend upload kind (prd | dataset | notebook | receipt | chat); ignored when `uploadFn` is given */
  kind?: string;
  /** Accepted extensions for the OS dialog, e.g. ".pdf,.docx,.md,.txt" */
  accept: string;
  multiple?: boolean;
  label: string;
  hint?: string;
  /** Custom upload (e.g. a notebook's own endpoint). Called once per file. */
  uploadFn?: (file: File) => Promise<unknown>;
  onUploaded?: (results: unknown[]) => void;
}

export async function uploadFile(kind: string, file: File): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", file);
  const res = await fetch("/api/v1/files/upload", { method: "POST", body: fd });
  let data: any = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `Unggahan gagal (HTTP ${res.status}).`);
  return data as UploadResult;
}

/** Click to pick (OS file dialog) or drag-and-drop one or more files. */
export const FileDropzone: React.FC<FileDropzoneProps> = ({ kind = "chat", accept, multiple = false, label, hint, uploadFn, onUploaded }) => {
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const allowed = accept.split(",").map((s) => s.trim().toLowerCase());
  const take = async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    setError(null);
    setDone(null);
    const bad = files.find((f) => !allowed.includes("." + (f.name.split(".").pop() ?? "").toLowerCase()));
    if (bad) {
      setError(`Format ${bad.name} tidak didukung. Gunakan: ${accept}.`);
      return;
    }
    setBusy(true);
    const results: unknown[] = [];
    try {
      for (const f of multiple ? files : files.slice(0, 1)) results.push(await (uploadFn ? uploadFn(f) : uploadFile(kind, f)));
      setDone(results.length === 1 ? "1 file diunggah." : `${results.length} file diunggah.`);
      onUploaded?.(results);
    } catch (e: any) {
      setError(e?.message ?? "Unggahan gagal.");
      if (results.length) onUploaded?.(results);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div data-hit>
      <input ref={input} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => e.target.files && take(e.target.files)} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          take(e.dataTransfer.files);
        }}
        disabled={busy}
        className={`w-full rounded-[16px] border border-dashed px-3 py-3 flex flex-col items-center gap-1 text-center cursor-pointer transition-colors ${over ? "border-accent bg-pill" : "border-subtle hover:bg-pill"}`}
      >
        {busy ? <Loader2 className="w-5 h-5 text-ink-2 animate-spin" /> : <UploadCloud className="w-5 h-5 text-ink-2" />}
        <span className="text-[12px] font-semibold text-ink">{busy ? "Mengunggah…" : label}</span>
        <span className="text-[10.5px] text-ink-muted">{hint ?? `Klik untuk memilih atau seret file ke sini (${accept})`}</span>
      </button>
      {error && (
        <div role="alert" className="mt-1.5 text-[11px] text-rose-500 whitespace-pre-wrap">
          {error}
        </div>
      )}
      {done && !error && <div className="mt-1.5 text-[11px] text-emerald-500">{done}</div>}
    </div>
  );
};
