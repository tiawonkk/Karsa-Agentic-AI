import React, { useEffect, useState } from "react";
import { Code2, FolderOpen, FolderPlus, Loader2 } from "lucide-react";
import { projectFolder, useProjectFolder } from "../../stores/projectFolder";

/**
 * Active project folder: where the agent builds apps and saves cleaned datasets and papers.
 * Pick it with the native Windows dialog, type/paste a path, or create a new sub-folder.
 */
export const FolderBar: React.FC<{ compact?: boolean; hint?: string }> = ({ compact = false, hint }) => {
  const f = useProjectFolder();
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  useEffect(() => setText(f.path ?? ""), [f.path]);

  const commit = () => {
    const v = text.trim();
    if (v && v !== f.path) projectFolder.setPath(v);
  };
  const btn = "h-7 px-2.5 rounded-full text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer active:scale-95 disabled:opacity-50 whitespace-nowrap";

  return (
    <div className="karsa-nested p-2.5 space-y-2" data-hit>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        <FolderOpen className="w-3 h-3" /> Lokasi Folder Project
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        placeholder="D:\KarsaProjects\AplikasiBaru  (ketik/tempel, atau pilih)"
        aria-label="Folder project aktif"
        className="w-full h-8 px-2.5 rounded-lg bg-pill text-ink placeholder:text-ink-muted text-[11.5px] font-mono outline-none border border-transparent focus:border-accent"
      />
      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={`${btn} karsa-grad`} onClick={() => projectFolder.pick()} disabled={f.busy}>
          {f.busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderOpen className="w-3 h-3" />} Pilih Folder...
        </button>
        <button type="button" className={`${btn} bg-pill text-ink`} onClick={() => setCreating((v) => !v)} disabled={!f.path} title={f.path ? "Buat sub-folder baru di folder aktif" : "Pilih folder induk dulu"}>
          <FolderPlus className="w-3 h-3" /> Buat Folder Baru
        </button>
        {!compact && (
          <>
            <button type="button" className={`${btn} bg-pill text-ink`} onClick={() => projectFolder.open("explorer")} disabled={!f.path}>
              <FolderOpen className="w-3 h-3" /> Buka di File Explorer
            </button>
            <button type="button" className={`${btn} bg-pill text-ink`} onClick={() => projectFolder.open("vscode")} disabled={!f.path}>
              <Code2 className="w-3 h-3" /> Buka di VS Code
            </button>
          </>
        )}
      </div>
      {creating && (
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim()) return;
            projectFolder.create(name.trim()).then(() => {
              setName("");
              setCreating(false);
            });
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama folder baru" autoFocus className="flex-1 min-w-0 h-7 px-2.5 rounded-lg bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent" />
          <button type="submit" disabled={!name.trim() || f.busy} className={`${btn} karsa-grad`}>
            Buat
          </button>
        </form>
      )}
      {f.error && (
        <div role="alert" className="text-[11px] text-rose-500 whitespace-pre-wrap">
          {f.error}
        </div>
      )}
      {!f.path && !f.error && <div className="text-[10.5px] text-ink-muted leading-snug">{hint ?? "Belum ada folder. Hasil kerja agen disimpan di sini begitu kamu memilihnya."}</div>}
    </div>
  );
};
