import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  MessageSquare,
  Plus,
  SlidersHorizontal,
  Volume2,
  VolumeX,
  Send,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Maximize2,
  Sparkles,
} from "lucide-react";

import { MascotCanvas } from "./MascotCanvas";
import { WardrobeStudio } from "./WardrobeStudio";
import { CommandAutocomplete, DIRECTIVE_LIST, DirectiveItem } from "./CommandAutocomplete";
import { SettingsModal, ThemeMode, NotchSize } from "./SettingsModal";
import { FinanceReportDrawer } from "./FinanceReportDrawer";
import { TasksDrawer } from "./TasksDrawer";
import { ChatDrawer } from "./ChatDrawer";
import { HitlApprovalPill, PendingApprovalData } from "./HitlApprovalPill";
import { BezelWings } from "./BezelWings";
import { DynamicIslandDeck } from "./DynamicIslandDeck";
import { HardwareOsdPill } from "./HardwareOsdPill";
import { useDashboard, formatRupiah } from "../hooks/useDashboard";

type IslandMode = "PILL" | "COMPACT";
type ActivePopover = null | "REPORT" | "TASKS" | "CHAT" | "SETTINGS" | "WARDROBE";

const springTransition = {
  type: "spring" as const,
  stiffness: 400,
  damping: 32,
  mass: 0.8,
};

