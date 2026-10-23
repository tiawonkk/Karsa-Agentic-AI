import React, { useState, useEffect, useRef } from "react";
import { Send, Search, Terminal, AppWindow } from "lucide-react";
import { MascotCanvas } from "../MascotCanvas";
import { CommandAutocomplete, DIRECTIVE_LIST, DirectiveItem } from "../CommandAutocomplete";

interface MascotSlideProps {
  isDark: boolean;
  mascotColor: string;
  eyeColor: string;
  isSleeping: boolean;
  isDraggingFile: boolean;
  activeAccessory: string | null;
  hoverTarget: "settings" | "add" | "chat" | null;
  emoteContext: "money" | "search" | "screen" | "code" | "success" | null;
  onDropFiles: (files: FileList) => void;
  onSubmitMessage: (msg: string) => void;
  isStreaming: boolean;
}

interface AppItem {
  name: string;
  path: string;
  type: string;
}

export const MascotSlide: React.FC<MascotSlideProps> = ({
  isDark,
  mascotColor,
  eyeColor,
  isSleeping,
  isDraggingFile,
  activeAccessory,
  hoverTarget,
  emoteContext,
  onDropFiles,
  onSubmitMessage,
  isStreaming,
}) => {
  const [query, setQuery] = useState("");
  const [matchedApps, setMatchedApps] = useState<AppItem[]>([]);
  const [isSearchingApps, setIsSearchingApps] = useState(false);
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Search apps when query does not start with @
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
        }
      } catch (e) {
        // silent fail
      } finally {
        setIsSearchingApps(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [query]);

  // Handle Input Change
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

  const handleLaunchApp = async (app: AppItem) => {
    try {
      await fetch("/api/v1/system/apps/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: app.path }),
      });
      setQuery("");
      setMatchedApps([]);
    } catch (e) {
      console.error(e);
    }
  };

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

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (matchedApps.length > 0 && !query.startsWith("@")) {
        handleLaunchApp(matchedApps[0]);
      } else {
        onSubmitMessage(query);
        setQuery("");
      }
    }
  };

  return (
    <div className="flex flex-col space-y-2.5">
      {/* Center Canvas Stage (Mascot + 2 Cute Floating Hands) */}
      <div
        className={`w-full h-[96px] rounded-2xl flex items-center justify-center relative overflow-hidden transition-colors ${
          isDark
            ? "bg-[#09090b]/80 border border-white/5"
            : "bg-gradient-to-b from-orange-50/40 to-transparent border border-zinc-200/50"
        }`}
      >
        <MascotCanvas
          size={46}
          bodyColor={mascotColor}
          eyeColor={eyeColor}
          isSleeping={isSleeping}
          isDraggingOver={isDraggingFile}
          accessoryImage={activeAccessory}
          showStarOrbit={isDark}
          hoverTarget={hoverTarget}
          emoteContext={emoteContext}
          onDropFile={onDropFiles}
          isDark={isDark}
        />
      </div>

      {/* Omni-Bar with Directive Autocomplete & Windows App Launcher */}
      <div className="relative">
        {isAutocompleteOpen && (
          <CommandAutocomplete
            filter={autocompleteFilter}
            selectedIndex={autocompleteIndex}
            onSelect={(item) => {
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

        {/* Windows Apps Dropdown */}
        {matchedApps.length > 0 && !isAutocompleteOpen && (
          <div
            className={`absolute bottom-full mb-1.5 left-0 right-0 max-h-48 overflow-y-auto rounded-xl border shadow-xl p-1.5 z-40 ${
              isDark
                ? "bg-[#141416] border-white/10 text-zinc-200"
                : "bg-white border-zinc-200 text-zinc-800"
            }`}
          >
            <div className="px-2 py-1 text-[10px] font-mono text-zinc-500 uppercase tracking-wider flex items-center justify-between">
              <span>Aplikasi Windows</span>
              <span>Enter untuk buka</span>
            </div>
            {matchedApps.map((app, idx) => (
              <button
                key={app.path}
                type="button"
                onClick={() => handleLaunchApp(app)}
                className={`w-full px-2.5 py-1.5 rounded-lg flex items-center justify-between text-left text-xs transition-colors cursor-pointer ${
                  idx === 0
                    ? isDark
                      ? "bg-orange-500/20 text-orange-300 font-medium"
                      : "bg-orange-100 text-orange-900 font-medium"
                    : isDark
                    ? "hover:bg-white/5"
                    : "hover:bg-zinc-100"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  <AppWindow className="w-3.5 h-3.5 opacity-60 flex-shrink-0" />
                  <span className="truncate">{app.name}</span>
                </div>
                <span className="text-[10px] opacity-40 font-mono truncate max-w-[100px]">
                  {app.type}
                </span>
              </button>
            ))}
          </div>
        )}

        <div
          className={`flex items-center gap-2 px-3.5 py-2 rounded-2xl border transition-all ${
            isDark
              ? "bg-black/40 border-white/10 focus-within:border-orange-500/50"
              : "bg-white border-zinc-200 focus-within:border-orange-500/50 shadow-sm"
          }`}
        >
          <Search className="w-3.5 h-3.5 opacity-40 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Ketik direktif (@Money, @Todo, @Study) atau cari aplikasi..."
            className={`w-full text-xs outline-none bg-transparent ${
              isDark ? "text-zinc-100 placeholder-zinc-500" : "text-zinc-900 placeholder-zinc-400"
            }`}
          />
          <button
            type="button"
            onClick={() => {
              if (matchedApps.length > 0 && !query.startsWith("@")) {
                handleLaunchApp(matchedApps[0]);
              } else {
                onSubmitMessage(query);
                setQuery("");
              }
            }}
            disabled={!query.trim() || isStreaming}
            className={`p-1.5 rounded-xl transition-all cursor-pointer flex-shrink-0 ${
              query.trim() && !isStreaming
                ? "bg-orange-600 text-white hover:bg-orange-500 shadow-md"
                : "text-zinc-500 opacity-40 cursor-not-allowed"
            }`}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default MascotSlide;
