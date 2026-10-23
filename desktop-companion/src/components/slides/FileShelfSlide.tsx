import React, { useState, useEffect } from "react";
import { Inbox, ChevronLeft, ChevronRight, FileText, Trash2, Sparkles } from "lucide-react";

interface ShelfFile {
  id: number;
  file_path: string;
  file_name: string;
  file_type?: string;
  file_size_bytes?: number;
}

interface FileShelfSlideProps {
  isDark: boolean;
  onTriggerAction: (prompt: string) => void;
}

export const FileShelfSlide: React.FC<FileShelfSlideProps> = ({ isDark, onTriggerAction }) => {
  const [shelfFiles, setShelfFiles] = useState<ShelfFile[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const fetchShelf = async () => {
    try {
      const res = await fetch("/api/v1/shelf/files?limit=10");
      if (res.ok) {
        const data = await res.json();
        setShelfFiles(data.files || []);
      }
    } catch (_) {}
  };

  useEffect(() => {
    fetchShelf();
  }, []);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      try {
        await fetch("/api/v1/shelf/files", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            file_name: file.name,
            file_path: file.name,
            file_type: file.type || "application/octet-stream",
          }),
        });
        fetchShelf();
      } catch (_) {}
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/v1/shelf/files/${id}`, { method: "DELETE" });
      setShelfFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (_) {}
  };

  return (
    <div className="w-full flex items-center justify-between gap-3 select-none px-1 py-0.5">
      {/* Left Chevron */}
      <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer transition-colors flex-shrink-0">
        <ChevronLeft className="w-3.5 h-3.5" />
      </div>

      {/* Center: Large Dashed Drop Box (Reference Image 5) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
        className={`flex-1 h-[88px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center px-4 transition-all relative overflow-hidden ${
          isDragOver
            ? "border-sky-400 bg-sky-950/20 scale-[1.01]"
            : "border-white/15 bg-white/[0.02] hover:border-white/30"
        }`}
      >
        {shelfFiles.length > 0 ? (
          <div className="w-full max-h-[78px] overflow-y-auto space-y-1">
            {shelfFiles.map((f) => (
              <div
                key={f.id}
                className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-white/5 border border-white/5 text-xs text-zinc-200"
              >
                <div className="flex items-center gap-1.5 truncate flex-1">
                  <FileText className="w-3.5 h-3.5 text-sky-400 flex-shrink-0" />
                  <span className="truncate">{f.file_name}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => onTriggerAction(`@Study rangkum dokumen ${f.file_name}`)}
                    className="p-1 text-sky-400 hover:text-sky-300"
                    title="Rangkum Dokumen"
                  >
                    <Sparkles className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(f.id)}
                    className="p-1 text-zinc-500 hover:text-rose-400"
                    title="Hapus"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* Tray Icon */}
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center mb-1 text-zinc-300">
              <Inbox className="w-4 h-4" />
            </div>

            <div className="text-xs font-semibold text-white tracking-tight">
              Drop files here
            </div>
            <div className="text-[10px] text-zinc-400 mt-0.5">
              Drag out anytime • click to open
            </div>
          </>
        )}
      </div>

      {/* Right Chevron */}
      <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer transition-colors flex-shrink-0">
        <ChevronRight className="w-3.5 h-3.5" />
      </div>
    </div>
  );
};

export default FileShelfSlide;
