import React, { useCallback, useEffect, useRef, useState } from "react";
import { Download, File as FileIcon, FileSpreadsheet, FileText, Image as ImageIcon, Inbox, Send, Trash2, UploadCloud } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { OfflineNotice } from "./WidgetBits";
import { ChatBridge } from "./ChatWidget";

interface ShelfFile {
  id: number;
  name: string;
  type: "document" | "dataset" | "image" | "other" | string;
  size: number;
  exists: boolean;
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const urlOf = (id: number) => `${window.location.origin}/api/v1/shelf/files/${id}/download`;

const iconFor = (t: string) =>
  t === "dataset" ? <FileSpreadsheet className="w-4 h-4 text-emerald-500" /> : t === "image" ? <ImageIcon className="w-4 h-4 text-sky-500" /> : t === "document" ? <FileText className="w-4 h-4 text-amber-500" /> : <FileIcon className="w-4 h-4 text-ink-2" />;

/** The tray state lives in the backend (real files in ~/.karsa/uploads/shelf); this hook only mirrors it. */
export function useShelf() {
  const [files, setFiles] = useState<ShelfFile[]>([]);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/shelf/files");
      if (!r.ok) throw new Error();
      setFiles((await r.json()).files ?? []);
      setOffline(false);
    } catch (_) {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh]);

  const upload = useCallback(
    async (list: FileList | File[]) => {
      setBusy(true);
      setNote(null);
      for (const f of Array.from(list)) {
        try {
          const fd = new FormData();
          fd.append("file", f);
          const r = await fetch("/api/v1/shelf/upload", { method: "POST", body: fd });
          if (!r.ok) setNote((await r.json().catch(() => ({}))).detail ?? `Gagal menyimpan ${f.name}`);
        } catch (_) {
          setNote("Server tidak terjangkau.");
        }
      }
      setBusy(false);
      refresh();
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: number) => {
      setFiles((fs) => fs.filter((f) => f.id !== id));
      try {
        await fetch(`/api/v1/shelf/files/${id}`, { method: "DELETE" });
      } catch (_) {}
      refresh();
    },
    [refresh]
  );

  return { files, offline, busy, note, setNote, refresh, upload, remove };
}

/** Hands a shelf file to the AI agent: the backend extracts readable text (a compact profile for datasets). */
async function sendToAi(f: ShelfFile, chat: ChatBridge, setNote: (s: string | null) => void) {
  try {
    const r = await fetch(`/api/v1/shelf/files/${f.id}/text`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      setNote(d.detail ?? "File ini tidak bisa dibaca AI.");
      return;
    }
    const what = d.kind === "dataset" ? "profil dataset" : "isi file";
    chat.onSend(`Tolong bantu analisis file "${d.name}". Ini ${what}${d.truncated ? " (dipotong)" : ""}:\n\n${d.text}`);
    setNote(null);
  } catch (_) {
    setNote("Server tidak terjangkau.");
  }
}

