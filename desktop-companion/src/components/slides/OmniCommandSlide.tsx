import React, { useState, useEffect, useRef } from "react";
import {
  Search,
  Send,
  AppWindow,
  ScanSearch,
  Sparkles,
  Banknote,
  CheckSquare,
  BookOpen,
  GraduationCap,
  PenTool,
  BarChart3,
  Code2,
  Monitor,
  Check,
} from "lucide-react";
import { CommandAutocomplete, DIRECTIVE_LIST, DirectiveItem } from "../CommandAutocomplete";

interface AppItem {
  name: string;
  path: string;
  type: string;
}

interface OmniCommandSlideProps {
  isDark: boolean;
  onSubmitMessage: (msg: string) => void;
  focusTrigger?: number;
}

export const OmniCommandSlide: React.FC<OmniCommandSlideProps> = ({
  isDark,
  onSubmitMessage,
  focusTrigger,
}) => {
  const [query, setQuery] = useState("");
  const [matchedApps, setMatchedApps] = useState<AppItem[]>([]);
  const [selectedAppIndex, setSelectedAppIndex] = useState(0);
  const [isSearchingApps, setIsSearchingApps] = useState(false);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [launchFeedback, setLaunchFeedback] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus when focusTrigger changes (e.g. Alt + Space pressed)
  useEffect(() => {
    inputRef.current?.focus();
  }, [focusTrigger]);

  // Query Windows Apps when not typing @ directive
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.startsWith("@")) {
      setMatchedApps([]);
      setIsSearchingApps(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearchingApps(true);
        const res = await fetch(`/api/v1/system/apps?q=${encodeURIComponent(trimmed)}`);
        if (res.ok) {
          const data = await res.json();
          setMatchedApps(data.apps || []);
          setSelectedAppIndex(0);
        }
      } catch (e) {
        // silent fail
      } finally {
        setIsSearchingApps(false);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [query]);

  // Handle Input Changes & @ Detection
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    const lastAtIdx = val.lastIndexOf("@");
    if (lastAtIdx !== -1) {
      const q = val.slice(lastAtIdx);
      if (!q.includes(" ")) {
        setIsAutocompleteOpen(true);
        setAutocompleteFilter(q);
        setAutocompleteIndex(0);
        return;
      }
    }
    setIsAutocompleteOpen(false);
  };

  // Launch Windows Application
  const handleLaunchApp = async (app: AppItem) => {
    try {
      setLaunchFeedback(`🚀 Membuka ${app.name}...`);
      await fetch("/api/v1/system/apps/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: app.path }),
      });
      setTimeout(() => {
        setLaunchFeedback(null);
        setQuery("");
        setMatchedApps([]);
      }, 1500);
    } catch (e) {
      setLaunchFeedback(`❌ Gagal membuka ${app.name}`);
      setTimeout(() => setLaunchFeedback(null), 2000);
    }
  };

  // Scan inline code comments (# @Directive)
  const handleScanCodeComments = async () => {
    try {
      setScanResult("Memindai komentar # @... di kode...");
      const res = await fetch("/api/v1/directives/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_path: "." }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.count > 0) {
          const first = data.findings[0];
          setQuery(`${first.directive} ${first.argument || ""}`.trim());
          setScanResult(`Ditemukan ${data.count} direktif di kode (${first.file})`);
        } else {
          setScanResult("Tidak ada komentar direktif baru di file kerja.");
        }
      }
    } catch (e) {
      setScanResult("Gagal memindai direktif.");
    } finally {
      setTimeout(() => setScanResult(null), 3000);
    }
  };

  // Key navigation (Enter to launch app or execute directive, Arrows for selection)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isAutocompleteOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((prev) => prev + 1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const cleanFilter = autocompleteFilter.replace("@", "").toLowerCase();
        const filtered = DIRECTIVE_LIST.filter(
          (d) =>
            d.command.toLowerCase().includes(cleanFilter) ||
            d.id.includes(cleanFilter) ||
            d.label.toLowerCase().includes(cleanFilter)
        );
        if (filtered.length > 0) {
          const selected = filtered[autocompleteIndex % filtered.length];
          const lastAtIdx = query.lastIndexOf("@");
          const prefix = lastAtIdx !== -1 ? query.slice(0, lastAtIdx) : "";
          setQuery(`${prefix}${selected.command} `);
          setIsAutocompleteOpen(false);
        }
        return;
      }
      if (e.key === "Escape") {
        setIsAutocompleteOpen(false);
        return;
      }
    }

    // App Navigation
    if (matchedApps.length > 0 && !query.startsWith("@")) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedAppIndex((prev) => (prev + 1) % matchedApps.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedAppIndex((prev) => (prev - 1 + matchedApps.length) % matchedApps.length);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (matchedApps.length > 0 && !query.startsWith("@")) {
        handleLaunchApp(matchedApps[selectedAppIndex] || matchedApps[0]);
      } else if (query.trim()) {
        onSubmitMessage(query);
        setQuery("");
      }
    }
  };

  const handleSelectDirective = (cmd: string) => {
    setQuery(`${cmd} `);
    inputRef.current?.focus();
  };

  return (
    <div className="w-full flex flex-col justify-between select-none px-1 py-0.5 gap-2 relative">
      {/* 1. Main Search & Command Input Bar */}
      <div className="relative">
        {/* Autocomplete Popup */}
        {isAutocompleteOpen && (
          <CommandAutocomplete
            filter={autocompleteFilter}
            selectedIndex={autocompleteIndex}
            onSelect={(item: DirectiveItem) => {
              const lastAtIdx = query.lastIndexOf("@");
              const prefix = lastAtIdx !== -1 ? query.slice(0, lastAtIdx) : "";
              setQuery(`${prefix}${item.command} `);
              setIsAutocompleteOpen(false);
              inputRef.current?.focus();
            }}
            onClose={() => setIsAutocompleteOpen(false)}
            isDark={isDark}
          />
        )}

        {/* Input Container */}
        <div
          className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl border transition-all ${
            isDark
              ? "bg-white/[0.04] border-white/10 focus-within:border-orange-500/50"
              : "bg-white border-zinc-200 focus-within:border-orange-500/50 shadow-sm"
          }`}
        >
          <Search className="w-3.5 h-3.5 text-zinc-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ketik aplikasi (vscode, chrome...) atau direktif (@Money, @Todo)..."
            className="w-full text-xs outline-none bg-transparent text-white placeholder-zinc-500 font-sans"
          />
          {query.trim() && (
            <button
              type="button"
              onClick={() => {
                if (matchedApps.length > 0 && !query.startsWith("@")) {
                  handleLaunchApp(matchedApps[selectedAppIndex] || matchedApps[0]);
                } else if (query.trim()) {
                  onSubmitMessage(query);
                  setQuery("");
                }
              }}
              className="p-1 rounded-lg bg-orange-600 hover:bg-orange-500 text-white transition-all cursor-pointer flex-shrink-0"
              title="Kirim (Enter)"
            >
              <Send className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Middle Content Area: Matched Windows Apps OR Quick Directive Chips */}
      {matchedApps.length > 0 && !query.startsWith("@") ? (
        // Matched Apps List (Reference Image & Prompt 1)
        <div className="w-full max-h-[82px] overflow-y-auto space-y-1 pr-1">
          {matchedApps.slice(0, 4).map((app, idx) => {
            const isSelected = idx === selectedAppIndex;
            return (
              <div
                key={app.path}
                onClick={() => handleLaunchApp(app)}
                className={`px-2.5 py-1 rounded-xl flex items-center justify-between text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? "bg-orange-500/20 border border-orange-500/40 text-orange-200"
                    : "bg-white/[0.03] border border-white/5 text-zinc-300 hover:bg-white/10"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <AppWindow className="w-3.5 h-3.5 text-orange-400 flex-shrink-0" />
                  <span className="font-medium truncate">{app.name}</span>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0 text-[10px] font-mono text-zinc-400">
                  <span className="opacity-60">{app.type}</span>
                  <span className="px-1.5 py-0.2 bg-white/10 rounded text-[9px] text-zinc-300">
                    Enter
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Quick Directive Badges (Direct AI Actions)
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
            <span>Direktif Cepat (@Directive Agentic AI):</span>
            <button
              type="button"
              onClick={handleScanCodeComments}
              className="flex items-center gap-1 text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
              title="Pindai komentar # @... di kode"
            >
              <ScanSearch className="w-3 h-3" />
              <span>Scan # @...</span>
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              type="button"
              onClick={() => handleSelectDirective("@Money")}
              className="px-2 py-0.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Catat pengeluaran & cek safe spend"
            >
              <Banknote className="w-3 h-3" />
              <span>@Money</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirective("@Search")}
              className="px-2 py-0.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Cari paper ilmiah di arXiv/Semantic Scholar"
            >
              <Sparkles className="w-3 h-3" />
              <span>@Search</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirective("@Todo")}
              className="px-2 py-0.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Tambah tugas ke Eisenhower TodoList"
            >
              <CheckSquare className="w-3 h-3" />
              <span>@Todo</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirective("@Study")}
              className="px-2 py-0.5 rounded-lg bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-blue-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Rangkum dokumen materi kuliah"
            >
              <BookOpen className="w-3 h-3" />
              <span>@Study</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirective("@Write")}
              className="px-2 py-0.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Susun draf IMRaD & ekspor ke Word .docx"
            >
              <PenTool className="w-3 h-3" />
              <span>@Write</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirective("@Data")}
              className="px-2 py-0.5 rounded-lg bg-orange-500/15 hover:bg-orange-500/25 border border-orange-500/30 text-orange-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Profil dataset Pandas lokal tanpa bocor token"
            >
              <BarChart3 className="w-3 h-3" />
              <span>@Data</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirective("@Code")}
              className="px-2 py-0.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 text-indigo-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Testing & debugging kode di sandbox"
            >
              <Code2 className="w-3 h-3" />
              <span>@Code</span>
            </button>

            <button
              type="button"
              onClick={() => handleSelectDirective("@Screen")}
              className="px-2 py-0.5 rounded-lg bg-pink-500/15 hover:bg-pink-500/25 border border-pink-500/30 text-pink-300 text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer"
              title="Baca layar laptop aktif & jelaskan materi"
            >
              <Monitor className="w-3 h-3" />
              <span>@Screen</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Feedback Banner if launching or scanned */}
      {(launchFeedback || scanResult) && (
        <div className="text-[10px] font-mono text-orange-300 bg-orange-950/40 border border-orange-500/30 px-2 py-0.5 rounded-lg text-center animate-pulse">
          {launchFeedback || scanResult}
        </div>
      )}
    </div>
  );
};

export default OmniCommandSlide;
