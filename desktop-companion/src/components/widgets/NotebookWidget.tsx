import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Type,
  Upload,
  Wand2,
} from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { MarkdownView } from "../MarkdownView";
import { OfflineNotice } from "./WidgetBits";
import {
  AskResult,
  CleanOptions,
  CleanReport,
  DEFAULT_CLEAN_OPTIONS,
  NOTEBOOK_FILE_ACCEPT,
  NbDetail,
  NbSource,
  NbSummary,
  OfflineError,
  Paper,
  StudyOutput,
  getActiveNotebookId,
  isNotebookFile,
  notebookApi,
  setActiveNotebookId,
} from "../../lib/notebookApi";

interface QA {
  question: string;
  result: AskResult | null; // null while waiting
  error?: string;
}

type Output = StudyOutput | Paper;

// Survives remounts (dock <-> floating, size changes); the real data lives in SQLite
const session: Record<number, { qa: QA[]; output: Output | null; exported: { filename: string; url: string } | null }> = {};
const sessionOf = (id: number) => (session[id] ??= { qa: [], output: null, exported: null });

const KIND_ICON: Record<NbSource["kind"], React.ReactNode> = {
  document: <FileText className="w-3.5 h-3.5 text-indigo-500" />,
  dataset: <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />,
  text: <Type className="w-3.5 h-3.5 text-amber-500" />,
};

