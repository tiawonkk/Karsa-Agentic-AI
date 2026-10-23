import React, { useEffect, useRef } from "react";
import {
  Banknote,
  CheckSquare,
  BookOpen,
  GraduationCap,
  Search,
  PenTool,
  BarChart3,
  Code2,
  Monitor,
} from "lucide-react";

export interface DirectiveItem {
  id: string;
  command: string;
  label: string;
  example: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor: string;
}

export const DIRECTIVE_LIST: DirectiveItem[] = [
  {
    id: "money",
    command: "@Money",
    label: "Financial Intelligence",
    example: "@Money -25k makan siang",
    description: "Catat pengeluaran, pemasukan, modal, atau lihat laporan safe spend",
    icon: Banknote,
    accentColor: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
  },
  {
    id: "todo",
    command: "@Todo",
    label: "Eisenhower Matrix Tasks",
    example: "@Todo laprak jumat 17:00",
    description: "Simpan tugas & deadline otomatis ke matriks prioritas mahasiswa",
    icon: CheckSquare,
    accentColor: "text-amber-500 bg-amber-500/10 border-amber-500/20",
  },
  {
    id: "study",
    command: "@Study",
    label: "Document Summarizer",
    example: "@Study [materi_kuliah.pdf]",
    description: "Rangkum dokumen kuliah (.pdf/.docx) jadi ringkasan & konsep kunci",
    icon: BookOpen,
    accentColor: "text-blue-500 bg-blue-500/10 border-blue-500/20",
  },
  {
    id: "course",
    command: "@Course",
    label: "Skill & Learning Roadmap",
    example: "@Course belajar data cleaning",
    description: "Buat roadmap 4 minggu & temukan kursus gratis berkualitas",
    icon: GraduationCap,
    accentColor: "text-cyan-500 bg-cyan-500/10 border-cyan-500/20",
  },
  {
    id: "search",
    command: "@Search",
    label: "Academic Research & Web",
    example: "@Search paper agentic workflow",
    description: "Cari paper ilmiah di arXiv/Semantic Scholar & sumber belajar",
    icon: Search,
    accentColor: "text-violet-500 bg-violet-500/10 border-violet-500/20",
  },
  {
    id: "write",
    command: "@Write",
    label: "Scientific IMRaD & Word",
    example: "@Write bab metodologi ke Skripsi.docx",
    description: "Susun naskah ilmiah standar IMRaD & ekspor ke Microsoft Word",
    icon: PenTool,
    accentColor: "text-rose-500 bg-rose-500/10 border-rose-500/20",
  },
  {
    id: "data",
    command: "@Data",
    label: "Pandas Data Science",
    example: "@Data analisis sales_2026.csv",
    description: "Profiling dataset lokal tanpa bocor token ke LLM",
    icon: BarChart3,
    accentColor: "text-orange-500 bg-orange-500/10 border-orange-500/20",
  },
  {
    id: "code",
    command: "@Code",
    label: "Coding & Terminal Sandbox",
    example: "@Code perbaiki bug sorting ini",
    description: "Jalankan testing lokal & asistensi kode proyek",
    icon: Code2,
    accentColor: "text-indigo-500 bg-indigo-500/10 border-indigo-500/20",
  },
  {
    id: "screen",
    command: "@Screen",
    label: "Active Screen Reader",
    example: "@Screen jelaskan bagian ini",
    description: "Baca jendela laptop aktif secara privat untuk panduan instan",
    icon: Monitor,
    accentColor: "text-pink-500 bg-pink-500/10 border-pink-500/20",
  },
];

interface CommandAutocompleteProps {
  filter: string;
  selectedIndex: number;
  onSelect: (item: DirectiveItem) => void;
  onClose: () => void;
  isDark?: boolean;
}

export const CommandAutocomplete: React.FC<CommandAutocompleteProps> = ({
  filter,
  selectedIndex,
  onSelect,
  isDark = true,
}) => {
  const listRef = useRef<HTMLDivElement>(null);

  const cleanFilter = filter.startsWith("@") ? filter.slice(1).toLowerCase() : filter.toLowerCase();

  const filteredItems = DIRECTIVE_LIST.filter(
    (item) =>
      item.command.toLowerCase().includes(cleanFilter) ||
      item.id.includes(cleanFilter) ||
      item.label.toLowerCase().includes(cleanFilter)
  );

  useEffect(() => {
    if (listRef.current && selectedIndex >= 0) {
      const activeElement = listRef.current.children[selectedIndex] as HTMLElement;
      if (activeElement) {
        activeElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [selectedIndex]);

  if (filteredItems.length === 0) return null;

  return (
    <div
      ref={listRef}
      className={`absolute top-full mt-2 left-0 right-0 max-h-60 overflow-y-auto rounded-2xl p-1.5 shadow-2xl backdrop-blur-xl border transition-all z-50 ${
        isDark
          ? "bg-[#18181B]/95 border-white/10 text-zinc-200"
          : "bg-white/95 border-zinc-200/80 text-zinc-800"
      }`}
      style={{
        boxShadow: isDark
          ? "0 12px 36px rgba(0,0,0,0.45), 0 2px 6px rgba(0,0,0,0.3)"
          : "0 12px 36px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
      }}
    >
      <div className="px-3 py-1.5 text-[10px] font-semibold tracking-wider uppercase text-zinc-400 flex items-center justify-between border-b border-white/5 mb-1">
        <span>Direktif Cepat (@Command)</span>
        <span className="text-[9px] lowercase font-normal opacity-70">↑↓ navigasi • Enter pilih</span>
      </div>

      <div className="space-y-0.5">
        {filteredItems.map((item, idx) => {
          const Icon = item.icon;
          const isSelected = idx === selectedIndex;

          return (
            <button
              key={item.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                onSelect(item);
              }}
              className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-2.5 transition-all cursor-pointer ${
                isSelected
                  ? isDark
                    ? "bg-white/10 text-white shadow-sm"
                    : "bg-zinc-100 text-zinc-900 shadow-sm"
                  : isDark
                  ? "hover:bg-white/5 text-zinc-300"
                  : "hover:bg-zinc-50 text-zinc-700"
              }`}
            >
              <div className={`p-1.5 rounded-lg border flex-shrink-0 ${item.accentColor}`}>
                <Icon className="w-3.5 h-3.5" />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-bold text-xs tracking-tight text-white dark:text-white">
                    {item.command}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-medium truncate">
                    {item.label}
                  </span>
                </div>
                <div className="text-[10px] text-zinc-400/80 truncate mt-0.5">
                  {item.example}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
