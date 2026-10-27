import React, { useEffect, useState } from "react";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { Btn, Card, ErrorLine, Hint, Label, api, field, useAction } from "./shared";

interface MatrixRow {
  title: string;
  year: number | null;
  source: string;
  url: string;
  methods: string[];
  datasets: string[];
  metrics: string[];
  gap: string;
}

const MatrixTable: React.FC<{ rows: MatrixRow[] }> = ({ rows }) => (
  <div className="space-y-1.5">
    {rows.map((r) => (
      <Card key={r.title + r.year} className="space-y-0.5">
        <a href={r.url || undefined} target="_blank" rel="noopener noreferrer" className="text-[11.5px] font-semibold text-ink flex items-start gap-1">
          <span className="flex-1">{r.title}</span>
          {r.url && <ExternalLink className="w-3 h-3 mt-0.5 text-ink-muted flex-shrink-0" />}
        </a>
        <div className="text-[9.5px] text-ink-muted">{r.year ?? "tahun ?"} · {r.source}</div>
        <div className="text-[10.5px] text-ink-2">
          <b>Metode:</b> {r.methods.join(", ") || "—"} · <b>Dataset:</b> {r.datasets.join(", ") || "—"} · <b>Metrik:</b> {r.metrics.join(", ") || "—"}
        </div>
        {r.gap && <div className="text-[10.5px] text-amber-600 dark:text-amber-400">Celah tersirat: {r.gap}</div>}
      </Card>
    ))}
  </div>
);

/** @Search: real papers (arXiv, Crossref, Semantic Scholar) and the literature matrix. */
export const SearchPanel: React.FC = () => {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<MatrixRow[] | null>(null);
  const [errors, setErrors] = useState<Array<{ source: string; error: string }>>([]);
  const search = useAction(async () => {
    const d = await api<{ matrix: MatrixRow[]; errors: Array<{ source: string; error: string }> }>("/studio/literature", { method: "POST", json: { query: q } });
    setRows(d.matrix);
    setErrors(d.errors);
  });
  return (
    <div className="space-y-3">
      <div>
        <Label>Cari literatur</Label>
        <form onSubmit={(e) => { e.preventDefault(); search.run(); }} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="mis. student dropout prediction" className={field} />
          <Btn busy={search.busy} disabled={q.trim().length < 3} type="submit">Cari</Btn>
        </form>
        <Hint>Hasil dari paper nyata. Sel matriks kosong (—) berarti abstrak tidak menyebutkannya.</Hint>
      </div>
      <ErrorLine message={search.error} />
      {errors.map((e) => <Hint key={e.source}>⚠ {e.source}: {e.error}</Hint>)}
      {rows && (rows.length ? <MatrixTable rows={rows} /> : <Hint>Tidak ada paper ditemukan. Coba kata kunci bahasa Inggris yang lebih umum.</Hint>)}
    </div>
  );
};

interface Project {
  id: number;
  name: string;
  topic: string | null;
  data: { analysis?: Analysis };
}
interface Analysis {
  topic: string;
  matrix: MatrixRow[];
  facts: { papers_found: number; top_methods: Array<[string, number]>; datasets_mentioned: Array<[string, number]> };
  errors: Array<{ source: string; error: string }>;
  novelty: { summary: string; gaps: string[]; ideas: Array<{ title: string; why_new?: string; first_step?: string }> } | null;
  used_llm: boolean;
  llm_error?: string;
}

/** @Project: create a project, then find literature and judge what could be new. */
export const ProjectPanel: React.FC = () => {
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  const load = useAction(async () => setProjects((await api<{ projects: Project[] }>("/studio/projects?kind=project")).projects));
  const create = useAction(async () => {
    const p = await api<Project>("/studio/projects", { method: "POST", json: { kind: "project", name, topic } });
    setName("");
    setTopic("");
    setOpen(p.id);
    await load.run();
  });
  const analyze = useAction(async (id: number) => {
    await api(`/studio/projects/${id}/analyze`, { method: "POST" });
    await load.run();
  });
  const del = useAction(async (id: number) => {
    await api(`/studio/projects/${id}`, { method: "DELETE" });
    if (open === id) setOpen(null);
    await load.run();
  });

  useEffect(() => {
    load.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Proyek baru</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama proyek" className={field} />
        <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topik pencarian (bahasa Inggris lebih baik)" className={field} />
        <Btn onClick={() => create.run()} busy={create.busy} disabled={!name.trim()}><Plus className="w-3 h-3" />Buat proyek</Btn>
      </div>
      <ErrorLine message={create.error ?? load.error ?? analyze.error ?? del.error} />
      {projects.length === 0 && <Hint>Belum ada proyek. Kamu juga bisa mengetik <code>@Project nama | topik</code> di bar atas.</Hint>}
      {projects.map((p) => {
        const a = p.data.analysis;
        return (
          <Card key={p.id} className="space-y-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} className="flex-1 text-left cursor-pointer">
                <div className="text-[12px] font-semibold text-ink">{p.name}</div>
                <div className="text-[10px] text-ink-muted">{p.topic}</div>
              </button>
              <Btn tone="plain" onClick={() => analyze.run(p.id)} busy={analyze.busy && open === p.id} onMouseDown={() => setOpen(p.id)}>Analisis</Btn>
              <button type="button" onClick={() => del.run(p.id)} className="w-7 h-7 rounded-full text-ink-2 hover:bg-rose-500 hover:text-white flex items-center justify-center cursor-pointer" aria-label={`Hapus ${p.name}`}><Trash2 className="w-3 h-3" /></button>
            </div>
            {open === p.id && a && (
              <div className="space-y-2">
                {a.novelty && (
                  <div className="text-[11px] text-ink space-y-1">
                    <div className="whitespace-pre-wrap">{a.novelty.summary}</div>
                    {!a.used_llm && <Hint>Penilaian kebaruan oleh AI belum berjalan{a.llm_error ? ` (${a.llm_error})` : " (model belum tersambung)"}.</Hint>}
                    {a.novelty.gaps.length > 0 && <ul className="list-disc pl-4 text-ink-2">{a.novelty.gaps.map((g) => <li key={g}>{g}</li>)}</ul>}
                    {a.novelty.ideas.map((i) => (
                      <div key={i.title} className="rounded-lg bg-pill px-2 py-1.5">
                        <div className="font-semibold">{i.title}</div>
                        {i.why_new && <div className="text-ink-2">{i.why_new}</div>}
                        {i.first_step && <div className="text-ink-muted">Langkah pertama: {i.first_step}</div>}
                      </div>
                    ))}
                  </div>
                )}
                {a.errors.map((e) => <Hint key={e.source}>⚠ {e.source}: {e.error}</Hint>)}
                <MatrixTable rows={a.matrix} />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
};