const Row: React.FC<{ f: ShelfFile; chat: ChatBridge; shelf: ReturnType<typeof useShelf>; compact?: boolean }> = ({ f, chat, shelf, compact }) => (
  <div
    draggable
    onDragStart={(e) => {
      // drag the file out to another app (Word, WhatsApp, browser, Explorer): Chromium/WebView2 turn DownloadURL into a file
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("DownloadURL", `application/octet-stream:${f.name}:${urlOf(f.id)}`);
      e.dataTransfer.setData("text/uri-list", urlOf(f.id));
    }}
    className="group flex items-center gap-2 px-2 h-9 rounded-xl bg-pill hover:brightness-110 cursor-grab active:cursor-grabbing"
    title="Tarik keluar untuk mengirim ke aplikasi lain"
  >
    <span className="flex-shrink-0">{iconFor(f.type)}</span>
    <div className="min-w-0 flex-1">
      <div className="text-[11.5px] font-medium text-ink truncate">{f.name}</div>
      {!compact && <div className="text-[9.5px] text-ink-muted">{fmtSize(f.size)}{f.exists ? "" : " · hilang dari disk"}</div>}
    </div>
    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
      {(f.type === "document" || f.type === "dataset") && (
        <button type="button" onClick={() => sendToAi(f, chat, shelf.setNote)} className="w-6 h-6 rounded-full flex items-center justify-center text-ink-2 hover:text-white hover:bg-accent cursor-pointer" title="Kirim ke Karsa AI" aria-label={`Kirim ${f.name} ke Karsa AI`}>
          <Send className="w-3 h-3" />
        </button>
      )}
      <a href={urlOf(f.id)} download={f.name} className="w-6 h-6 rounded-full flex items-center justify-center text-ink-2 hover:text-ink hover:bg-glass cursor-pointer" title="Simpan" aria-label={`Simpan ${f.name}`}>
        <Download className="w-3 h-3" />
      </a>
      <button type="button" onClick={() => shelf.remove(f.id)} className="w-6 h-6 rounded-full flex items-center justify-center text-ink-2 hover:text-white hover:bg-rose-500 cursor-pointer" title="Hapus dari laci" aria-label={`Hapus ${f.name}`}>
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  </div>
);

export const ShelfBody: React.FC<{ size: WidgetSize; chat: ChatBridge }> = ({ size, chat }) => {
  const shelf = useShelf();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes("Files")) {
        e.preventDefault();
        setOver(true);
      }
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files?.length) return;
      e.preventDefault();
      e.stopPropagation();
      setOver(false);
      shelf.upload(e.dataTransfer.files);
    },
  };
  const picker = <input ref={input} type="file" multiple className="hidden" onChange={(e) => e.target.files && shelf.upload(e.target.files)} />;

  if (shelf.offline) return <OfflineNotice onRetry={shelf.refresh} compact={size === "S"} />;

  if (size === "S") {
    return (
      <div {...dropProps} className={`w-full flex items-center gap-2 text-[11.5px] ${over ? "text-accent" : "text-ink"}`}>
        {picker}
        <Inbox className="w-4 h-4 flex-shrink-0" />
        <button type="button" onClick={() => input.current?.click()} className="truncate font-medium cursor-pointer">
          {shelf.files.length ? `${shelf.files.length} file di laci` : "Jatuhkan file"}
        </button>
      </div>
    );
  }

  const shown = size === "M" ? shelf.files.slice(0, 3) : shelf.files;
  return (
    <div {...dropProps} className="h-full flex flex-col gap-2 min-h-0">
      {picker}
      <button
        type="button"
        onClick={() => input.current?.click()}
        className={`flex-shrink-0 flex items-center justify-center gap-2 rounded-xl border border-dashed text-[11px] cursor-pointer transition-colors ${size === "M" ? "h-9" : "h-14"} ${
          over ? "border-accent bg-accent/10 text-accent" : "border-subtle text-ink-2 hover:text-ink"
        }`}
      >
        <UploadCloud className="w-4 h-4" />
        {shelf.busy ? "Menyimpan…" : over ? "Lepas di sini" : "Jatuhkan file di sini atau klik"}
      </button>
      {shelf.note && (
        <div className="text-[10.5px] text-rose-500 flex-shrink-0" role="alert">
          {shelf.note}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-1.5">
        {shown.length === 0 ? (
          <div className="h-full flex items-center justify-center text-center gap-1.5 text-ink-muted">
            <Inbox className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="text-[10.5px] truncate">{size === "M" ? "Laci kosong · tarik file keluar ke aplikasi lain" : "Laci kosong. Simpan file sementara, lalu tarik keluar ke aplikasi lain atau kirim ke Karsa."}</span>
          </div>
        ) : (
          shown.map((f) => <Row key={f.id} f={f} chat={chat} shelf={shelf} compact={size === "M"} />)
        )}
        {size === "M" && shelf.files.length > 3 && <div className="text-[10px] text-ink-muted text-center">+{shelf.files.length - 3} lagi (pilih ukuran L)</div>}
      </div>
    </div>
  );
};
