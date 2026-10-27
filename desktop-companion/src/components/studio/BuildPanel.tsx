import React, { useEffect, useState } from "react";
import { Check, FileCode2, Hammer, Plus, Trash2, X } from "lucide-react";
import { Btn, Card, ErrorLine, Hint, Label, api, area, field, useAction } from "./shared";

interface Build {
  id: number;
  name: string;
  prd: string;
  target_dir: string;
  status: "draft" | "planned" | "approved" | "building" | "done" | "failed";
  plan: { summary?: string; stack?: string; used_llm?: boolean; note?: string; files?: Array<{ path: string; purpose: string }>; commands?: { verify: string[][] } };
  log: Array<{ step: string; ok: boolean; detail: string }>;
}

const STATUS: Record<Build["status"], string> = {
  draft: "Draf",
  planned: "Menunggu persetujuan",
  approved: "Disetujui",
  building: "Membangun…",
  done: "Selesai",
  failed: "Gagal",
};

/** PRD-to-App: PRD -> plan -> your approval -> files -> build/test with self-correction. */
export const BuildPanel: React.FC<{ refreshKey: number }> = ({ refreshKey }) => {
  const [builds, setBuilds] = useState<Build[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [prd, setPrd] = useState("");
  const [dir, setDir] = useState("");

  const load = useAction(async () => {
    const d = await api<{ builds: Build[] }>("/app-builds");
    setBuilds(d.builds);
    setOpen((o) => o ?? d.builds[0]?.id ?? null);
  });
  const create = useAction(async () => {
    const b = await api<Build>("/app-builds", { method: "POST", json: { name, prd, target_dir: dir } });
    setName("");
    setPrd("");
    setOpen(b.id);
    await api(`/app-builds/${b.id}/plan`, { method: "POST" });
    await load.run();
  });
  const act = useAction(async (id: number, what: "plan" | "approve" | "reject" | "run") => {
    await api(`/app-builds/${id}/${what}`, { method: "POST" });
    if (what === "approve") await api(`/app-builds/${id}/run`, { method: "POST" });
    await load.run();
  });
  const del = useAction(async (id: number) => {
    await api(`/app-builds/${id}`, { method: "DELETE" });
    if (open === id) setOpen(null);
    await load.run();
  });

  useEffect(() => {
    load.run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // poll while something is building
  const building = builds.some((b) => b.status === "building" || b.status === "approved");
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => load.run(), 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [building]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label>Aplikasi baru dari PRD</Label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama aplikasi" className={field} />
        <textarea value={prd} onChange={(e) => setPrd(e.target.value)} rows={5} placeholder={"# PRD: Nama\n\n## Tujuan\n- ...\n\n## Fitur\n- ..."} className={area} />
        <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder="Folder tujuan (kosong/baru), mis. D:\Proyek\TokoKu" className={field} />
        <Btn onClick={() => create.run()} busy={create.busy} disabled={!name.trim() || prd.trim().length < 20 || !dir.trim()}><Plus className="w-3 h-3" />Susun rencana</Btn>
        <Hint>Tidak ada file ditulis dan tidak ada perintah dijalankan sebelum kamu menyetujui rencananya.</Hint>
      </div>
      <ErrorLine message={create.error ?? load.error ?? act.error ?? del.error} />

      {builds.map((b) => (
        <Card key={b.id} className="space-y-2">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setOpen(open === b.id ? null : b.id)} className="flex-1 text-left cursor-pointer min-w-0">
              <div className="text-[12px] font-semibold text-ink truncate">{b.name}</div>
              <div className="text-[10px] text-ink-muted truncate">{b.target_dir}</div>
            </button>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${b.status === "done" ? "bg-emerald-500/15 text-emerald-500" : b.status === "failed" ? "bg-rose-500/15 text-rose-500" : "bg-pill text-ink-2"}`}>{STATUS[b.status]}</span>
            <button type="button" onClick={() => del.run(b.id)} disabled={b.status === "building"} className="w-7 h-7 rounded-full text-ink-2 hover:bg-rose-500 hover:text-white flex items-center justify-center cursor-pointer disabled:opacity-40" aria-label={`Hapus ${b.name}`}><Trash2 className="w-3 h-3" /></button>
          </div>

          {open === b.id && (
            <div className="space-y-2">
              {b.plan.summary && (
                <div className="space-y-1">
                  <div className="text-[11px] text-ink">{b.plan.summary}</div>
                  {b.plan.note && <Hint>{b.plan.note}</Hint>}
                  {b.plan.stack && <Hint>Tumpukan: {b.plan.stack}</Hint>}
                  <div className="rounded-lg bg-pill px-2 py-1.5 space-y-0.5">
                    {(b.plan.files ?? []).map((f) => (
                      <div key={f.path} className="text-[10.5px] text-ink flex gap-1.5"><FileCode2 className="w-3 h-3 mt-0.5 text-ink-muted flex-shrink-0" /><span className="font-mono">{f.path}</span><span className="text-ink-muted truncate">{f.purpose}</span></div>
                    ))}
                  </div>
                  {(b.plan.commands?.verify ?? []).length > 0 && (
                    <Hint>Perintah verifikasi: {(b.plan.commands?.verify ?? []).map((c) => c.join(" ")).join(" · ")}</Hint>
                  )}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {b.status === "draft" && <Btn onClick={() => act.run(b.id, "plan")} busy={act.busy}>Susun rencana</Btn>}
                {b.status === "planned" && (
                  <>
                    <Btn onClick={() => act.run(b.id, "approve")} busy={act.busy}><Check className="w-3 h-3" />Setujui &amp; bangun</Btn>
                    <Btn tone="plain" onClick={() => act.run(b.id, "reject")} busy={act.busy}><X className="w-3 h-3" />Tolak</Btn>
                  </>
                )}
                {(b.status === "building" || b.status === "approved") && <Hint><Hammer className="w-3 h-3 inline mr-1" />Sedang membangun dan memverifikasi…</Hint>}
                {b.status === "failed" && <Btn tone="plain" onClick={() => act.run(b.id, "plan")} busy={act.busy}>Susun ulang rencana</Btn>}
              </div>

              {b.log.length > 0 && (
                <div className="rounded-lg bg-black/5 dark:bg-white/5 p-2 max-h-40 overflow-y-auto space-y-0.5">
                  {b.log.map((l, i) => (
                    <div key={i} className={`text-[10px] font-mono whitespace-pre-wrap break-words ${l.ok ? "text-ink-2" : "text-rose-500"}`}>
                      {l.ok ? "✓" : "✗"} {l.step}: {l.detail}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      ))}
    </div>
  );
};