export const NotchIsland: React.FC = () => {
  // Mode state: Default to PILL (Mode 1: 34px x 170px)
  const [islandMode, setIslandMode] = useState<IslandMode>("COMPACT");
  const [isSleeping, setIsSleeping] = useState(false);
  const [activePopover, setActivePopover] = useState<ActivePopover>(null);

  // Appearance & Theme settings
  const [themeMode, setThemeMode] = useState<ThemeMode>(
    () => (localStorage.getItem("karsa_theme_mode") as ThemeMode) || "system"
  );
  const [systemIsDark, setSystemIsDark] = useState(() =>
    window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)").matches : true
  );
  const [notchSize, setNotchSize] = useState<NotchSize>(
    () => (localStorage.getItem("karsa_notch_size") as NotchSize) || "compact"
  );

  // Mascot customization
  const [mascotColor, setMascotColor] = useState(
    () => localStorage.getItem("karsa_mascot_color") || "#FAF9F6"
  );
  const [eyeColor, setEyeColor] = useState(
    () => localStorage.getItem("karsa_eye_color") || "#18181B"
  );
  const [activeAccessory, setActiveAccessory] = useState<string | null>(
    () => localStorage.getItem("karsa_active_accessory") || null
  );

  // Interactive Mascot tracking
  const [hoverTarget, setHoverTarget] = useState<"settings" | "add" | "chat" | null>(null);
  const [emoteContext, setEmoteContext] = useState<
    "money" | "search" | "screen" | "code" | "success" | null
  >(null);

  // File drag & drop
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  // Real-time Dashboard Summary (Safe Spend & Tasks from SQLite)
  const { data: dashboard, refresh: refreshDashboard } = useDashboard(isSleeping);

  // Input & Command Autocomplete
  const [inputMessage, setInputMessage] = useState("");
  const [isAutocompleteOpen, setIsAutocompleteOpen] = useState(false);
  const [autocompleteFilter, setAutocompleteFilter] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Chat conversation
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    {
      role: "assistant",
      text: "Halo! Aku Karsa. Ada yang bisa kubantu untuk tugas kuliah, catat jajan hari ini, atau riset paper?",
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [threadId] = useState<string>(() => `thread_${Date.now()}`);

  // HITL Approvals
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalData[]>([]);

  // Compute effective dark mode
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const isDark = useMemo(() => {
    if (themeMode === "light") return false;
    if (themeMode === "dark") return true;
    return systemIsDark;
  }, [themeMode, systemIsDark]);

  // Sync settings to localStorage
  useEffect(() => {
    localStorage.setItem("karsa_theme_mode", themeMode);
  }, [themeMode]);

  useEffect(() => {
    localStorage.setItem("karsa_notch_size", notchSize);
  }, [notchSize]);

  useEffect(() => {
    localStorage.setItem("karsa_mascot_color", mascotColor);
  }, [mascotColor]);

  useEffect(() => {
    localStorage.setItem("karsa_eye_color", eyeColor);
  }, [eyeColor]);

  useEffect(() => {
    if (activeAccessory) {
      localStorage.setItem("karsa_active_accessory", activeAccessory);
    } else {
      localStorage.removeItem("karsa_active_accessory");
    }
  }, [activeAccessory]);

  // Click-outside listener & Escape shortcut
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activePopover) {
          setActivePopover(null);
        } else if (islandMode === "COMPACT") {
          setIslandMode("PILL");
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !activePopover
      ) {
        if (islandMode === "COMPACT") {
          setIslandMode("PILL");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [islandMode, activePopover]);

  // Poll for pending HITL approvals
  useEffect(() => {
    let timer: NodeJS.Timeout;
    const fetchApprovals = async () => {
      try {
        const res = await fetch(`/api/v1/approvals/pending?thread_id=${threadId}`);
        if (res.ok) {
          const data = await res.json();
          setPendingApprovals(data.pending_approvals || []);
        }
      } catch (e) {
        // silent fail
      } finally {
        timer = setTimeout(fetchApprovals, 6000);
      }
    };
    fetchApprovals();
    return () => clearTimeout(timer);
  }, [threadId]);

  // Sleep mode toggle
  const toggleSleep = async () => {
    const next = !isSleeping;
    setIsSleeping(next);
    if (next) {
      try {
        await fetch("/api/v1/system/sleep", { method: "POST" });
      } catch (e) {}
    }
  };

  // Input change handler for `@` autocomplete
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputMessage(val);

    // Detect emote context dynamically
    const lower = val.toLowerCase();
    if (lower.startsWith("@money")) setEmoteContext("money");
    else if (lower.startsWith("@search")) setEmoteContext("search");
    else if (lower.startsWith("@screen")) setEmoteContext("screen");
    else if (lower.startsWith("@code") || lower.startsWith("@data")) setEmoteContext("code");
    else setEmoteContext(null);

    // Autocomplete detection
    const lastAtIdx = val.lastIndexOf("@");
    if (lastAtIdx !== -1) {
      const query = val.slice(lastAtIdx);
      if (!query.includes(" ")) {
        setIsAutocompleteOpen(true);
        setAutocompleteFilter(query);
        setAutocompleteIndex(0);
        return;
      }
    }
    setIsAutocompleteOpen(false);
  };

  const handleSelectDirective = (item: DirectiveItem) => {
    const lastAtIdx = inputMessage.lastIndexOf("@");
    const prefix = lastAtIdx !== -1 ? inputMessage.slice(0, lastAtIdx) : "";
    setInputMessage(`${prefix}${item.command} `);
    setIsAutocompleteOpen(false);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
          handleSelectDirective(selected);
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
      handleSubmit();
    }
  };

  // Submit message: Checks for deterministic directives first (0-token execution)
  const handleSubmit = async (customText?: string) => {
    const text = (customText || inputMessage).trim();
    if (!text || isStreaming) return;

    setInputMessage("");
    setIsAutocompleteOpen(false);

    // 1. Direct Directive Execution via /api/v1/directives/parse
    if (text.startsWith("@")) {
      try {
        const res = await fetch("/api/v1/directives/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (res.ok) {
          const parsed = await res.json();
          if (parsed.is_directive && parsed.execution_result) {
            setFeedbackToast(parsed.execution_result);
            setEmoteContext("success");
            setTimeout(() => {
              setFeedbackToast(null);
              setEmoteContext(null);
            }, 5500);

            // Add to chat history
            setChatHistory((prev) => [
              ...prev,
              { role: "user", text },
              { role: "assistant", text: parsed.execution_result },
            ]);

            refreshDashboard();
            return;
          }
        }
      } catch (e) {
        console.error(e);
      }
    }

    // 2. Fallback to Full SSE Chat Stream
    setChatHistory((prev) => [...prev, { role: "user", text }]);
    setIsStreaming(true);
    setActivePopover("CHAT");

    try {
      const response = await fetch("/api/v1/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, thread_id: threadId }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setChatHistory((prev) => [...prev, { role: "assistant", text: "" }]);

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.text) {
                assistantText += data.text;
                setChatHistory((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: "assistant", text: assistantText };
                  return updated;
                });
              }
            } catch (e) {}
          }
        }
      }
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "⚠️ Koneksi terputus ke backend. Pastikan server lokal aktif di port 8765.",
        },
      ]);
    } finally {
      setIsStreaming(false);
      refreshDashboard();
    }
  };

  // Screen Assist button handler
  const handleScreenAssist = async () => {
    handleSubmit("@Screen jelaskan bagian ini");
  };

  // Drag & drop file swallow
  const handleDropFiles = (files: FileList) => {
    if (files.length === 0) return;
    setIsDraggingFile(false);
    const file = files[0];
    const fileName = file.name.toLowerCase();

    if (fileName.endsWith(".csv") || fileName.endsWith(".xlsx")) {
      handleSubmit(`@Data analisis ${file.name}`);
    } else if (fileName.endsWith(".pdf") || fileName.endsWith(".docx")) {
      handleSubmit(`@Study rangkum dokumen ${file.name}`);
    } else if (file.type.startsWith("image/")) {
      handleSubmit(`@Money ekstrak struk ${file.name}`);
    } else {
      handleSubmit(`@Code periksa file ${file.name}`);
    }
  };

  // HITL decision
  const handleApprovalDecision = async (
    actionId: string,
    decision: "approve" | "edit" | "reject"
  ) => {
    try {
      await fetch(`/api/v1/threads/${threadId}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: actionId, decision }),
      });
      setPendingApprovals((prev) => prev.filter((a) => a.action_id !== actionId));
      refreshDashboard();
    } catch (err) {
      console.error(err);
    }
  };

  const islandWidth = notchSize === "compact" ? "max-w-[400px]" : "max-w-[440px]";

  return (
    <div
      ref={containerRef}
      className="fixed top-0 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center select-none font-sans"
      onDragEnter={() => setIsDraggingFile(true)}
      onDragLeave={() => setIsDraggingFile(false)}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) {
          handleDropFiles(e.dataTransfer.files);
        }
      }}
    >
      {/* Hardware OSD Pill Interceptor */}
      <HardwareOsdPill isDark={isDark} />

      {/* ========================================================================= */}
      {/* MODE 1: BEZEL NOTCH IDLE PILL - Menempel tipis di bezel atas dengan sayap cekung */}
      {/* ========================================================================= */}
      {islandMode === "PILL" && (
        <motion.div
          onClick={() => setIslandMode("COMPACT")}
          initial={{ y: -34, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -34, opacity: 0 }}
          transition={springTransition}
          className={`relative h-[34px] w-[clamp(190px,16vw,260px)] rounded-b-2xl border border-t-0 shadow-2xl px-3.5 flex items-center justify-between cursor-pointer transition-all ${
            isDark
              ? "bg-[#000000] border-white/10 text-zinc-200 hover:bg-[#0c0c0e]"
              : "bg-[#FAF9F6]/95 border-zinc-200/80 text-zinc-800 hover:bg-white"
          }`}
          style={{
            boxShadow: isDark
              ? "0 14px 34px -6px rgba(0, 0, 0, 0.8), 0 0 1px 1px rgba(255, 255, 255, 0.08)"
              : "0 14px 34px -6px rgba(0, 0, 0, 0.1), 0 0 1px 1px rgba(0, 0, 0, 0.04)",
          }}
          title="Klik untuk membuka Karsa Island (Esc untuk tutup)"
        >
          <BezelWings isDark={isDark} showBacklight={true} />

          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                isSleeping ? "bg-amber-400" : "bg-emerald-400 animate-pulse"
              }`}
            />
            <span className="font-semibold text-xs tracking-tight">Karsa</span>
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-400">
            {isSleeping ? (
              <span className="text-amber-400 font-bold">💤 Sleep</span>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-emerald-400 font-medium">
                  {dashboard?.finance?.daily_safe_spend_idr
                    ? formatRupiah(dashboard.finance.daily_safe_spend_idr)
                    : "07:47"}
                </span>
                <div className="flex items-end gap-0.5 h-3">
                  <span className="w-0.5 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="w-0.5 h-3 rounded-full bg-emerald-400 animate-pulse delay-75" />
                  <span className="w-0.5 h-1.5 rounded-full bg-emerald-400 animate-pulse delay-150" />
                </div>
              </div>
            )}
            <Maximize2 className="w-3 h-3 opacity-60 ml-0.5" />
          </div>
        </motion.div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: BEZEL ISLAND EXPANDED DECK (6-Slide Interactive Carousel Deck)     */}
      {/* ========================================================================= */}
      {islandMode === "COMPACT" && (
        <motion.div
          initial={{ y: -30, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -30, opacity: 0, scale: 0.96 }}
          transition={springTransition}
          className={`relative w-[96vw] max-w-[620px] rounded-b-[30px] border border-t-0 overflow-visible flex flex-col transition-colors p-4 space-y-3 ${
            isDark
              ? "bg-[#000000] border-white/10 text-zinc-100"
              : "bg-[#FAF9F6] border-zinc-200/90 text-zinc-900"
          }`}
          style={{
            boxShadow: isDark
              ? "0 28px 70px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06)"
              : "0 28px 70px rgba(217,93,57,0.1), 0 0 0 1px rgba(0,0,0,0.04)",
          }}
        >
          <BezelWings isDark={isDark} showBacklight={true} />

          {/* Top Bar Lega (px-4 py-2, gap-3) */}
          <div className="flex items-center justify-between px-1">
            {/* Left Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIslandMode("PILL")}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isDark
                    ? "bg-white/8 hover:bg-white/15 text-zinc-200"
                    : "bg-zinc-200/60 hover:bg-zinc-200 text-zinc-700"
                }`}
                title="Kecilkan ke Idle Pill"
              >
                <Home className="w-4 h-4" />
              </button>

              <button
                onClick={() => setActivePopover((prev) => (prev === "CHAT" ? null : "CHAT"))}
                onMouseEnter={() => setHoverTarget("chat")}
                onMouseLeave={() => setHoverTarget(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  activePopover === "CHAT"
                    ? "bg-orange-500 text-white"
                    : isDark
                    ? "hover:bg-white/10 text-zinc-400 hover:text-white"
                    : "hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900"
                }`}
                title="Buka Chat Drawer"
              >
                <MessageSquare className="w-4 h-4" />
              </button>

              <button
                onClick={() => {
                  setInputMessage("@");
                  setIsAutocompleteOpen(true);
                  inputRef.current?.focus();
                }}
                onMouseEnter={() => setHoverTarget("add")}
                onMouseLeave={() => setHoverTarget(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isDark
                    ? "hover:bg-white/10 text-zinc-400 hover:text-white"
                    : "hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900"
                }`}
                title="Tambah Cepat / Ketik Direktif (@)"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setActivePopover((prev) => (prev === "SETTINGS" ? null : "SETTINGS"))}
                onMouseEnter={() => setHoverTarget("settings")}
                onMouseLeave={() => setHoverTarget(null)}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  activePopover === "SETTINGS"
                    ? "bg-orange-500 text-white"
                    : isDark
                    ? "hover:bg-white/10 text-zinc-400 hover:text-white"
                    : "hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900"
                }`}
                title="Settings & Model Manager (⚙️)"
              >
                <SlidersHorizontal className="w-4 h-4" />
              </button>

              <button
                onClick={toggleSleep}
                className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                  isSleeping
                    ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    : isDark
                    ? "hover:bg-white/10 text-zinc-400 hover:text-white"
                    : "hover:bg-zinc-200 text-zinc-600 hover:text-zinc-900"
                }`}
                title={isSleeping ? "Bangunkan Karsa" : "Zero-Heat Sleep Mode (0 FPS)"}
              >
                {isSleeping ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Dynamic Island 6-Slide Carousel Deck */}
          <DynamicIslandDeck
            isDark={isDark}
            mascotColor={mascotColor}
            eyeColor={eyeColor}
            isSleeping={isSleeping}
            isDraggingFile={isDraggingFile}
            activeAccessory={activeAccessory}
            hoverTarget={hoverTarget}
            emoteContext={emoteContext}
            onDropFiles={handleDropFiles}
            onSubmitMessage={handleSubmit}
            isStreaming={isStreaming}
          />

          {/* Data Summary Quick Pills (100% Real SQLite) */}
          <div className="flex items-center justify-between gap-2 px-0.5">
            {/* Safe Spend Pill -> Opens Report Drawer */}
            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === "REPORT" ? null : "REPORT"))}
              className={`flex-1 py-1.5 px-3 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                activePopover === "REPORT"
                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-400"
                  : isDark
                  ? "bg-white/[0.03] border-white/5 hover:border-white/15 text-zinc-300"
                  : "bg-white border-zinc-200/70 hover:border-zinc-300 text-zinc-800 shadow-sm"
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" />
                <span className="text-[10px] text-zinc-400">Safe Spend</span>
              </div>
              <span className="font-mono font-bold text-[11px] text-emerald-500">
                {dashboard?.finance?.daily_safe_spend_idr
                  ? formatRupiah(dashboard.finance.daily_safe_spend_idr)
                  : "Rp 0"}
              </span>
            </button>

            {/* Tasks Pill -> Opens Tasks Drawer */}
            <button
              type="button"
              onClick={() => setActivePopover((prev) => (prev === "TASKS" ? null : "TASKS"))}
              className={`flex-1 py-1.5 px-3 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
                activePopover === "TASKS"
                  ? "bg-amber-500/15 border-amber-500/40 text-amber-400"
                  : isDark
                  ? "bg-white/[0.03] border-white/5 hover:border-white/15 text-zinc-300"
                  : "bg-white border-zinc-200/70 hover:border-zinc-300 text-zinc-800 shadow-sm"
              }`}
            >
              <div className="flex items-center gap-1.5 truncate">
                <span
                  className={`w-2 h-2 rounded-full ${
                    (dashboard?.tasks?.urgent_count ?? 0) > 0 ? "bg-rose-400" : "bg-amber-400"
                  }`}
                />
                <span className="text-[10px] text-zinc-400">Tugas Kuliah</span>
              </div>
              <span className="font-mono font-bold text-[11px]">
                {dashboard?.tasks?.todo_count ?? 0}{" "}
                <span className="text-[10px] font-normal text-zinc-400">aktif</span>
              </span>
            </button>

            {/* Screen Reader Pill */}
            <button
              type="button"
              onClick={handleScreenAssist}
              className={`p-1.5 rounded-xl border flex items-center justify-center transition-all cursor-pointer flex-shrink-0 ${
                isDark
                  ? "bg-white/[0.03] border-white/5 hover:bg-white/10 text-pink-400"
                  : "bg-white border-zinc-200/70 hover:bg-zinc-100 text-pink-500 shadow-sm"
              }`}
              title="Baca Jendela Laptop Aktif (@Screen)"
            >
              <Monitor className="w-4 h-4" />
            </button>
          </div>

          {/* Feedback Toast Notification */}
          <AnimatePresence>
            {feedbackToast && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className={`p-3 rounded-2xl border text-xs leading-relaxed whitespace-pre-wrap ${
                  isDark
                    ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-200"
                    : "bg-emerald-50 border-emerald-300 text-emerald-900 shadow-sm"
                }`}
              >
                {feedbackToast}
              </motion.div>
            )}
          </AnimatePresence>

          {/* Pending HITL Approval Card */}
          {pendingApprovals.length > 0 && (
            <div className="space-y-2">
              {pendingApprovals.map((approval) => (
                <HitlApprovalPill
                  key={approval.action_id}
                  approval={approval}
                  onDecision={handleApprovalDecision}
                />
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* ========================================================================= */}
      {/* SINGLE ACTIVE POPOVER DRAWERS (No stacking, no obstruction) */}
      {/* ========================================================================= */}

      {/* 1. Finance Report Drawer (@Money laporan) */}
      <FinanceReportDrawer
        isOpen={activePopover === "REPORT"}
        onClose={() => setActivePopover(null)}
        isDark={isDark}
      />

      {/* 2. Tasks Drawer (@Todo Eisenhower Matrix) */}
      <TasksDrawer
        isOpen={activePopover === "TASKS"}
        onClose={() => setActivePopover(null)}
        isDark={isDark}
      />

      {/* 3. Chat Drawer */}
      <ChatDrawer
        isOpen={activePopover === "CHAT"}
        onClose={() => setActivePopover(null)}
        messages={chatHistory}
        isStreaming={isStreaming}
        onSendMessage={(msg) => handleSubmit(msg)}
        onClearChat={() =>
          setChatHistory([
            {
              role: "assistant",
              text: "Halo! Riwayat percakapan telah dibersihkan. Ada yang bisa kubantu?",
            },
          ])
        }
        isDark={isDark}
      />

      {/* 4. Settings Modal (3 Tabs: Models, Modules, Appearance) */}
      <SettingsModal
        isOpen={activePopover === "SETTINGS"}
        onClose={() => setActivePopover(null)}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
        notchSize={notchSize}
        onNotchSizeChange={setNotchSize}
        mascotColor={mascotColor}
        onMascotColorChange={setMascotColor}
        eyeColor={eyeColor}
        onEyeColorChange={setEyeColor}
        onOpenWardrobe={() => setActivePopover("WARDROBE")}
        isDark={isDark}
      />

      {/* 5. Mascot Wardrobe & Accessory Drawing Pad */}
      <WardrobeStudio
        isOpen={activePopover === "WARDROBE"}
        onClose={() => setActivePopover(null)}
        currentColor={mascotColor}
        onColorChange={setMascotColor}
        currentEyeColor={eyeColor}
        onEyeColorChange={setEyeColor}
        activeAccessory={activeAccessory}
        onSelectAccessory={setActiveAccessory}
      />
    </div>
  );
};