const chars = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)} rb` : String(n));

function useNotebook() {
  const [list, setList] = useState<NbSummary[]>([]);
  const [activeId, setActive] = useState<number | null>(getActiveNotebookId());
  const [detail, setDetail] = useState<NbDetail | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => {
    if (e instanceof OfflineError) setOffline(true);
    else setError(e instanceof Error ? e.message : "Terjadi kesalahan.");
  }, []);

  const refresh = useCallback(async () => {
    try {
      const nbs = await notebookApi.list();
      setOffline(false);
      setList(nbs);
      let id = getActiveNotebookId();
      if (!id || !nbs.some((n) => n.id === id)) id = nbs[0]?.id ?? null;
      setActive(id);
      setActiveNotebookId(id);
      setDetail(id ? await notebookApi.get(id) : null);
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const select = async (id: number) => {
    setActive(id);
    setActiveNotebookId(id);
    setError(null);
    try {
      setDetail(await notebookApi.get(id));
    } catch (e) {
      fail(e);
    }
  };

  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      fail(e);
      return null;
    } finally {
      setBusy(null);
    }
  };

  const create = async (title: string) => {
    const nb = await run("create", () => notebookApi.create(title));
    if (nb) {
      setActiveNotebookId(nb.id);
      await refresh();
    }
  };

  const reload = async () => {
    if (activeId) {
      try {
        setDetail(await notebookApi.get(activeId));
        setList(await notebookApi.list());
      } catch (e) {
        fail(e);
      }
    }
  };

  return { list, activeId, detail, offline, error, busy, setError, refresh, select, create, run, reload };
}

/** Compact card to add sources: file picker / drop zone and pasted text. */
const AddSources: React.FC<{
  onFiles: (files: FileList | File[]) => void;
  onText: (title: string, text: string) => void;
  busy: boolean;
  compact?: boolean;
}> = ({ onFiles, onText, busy, compact }) => {
  const input = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  return (
    <div className="space-y-1.5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOver(false);
          if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={`rounded-xl border border-dashed cursor-pointer flex items-center justify-center gap-2 text-center transition-colors ${
          compact ? "h-8 text-[10.5px]" : "h-[52px] text-[11px]"
        } ${over ? "border-accent bg-accent/10 text-ink" : "border-strong text-ink-2 hover:text-ink"}`}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
        <span className="font-medium">{compact ? "Tambah sumber" : "Tarik file ke sini atau klik (PDF, DOCX, PPTX, TXT, CSV, XLSX)"}</span>
        <input
          ref={input}
          type="file"
          multiple
          accept={NOTEBOOK_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>
      {!compact && (
        <>
          <button
            type="button"
            onClick={() => setPasting((p) => !p)}
            className="text-[10.5px] font-medium text-accent hover:underline cursor-pointer"
          >
            {pasting ? "Tutup" : "+ Tempel teks sebagai sumber"}
          </button>
          {pasting && (
            <div className="space-y-1">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Judul sumber"
                className="w-full h-7 px-2.5 rounded-lg bg-pill text-ink placeholder:text-ink-muted text-[11px] outline-none border border-transparent focus:border-accent"
              />
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Tempel catatan, abstrak, atau kutipan…"
                rows={3}
                className="w-full px-2.5 py-1.5 rounded-lg bg-pill text-ink placeholder:text-ink-muted text-[11px] outline-none border border-transparent focus:border-accent resize-none"
              />
              <button
                type="button"
                disabled={!title.trim() || !text.trim()}
                onClick={() => {
                  onText(title.trim(), text.trim());
                  setTitle("");
                  setText("");
                  setPasting(false);
                }}
                className="px-3 h-6 rounded-full bg-accent text-white text-[10.5px] font-semibold disabled:opacity-40 cursor-pointer"
              >
                Tambah
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-1.5 text-[10.5px] text-ink-2 cursor-pointer select-none">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent-primary)]" />
    {label}
  </label>
);

/** Dataset cleaner panel: options -> preview (dry run) -> apply (writes a NEW file; the original is never changed). */
const CleanPanel: React.FC<{ source: NbSource; onDone: () => void }> = ({ source, onDone }) => {
  const [opts, setOpts] = useState<CleanOptions>(DEFAULT_CLEAN_OPTIONS);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [applied, setApplied] = useState<CleanReport | null>(null);
  const [addAsSource, setAddAsSource] = useState(true);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof CleanOptions>(k: K, v: CleanOptions[K]) => {
    setOpts((o) => ({ ...o, [k]: v }));
    setReport(null);
    setApplied(null);
  };

  const preview = async () => {
    setBusy("preview");
    setErr(null);
    try {
      setReport(await notebookApi.cleanPreview(source.id, opts));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal membuat pratinjau.");
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    setBusy("apply");
    setErr(null);
    try {
      const r = await notebookApi.cleanApply(source.id, opts, addAsSource);
      setApplied(r);
      if (r.added_source) onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Gagal menyimpan hasil.");
    } finally {
      setBusy(null);
    }
  };

  const cols = report?.columns_after?.slice(0, 5) ?? [];
  return (
    <div className="rounded-xl bg-card border border-subtle p-2.5 space-y-2">
      <div className="text-[11px] font-semibold text-ink truncate">Bersihkan: {source.name}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <Check label="Header snake_case" checked={opts.normalize_headers} onChange={(v) => set("normalize_headers", v)} />
        <Check label="Rapikan spasi teks" checked={opts.strip_text} onChange={(v) => set("strip_text", v)} />
        <Check label="'-', 'N/A' → kosong" checked={opts.missing_tokens} onChange={(v) => set("missing_tokens", v)} />
        <Check label="Hapus baris/kolom kosong" checked={opts.drop_empty} onChange={(v) => set("drop_empty", v)} />
        <Check label="Hapus duplikat" checked={opts.drop_duplicates} onChange={(v) => set("drop_duplicates", v)} />
        <Check label="Angka (Rp, %, ribuan)" checked={opts.coerce_numeric} onChange={(v) => set("coerce_numeric", v)} />
        <Check label="Tanggal → YYYY-MM-DD" checked={opts.parse_dates} onChange={(v) => set("parse_dates", v)} />
      </div>
      <div className="flex items-center gap-1.5 text-[10.5px] text-ink-2">
        <span>Nilai kosong:</span>
        <select
          value={opts.fill_missing}
          onChange={(e) => set("fill_missing", e.target.value as CleanOptions["fill_missing"])}
          className="h-6 rounded-md bg-pill text-ink text-[10.5px] px-1 outline-none"
        >
          <option value="none">Biarkan</option>
          <option value="median">Isi (median/modus)</option>
          <option value="mode">Isi (modus)</option>
          <option value="drop">Hapus barisnya</option>
        </select>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={preview}
          disabled={busy !== null}
          className="px-3 h-7 rounded-full bg-pill text-ink text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer hover:brightness-110 disabled:opacity-50"
        >
          {busy === "preview" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />} Pratinjau
        </button>
        {report && (
          <button
            type="button"
            onClick={apply}
            disabled={busy !== null}
            className="px-3 h-7 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {busy === "apply" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Terapkan & simpan
          </button>
        )}
      </div>
      {report && !applied && <Check label="Tambahkan hasilnya sebagai sumber notebook" checked={addAsSource} onChange={setAddAsSource} />}
      {err && <div className="text-[10.5px] text-rose-500">{err}</div>}

      {report && (
        <div className="space-y-1.5 border-t border-subtle pt-2">
          <div className="text-[11px] font-mono text-ink">
            {report.before.rows}×{report.before.columns} → <span className="font-bold text-accent">{report.after.rows}×{report.after.columns}</span>
          </div>
          {report.steps.length === 0 ? (
            <div className="text-[10.5px] text-ink-muted">Dataset sudah bersih: tidak ada yang perlu diubah.</div>
          ) : (
            <ul className="space-y-0.5">
              {report.steps.map((s, i) => (
                <li key={i} className="text-[10.5px] text-ink-2 leading-snug">
                  <span className="font-mono font-bold text-ink">{s.count}</span> · {s.detail}
                </li>
              ))}
            </ul>
          )}
          {report.sample && report.sample.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-subtle">
              <table className="text-[10px] font-mono w-full">
                <thead>
                  <tr className="bg-pill text-ink-2">
                    {cols.map((c) => (
                      <th key={c} className="px-1.5 py-0.5 text-left font-semibold whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.sample.map((row, i) => (
                    <tr key={i} className="border-t border-subtle text-ink">
                      {cols.map((c) => (
                        <td key={c} className="px-1.5 py-0.5 whitespace-nowrap max-w-[90px] truncate">
                          {row[c] === null || row[c] === undefined ? "—" : String(row[c])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {applied && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-2 text-[10.5px] text-ink space-y-1">
          <div>
            Tersimpan sebagai <span className="font-mono font-bold">{applied.output_name}</span> (file asli tidak diubah).
          </div>
          {applied.download_url && (
            <a href={applied.download_url} download className="inline-flex items-center gap-1 font-semibold text-accent hover:underline">
              <Download className="w-3 h-3" /> Unduh hasil
            </a>
          )}
          {applied.added_source && <div className="text-ink-2">Profil hasil bersih ditambahkan sebagai sumber.</div>}
        </div>
      )}
    </div>
  );
};

export const NotebookBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const nb = useNotebook();
  const [tab, setTab] = useState<"sources" | "ask" | "studio">("sources");
  const [question, setQuestion] = useState("");
  const [topic, setTopic] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [cleaning, setCleaning] = useState<number | null>(null);
  const [, bump] = useState(0);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [openCite, setOpenCite] = useState<string | null>(null);

  const id = nb.activeId;
  const sess = id ? sessionOf(id) : null;
  const sources = nb.detail?.sources ?? [];
  const datasets = sources.filter((s) => s.kind === "dataset");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [sess?.qa.length, sess?.qa[sess.qa.length - 1]?.result]);

  if (nb.offline && !nb.detail && nb.list.length === 0) return <OfflineNotice onRetry={nb.refresh} compact={size === "S"} />;

  if (size === "S") {
    return (
      <div className="w-full flex items-center gap-2 pr-1 text-[12.5px] font-semibold text-ink whitespace-nowrap overflow-hidden">
        <span aria-hidden="true">📓</span>
        <span className="truncate">{nb.detail?.title ?? "Notebook"}</span>
        <span className="text-ink-2 font-medium flex-shrink-0">· {sources.length} sumber</span>
      </div>
    );
  }

  const uploadFiles = async (files: FileList | File[]) => {
    if (!id) return;
    const valid = Array.from(files).filter(isNotebookFile);
    if (valid.length === 0) {
      nb.setError("Format belum didukung. Gunakan PDF, DOCX, PPTX, TXT, MD, CSV, atau XLSX.");
      return;
    }
    await nb.run("upload", async () => {
      for (const f of valid) await notebookApi.addFile(id, f);
    });
    await nb.reload();
  };

  const addText = async (title: string, text: string) => {
    if (!id) return;
    await nb.run("upload", () => notebookApi.addText(id, title, text));
    await nb.reload();
  };

  const removeSource = async (sid: number) => {
    await nb.run("remove", () => notebookApi.removeSource(sid));
    if (cleaning === sid) setCleaning(null);
    await nb.reload();
  };

  const ask = async (q: string) => {
    if (!id || !q.trim()) return;
    const s = sessionOf(id);
    const entry: QA = { question: q.trim(), result: null };
    s.qa.push(entry);
    setQuestion("");
    setTab("ask");
    bump((n) => n + 1);
    try {
      entry.result = await notebookApi.ask(id, q.trim());
    } catch (e) {
      entry.error = e instanceof Error ? e.message : "Gagal menjawab.";
    }
    bump((n) => n + 1);
  };

  const generate = async (kind: "briefing" | "study_guide" | "paper_draft") => {
    if (!id) return;
    const out = await nb.run(kind, () => notebookApi.generate(id, kind, kind === "paper_draft" ? topic : ""));
    if (out) {
      const s = sessionOf(id);
      s.output = out;
      s.exported = null;
      bump((n) => n + 1);
    }
  };

  const exportDocx = async () => {
    if (!id || !sess?.output || sess.output.kind !== "paper_draft") return;
    const r = await nb.run("export", () => notebookApi.exportDocx(id, sess.output as Paper));
    if (r) {
      sess.exported = { filename: r.filename, url: r.download_url };
      bump((n) => n + 1);
    }
  };

  // ---- no notebook yet / notebook picker
  const picker = (
    <div className="flex items-center gap-1.5 min-w-0">
      {nb.list.length > 0 && !creating ? (
        <select
          value={id ?? ""}
          onChange={(e) => {
            if (e.target.value === "__new") setCreating(true);
            else nb.select(Number(e.target.value));
          }}
          className="flex-1 min-w-0 h-7 rounded-lg bg-pill text-ink text-[11.5px] font-semibold px-2 outline-none"
          title="Pilih notebook"
        >
          {nb.list.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title} ({n.source_count})
            </option>
          ))}
          <option value="__new">＋ Notebook baru…</option>
        </select>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newTitle.trim()) {
              nb.create(newTitle.trim());
              setNewTitle("");
              setCreating(false);
            }
          }}
          className="flex items-center gap-1.5 flex-1 min-w-0"
        >
          <input
            autoFocus={creating}
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nama notebook (mis. Skripsi ML)"
            className="flex-1 min-w-0 h-7 px-2.5 rounded-full bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent"
          />
          <button type="submit" disabled={!newTitle.trim()} className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 cursor-pointer" title="Buat notebook" aria-label="Buat notebook">
            <Plus className="w-3.5 h-3.5" />
          </button>
          {creating && nb.list.length > 0 && (
            <button type="button" onClick={() => setCreating(false)} className="text-[10.5px] text-ink-muted hover:text-ink cursor-pointer">
              Batal
            </button>
          )}
        </form>
      )}
    </div>
  );

  if (!id || !nb.detail) {
    return (
      <div className="h-full flex flex-col justify-center gap-2.5">
        <div className="text-[12px] font-semibold text-ink">Notebook sumber ilmiah</div>
        <div className="text-[10.5px] text-ink-2 leading-snug">
          Kumpulkan jurnal, catatan, dan dataset. Tanya jawab selalu bersumber, bersihkan dataset, lalu susun karya tulis ilmiah dengan sitasi.
        </div>
        {picker}
        {nb.error && <div className="text-[10.5px] text-rose-500">{nb.error}</div>}
      </div>
    );
  }

  const lastQA = sess?.qa[sess.qa.length - 1];
  const ask_input = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        ask(question);
      }}
      className="flex items-center gap-1.5"
    >
      <input
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        placeholder={sources.length ? "Tanya sumbermu…" : "Tambahkan sumber dulu"}
        disabled={sources.length === 0}
        className="flex-1 min-w-0 h-7 px-3 rounded-full bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent disabled:opacity-60"
      />
      <button type="submit" disabled={!question.trim() || sources.length === 0} className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 cursor-pointer" title="Kirim" aria-label="Kirim pertanyaan">
        <Send className="w-3.5 h-3.5" />
      </button>
    </form>
  );

  if (size === "M") {
    return (
      <div className="h-full flex flex-col gap-2 min-h-0">
        {picker}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
          {sources.length === 0 ? (
            <div className="text-[10.5px] text-ink-muted">Belum ada sumber.</div>
          ) : (
            sources.slice(0, 3).map((s) => (
              <div key={s.id} className="flex items-center gap-1.5 text-[11px] text-ink">
                {KIND_ICON[s.kind]}
                <span className="truncate flex-1">{s.name}</span>
              </div>
            ))
          )}
          {sources.length > 3 && <div className="text-[10px] text-ink-muted">+{sources.length - 3} sumber lain (perbesar ke L)</div>}
          {lastQA?.result && (
            <div className="text-[11px] text-ink-2 leading-snug border-t border-subtle pt-1 line-clamp-3">{lastQA.result.answer}</div>
          )}
          {lastQA && !lastQA.result && !lastQA.error && <div className="text-[10.5px] text-ink-muted">Mencari di sumber…</div>}
          {lastQA?.error && <div className="text-[10.5px] text-rose-500">{lastQA.error}</div>}
        </div>
        <AddSources onFiles={uploadFiles} onText={addText} busy={nb.busy === "upload"} compact />
        {ask_input}
      </div>
    );
  }

  // ---- L
  const tabBtn = (t: typeof tab, label: string) => (
    <button
      key={t}
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={`px-3 h-6 rounded-full text-[11px] font-semibold cursor-pointer transition-colors ${
        tab === t ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );

  const output = sess?.output ?? null;
  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      {picker}
      <div role="tablist" className="flex items-center gap-1.5">
        {tabBtn("sources", `Sumber (${sources.length})`)}
        {tabBtn("ask", "Tanya")}
        {tabBtn("studio", "Studio")}
      </div>

      {nb.error && (
        <div className="text-[10.5px] text-rose-500 flex items-start justify-between gap-2">
          <span>{nb.error}</span>
          <button type="button" onClick={() => nb.setError(null)} className="text-ink-muted hover:text-ink cursor-pointer" aria-label="Tutup pesan">
            ×
          </button>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-2">
        {tab === "sources" && (
          <>
            <AddSources onFiles={uploadFiles} onText={addText} busy={nb.busy === "upload"} />
            <div className="space-y-1">
              {sources.length === 0 && <div className="text-[10.5px] text-ink-muted">Belum ada sumber. Tambahkan jurnal, catatan, atau dataset.</div>}
              {sources.map((s) => (
                <div key={s.id} className="group flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-card border border-subtle text-[11px] text-ink">
                  {KIND_ICON[s.kind]}
                  <span className="truncate flex-1 font-medium" title={s.name}>
                    {s.name}
                  </span>
                  <span className="text-[9.5px] font-mono text-ink-muted flex-shrink-0">{chars(s.char_count)}</span>
                  <button
                    type="button"
                    onClick={() => removeSource(s.id)}
                    className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-rose-500 transition-opacity"
                    title="Hapus sumber"
                    aria-label={`Hapus ${s.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === "ask" && (
          <>
            {(sess?.qa.length ?? 0) === 0 && (
              <div className="space-y-1.5">
                <div className="text-[10.5px] text-ink-muted">Jawaban selalu merujuk ke sumbermu dengan nomor [n].</div>
                {["Ringkas isi sumber-sumber ini", "Apa temuan atau metode utamanya?", "Apa keterbatasan yang disebut?"].map((q) => (
                  <button key={q} type="button" onClick={() => ask(q)} disabled={sources.length === 0} className="block w-full text-left px-2.5 py-1.5 rounded-xl bg-card border border-subtle text-[11px] text-ink-2 hover:text-ink cursor-pointer disabled:opacity-50">
                    {q}
                  </button>
                ))}
              </div>
            )}
            {sess?.qa.map((item, i) => (
              <div key={i} className="space-y-1">
                <div className="flex justify-end">
                  <div className="max-w-[90%] px-2.5 py-1.5 rounded-2xl rounded-tr-sm bg-accent text-white text-[11.5px]">{item.question}</div>
                </div>
                <div className="px-2.5 py-1.5 rounded-2xl rounded-tl-sm bg-card border border-subtle text-ink text-[11.5px] leading-relaxed">
                  {item.error ? (
                    <span className="text-rose-500">{item.error}</span>
                  ) : item.result ? (
                    <>
                      <MarkdownView content={item.result.answer} />
                      {item.result.mode !== "llm" && (
                        <div className="mt-1 text-[9.5px] font-mono text-ink-muted">
                          {item.result.mode === "extractive" ? "mode ekstraktif (AI belum tersedia)" : "tidak ada yang cocok di sumber"}
                        </div>
                      )}
                      {item.result.citations.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {item.result.citations.map((c) => {
                            const key = `${i}-${c.n}`;
                            return (
                              <button
                                key={key}
                                type="button"
                                onClick={() => setOpenCite(openCite === key ? null : key)}
                                className={`px-1.5 h-5 rounded-full text-[9.5px] font-mono font-bold cursor-pointer ${
                                  openCite === key ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"
                                }`}
                                title={c.source}
                              >
                                [{c.n}] {c.source.length > 16 ? c.source.slice(0, 15) + "…" : c.source}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {item.result.citations.map((c) =>
                        openCite === `${i}-${c.n}` ? (
                          <blockquote key={c.n} className="mt-1.5 pl-2 border-l-2 border-accent text-[10.5px] text-ink-2 italic">
                            {c.excerpt}
                          </blockquote>
                        ) : null
                      )}
                    </>
                  ) : (
                    <span className="flex items-center gap-1.5 text-ink-muted">
                      <Loader2 className="w-3 h-3 animate-spin" /> Mencari di sumber…
                    </span>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </>
        )}

        {tab === "studio" && (
          <>
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  ["briefing", "Briefing"],
                  ["study_guide", "Panduan Belajar"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => generate(k)}
                  disabled={nb.busy !== null || sources.length === 0}
                  className="px-3 h-7 rounded-full bg-pill text-ink text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer hover:brightness-110 disabled:opacity-50"
                >
                  {nb.busy === k ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />} {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <input
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="Topik/judul karya tulis (opsional)"
                className="flex-1 min-w-0 h-7 px-2.5 rounded-full bg-pill text-ink placeholder:text-ink-muted text-[11px] outline-none border border-transparent focus:border-accent"
              />
              <button
                type="button"
                onClick={() => generate("paper_draft")}
                disabled={nb.busy !== null || sources.length === 0}
                className="px-3 h-7 rounded-full bg-accent text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {nb.busy === "paper_draft" ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookOpen className="w-3 h-3" />} Draf IMRaD
              </button>
            </div>

            {output && (
              <div className="rounded-xl bg-card border border-subtle p-2.5 space-y-2">
                {output.mode === "extractive" && (
                  <div className="text-[10px] font-mono text-amber-500">Mode ekstraktif: AI belum tersedia, berisi cuplikan nyata dari sumbermu.</div>
                )}
                <div className="text-[11px] leading-relaxed text-ink">
                  <MarkdownView content={output.markdown} />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(output.markdown).catch(() => {})}
                    className="px-2.5 h-6 rounded-full bg-pill text-ink-2 hover:text-ink text-[10.5px] font-semibold cursor-pointer"
                  >
                    Salin
                  </button>
                  {output.kind === "paper_draft" && (
                    <button
                      type="button"
                      onClick={exportDocx}
                      disabled={nb.busy === "export"}
                      className="px-2.5 h-6 rounded-full bg-accent text-white text-[10.5px] font-semibold flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      {nb.busy === "export" ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Ekspor .docx
                    </button>
                  )}
                  {sess?.exported && (
                    <a href={sess.exported.url} download className="text-[10.5px] font-semibold text-accent hover:underline">
                      Unduh {sess.exported.filename}
                    </a>
                  )}
                </div>
              </div>
            )}

            <div className="border-t border-subtle pt-2 space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">Pembersih dataset</div>
              {datasets.length === 0 ? (
                <div className="text-[10.5px] text-ink-muted">Tambahkan file .csv atau .xlsx di tab Sumber untuk membersihkannya.</div>
              ) : (
                datasets.map((d) => (
                  <div key={d.id} className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setCleaning(cleaning === d.id ? null : d.id)}
                      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-card border border-subtle text-[11px] text-ink hover:brightness-105 cursor-pointer"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="truncate flex-1 text-left font-medium">{d.name}</span>
                      <span className="text-[10px] font-semibold text-accent">{cleaning === d.id ? "Tutup" : "Bersihkan"}</span>
                    </button>
                    {cleaning === d.id && <CleanPanel source={d} onDone={() => nb.reload()} />}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {tab === "ask" && ask_input}
    </div>
  );
};
