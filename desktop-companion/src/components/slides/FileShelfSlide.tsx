import React, { useState, useEffect } from "react";
import {
  FolderArchive,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  Trash2,
  ExternalLink,
  Sparkles,
  UploadCloud,
} from "lucide-react";

interface ShelfFile {
  id: number;
  file_path: string;
  file_name: string;
  file_type?: string;
  file_size_bytes?: number;
  created_at: string;
}

interface FileShelfSlideProps {
  isDark: boolean;
  onTriggerAction: (prompt: string) => void;
}

export const FileShelfSlide: React.FC<FileShelfSlideProps> = ({ isDark, onTriggerAction }) => {
  const [shelfFiles, setShelfFiles] = useState<ShelfFile[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchShelf = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/v1/shelf/files?limit=15");
      if (res.ok) {
        const data = await res.json();
        setShelfFiles(data.files || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchShelf();
  }, []);

  const handleDelete = async (id: number) => {
    try {
      const res = await fetch(`/api/v1/shelf/files/${id}`, { method: "DELETE" });
      if (res.ok) {
        setShelfFiles((prev) => prev.filter((f) => f.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  const getFileIcon = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase();
    if (ext === "pdf" || ext === "docx") return <FileText className="w-4 h-4 text-rose-400" />;
    if (ext === "csv" || ext === "xlsx") return <FileSpreadsheet className="w-4 h-4 text-emerald-400" />;
    if (ext === "py" || ext === "js" || ext === "ts" || ext === "json")
      return <FileCode className="w-4 h-4 text-indigo-400" />;
    if (["png", "jpg", "jpeg", "webp"].includes(ext || ""))
      return <ImageIcon className="w-4 h-4 text-purple-400" />;
    return <FileText className="w-4 h-4 text-amber-400" />;
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  return (
    <div
      className={`w-full rounded-2xl p-3.5 transition-colors flex flex-col justify-between ${
        isDark ? "bg-[#0c0c0e] border border-white/8" : "bg-white border border-zinc-200 shadow-sm"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between text-xs mb-2">
        <div className="flex items-center gap-1.5 font-semibold text-amber-400">
          <FolderArchive className="w-4 h-4" />
          <span>File Drop Shelf (Desktop Dock)</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-400">
          {shelfFiles.length} file di rak
        </span>
      </div>

      {/* Files Grid / List */}
      <div className="max-h-[105px] overflow-y-auto space-y-1.5 pr-1">
        {shelfFiles.length === 0 ? (
          <div className="h-20 border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center text-zinc-500 text-xs">
            <UploadCloud className="w-5 h-5 mb-1 opacity-50" />
            <span>Tarik & lempar file tugas ke sini</span>
          </div>
        ) : (
          shelfFiles.map((file) => (
            <div
              key={file.id}
              className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-all ${
                isDark
                  ? "bg-white/[0.03] border-white/5 hover:border-white/15"
                  : "bg-zinc-50 border-zinc-200 hover:border-zinc-300"
              }`}
            >
              <div className="flex items-center gap-2 truncate flex-1">
                {getFileIcon(file.file_name)}
                <div className="truncate">
                  <div className="text-xs font-medium truncate text-zinc-200">
                    {file.file_name}
                  </div>
                  <div className="text-[9px] font-mono text-zinc-500">
                    {formatBytes(file.file_size_bytes)} • {file.created_at.slice(11, 16)}
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => onTriggerAction(`@Study rangkum dokumen ${file.file_name}`)}
                  className="px-2 py-1 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 text-orange-400 text-[10px] font-semibold transition-colors flex items-center gap-1 cursor-pointer"
                  title="Rangkum Dokumen"
                >
                  <Sparkles className="w-2.5 h-2.5" />
                  <span>Rangkum</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(file.id)}
                  className="p-1 rounded-lg text-zinc-400 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Hapus dari Rak"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default FileShelfSlide;
