import React, { useEffect, useState, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Cpu,
  Boxes,
  Palette,
  Check,
  Eye,
  EyeOff,
  Zap,
  Coins,
  ShieldCheck,
  RefreshCw,
  Sun,
  Moon,
  Laptop,
  Pin,
  Minus,
  Maximize2,
} from "lucide-react";
import { ModelPlanPanel } from "./ModelPlanPanel";
import { MobileConnectPanel } from "./MobileConnectPanel";
import { useSystemStatus } from "../context/SystemStatusContext";
import { SettingsSlide } from "./slides/SettingsSlide";

export type ThemeMode = "system" | "light" | "dark";
export type NotchSize = "compact" | "normal";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeMode: ThemeMode;
  onThemeModeChange: (mode: ThemeMode) => void;
  notchSize: NotchSize;
  onNotchSizeChange: (size: NotchSize) => void;
  mascotColor: string;
  onMascotColorChange: (color: string) => void;
  eyeColor: string;
  onEyeColorChange: (color: string) => void;
  onOpenWardrobe?: () => void;
  isSleeping?: boolean;
  onSleepChange?: (sleeping: boolean) => void;
  isDark?: boolean;
}

interface HardwareProfile {
  mode: string;
  ram_total_gb: number;
  ram_available_gb: number;
  gpu_name: string | null;
}

interface TokenAnalytics {
  totals: {
    total_tokens_in: number;
    total_tokens_out: number;
    total_cost_idr: number;
    total_calls: number;
  };
}

const PRESET_BODY_COLORS = [
  "#FAF9F6", // Warm Editorial Paper
  "#D95D39", // Terracotta Solid
  "#38bdf8", // Sky Blue
  "#3B7A57", // Sage Green
  "#E09F3E", // Honey Amber
  "#18181B", // Cosmic Charcoal
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  themeMode,
  onThemeModeChange,
  notchSize,
  onNotchSizeChange,
  mascotColor,
  onMascotColorChange,
  eyeColor,
  onEyeColorChange,
  onOpenWardrobe,
  isSleeping = false,
  onSleepChange,
  isDark = true,
}) => {
  const [activeTab, setActiveTab] = useState<"keys" | "plan" | "appearance" | "hardware" | "phone">("keys");
  const [isPinned, setIsPinned] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // System status & API keys from single source of truth
  const {
    isApiConnected,
    connectedModel,
    activeBadge,
    geminiKey,
    saveAndTestKey,
    focusApiKeyTrigger,
  } = useSystemStatus();

  // Controlled input for Gemini API Key
  const [geminiKeyInput, setGeminiKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusFeedback, setStatusFeedback] = useState<{
    type: "success" | "error" | "info";
    text: string;
  } | null>(null);

  const inputKeyRef = useRef<HTMLInputElement>(null);

  // Sync initial key from context
  useEffect(() => {
    if (geminiKey) {
      setGeminiKeyInput(geminiKey);
    }
  }, [geminiKey]);

  // Auto-focus when focusApiKeyTrigger changes
  useEffect(() => {
    if (isOpen) {
      setActiveTab("keys");
      setTimeout(() => {
        inputKeyRef.current?.focus();
      }, 100);
    }
  }, [isOpen, focusApiKeyTrigger]);

  // Hardware profile & token stats
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [tokenStats, setTokenStats] = useState<TokenAnalytics | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const [resHw, resTokens] = await Promise.all([
        fetch("/api/v1/system/hardware"),
        fetch("/api/v1/system/tokens/analytics"),
      ]);
      if (resHw.ok) setHardware(await resHw.json());
      if (resTokens.ok) setTokenStats(await resTokens.json());
    } catch (_) {}
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchStats();
    }
  }, [isOpen, fetchStats]);

  // ESC to close (unless pinned)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPinned) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isPinned]);

  if (!isOpen) return null;

  // Save & Connect Action
  const handleSaveAndConnect = async () => {
    const trimmed = geminiKeyInput.trim();
    if (!trimmed) {
      setStatusFeedback({
        type: "error",
        text: "Kunci kosong. Tempelkan Google Gemini API Key Anda.",
      });
      return;
    }

    setIsSaving(true);
    setStatusFeedback({
      type: "info",
      text: "Menguji koneksi ke Google Gemini API...",
    });

    const res = await saveAndTestKey(trimmed, "gemini");
    setIsSaving(false);

    if (res.success) {
      setStatusFeedback({
        type: "success",
        text: `✅ Terhubung! Menggunakan ${res.model || "Gemini Flash"}. Kunci tersimpan di SQLite.`,
      });
    } else {
      setStatusFeedback({
        type: "error",
        text: `❌ ${res.message}`,
      });
    }
  };

  return createPortal(
    <AnimatePresence>
      {isMinimized ? (
        /* Floating Mini-Widget (128px × 36px) */
        <motion.div
          key="minimized-settings-widget"
          drag
          dragMomentum={false}
          initial={{ opacity: 0, scale: 0.85, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -8 }}
          transition={{ type: "spring", stiffness: 420, damping: 25 }}
          className={`fixed top-12 left-6 z-50 w-[128px] h-[36px] rounded-full flex items-center justify-between px-3 cursor-grab active:cursor-grabbing select-none pointer-events-auto border backdrop-blur-2xl shadow-lg ${
            isDark
              ? "bg-zinc-950/90 border-white/10 text-zinc-100 shadow-[0_12px_28px_rgba(0,0,0,0.6)]"
              : "bg-white/90 border-slate-200/80 text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
          }`}
          onClick={() => setIsMinimized(false)}
          title="Tarik untuk memindahkan • Klik untuk membuka Pengaturan"
        >
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${
                isApiConnected ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            <span className="text-xs font-semibold tracking-tight truncate">Settings</span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsMinimized(false);
              }}
              className="p-1 rounded-full text-zinc-400 hover:text-zinc-100 transition-colors"
              title="Perbesar"
            >
              <Maximize2 className="w-3 h-3 stroke-[2.25]" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              className="p-1 rounded-full text-zinc-400 hover:text-rose-400 transition-colors"
              title="Tutup"
            >
              <X className="w-3 h-3 stroke-[2.25]" />
            </button>
          </div>
        </motion.div>
      ) : (
        /* Compact Draggable Floating Settings Card (340px × 380px max) */
        <motion.div
          key="floating-settings-card"
          drag
          dragMomentum={false}
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 10 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className={`fixed top-12 left-6 z-50 w-[335px] max-w-[calc(100vw-1.5rem)] h-[390px] rounded-[28px] flex flex-col pointer-events-auto border backdrop-blur-2xl select-none overflow-hidden karsa-surface`}
        >
          {/* Header & Drag Handle */}
          <div
            className={`px-3.5 py-2.5 flex items-center justify-between border-b cursor-grab active:cursor-grabbing flex-shrink-0 select-none ${
              isDark ? "border-white/10 bg-white/[0.02]" : "border-slate-200/80 bg-slate-50/50"
            }`}
            title="Klik dan geser untuk memindahkan kartu"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  isDark
                    ? "bg-white/[0.08] text-zinc-200 border border-white/10"
                    : "bg-slate-100 text-slate-800 border border-slate-200"
                }`}
              >
                <Boxes className="w-3 h-3 text-orange-500" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-[11.5px] font-semibold tracking-tight truncate">
                    Karsa Settings
                  </h2>
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.2 rounded-full whitespace-nowrap ${
                      isApiConnected
                        ? isDark
                          ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                          : "bg-emerald-500/10 text-emerald-700 border border-emerald-600/20"
                        : "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                    }`}
                  >
                    {activeBadge}
                  </span>
                </div>
              </div>
            </div>

            {/* Window Action Buttons */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => setIsPinned(!isPinned)}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isPinned
                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/40"
                    : isDark
                    ? "hover:bg-white/10 text-zinc-400"
                    : "hover:bg-slate-200 text-slate-600"
                }`}
                title={isPinned ? "Lepas Pin" : "Pin Widget di Layar (📌)"}
              >
                <Pin className={`w-3 h-3 ${isPinned ? "rotate-45" : ""}`} />
              </button>

              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isDark ? "hover:bg-white/10 text-zinc-400" : "hover:bg-slate-200 text-slate-600"
                }`}
                title="Kecilkan (—)"
              >
                <Minus className="w-3 h-3 stroke-[2.25]" />
              </button>

              <button
                type="button"
                onClick={onClose}
                className={`w-6 h-6 rounded-full flex items-center justify-center transition-all cursor-pointer ${
                  isDark ? "hover:bg-rose-500 hover:text-white text-zinc-400" : "hover:bg-rose-500 hover:text-white text-slate-600"
                }`}
                title="Tutup (Esc)"
              >
                <X className="w-3 h-3 stroke-[2.25]" />
              </button>
            </div>
          </div>

          {/* Compact Tab Switcher */}
          <div
            className={`px-3 py-1.5 flex items-center gap-1 border-b text-[11px] font-medium flex-shrink-0 ${
              isDark ? "border-white/10 bg-black/20" : "border-slate-200/80 bg-slate-100/40"
            }`}
          >
            <button
              onClick={() => setActiveTab("keys")}
              className={`px-2 py-1 rounded-md flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === "keys"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <ShieldCheck className="w-3 h-3 text-emerald-400" />
              <span>Kunci</span>
            </button>

            <button
              onClick={() => setActiveTab("plan")}
              className={`px-2 py-1 rounded-md flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === "plan"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Zap className="w-3 h-3 text-amber-400" />
              <span>Model AI</span>
            </button>

            <button
              onClick={() => setActiveTab("appearance")}
              className={`px-2 py-1 rounded-md flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === "appearance"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Palette className="w-3 h-3 text-pink-400" />
              <span>Tampilan</span>
            </button>

            <button
              onClick={() => setActiveTab("hardware")}
              className={`px-2 py-1 rounded-md flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === "hardware"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <Cpu className="w-3 h-3 text-blue-400" />
              <span>Hardware</span>
            </button>

            <button
              onClick={() => setActiveTab("phone")}
              className={`px-2 py-1 rounded-md flex items-center gap-1 whitespace-nowrap transition-all cursor-pointer ${
                activeTab === "phone"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <span aria-hidden="true">📱</span>
              <span>HP</span>
            </button>
          </div>

          {/* Tab Content Body */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
            {activeTab === "keys" && (
              <div className="space-y-3">
                {/* Status Card */}
                <div
                  className={`p-2.5 rounded-xl border flex items-center justify-between ${
                    isDark
                      ? "bg-white/[0.04] border-white/10"
                      : "bg-slate-100/80 border-slate-200/70"
                  }`}
                >
                  <div>
                    <div className="text-[10px] text-zinc-400 uppercase font-mono">Status Model</div>
                    <div className="font-semibold text-xs mt-0.5 flex items-center gap-1.5">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          isApiConnected ? "bg-emerald-400 animate-pulse" : "bg-rose-400"
                        }`}
                      />
                      <span>{isApiConnected ? connectedModel : "Belum Terhubung"}</span>
                    </div>
                  </div>
                  <span
                    className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full ${
                      isApiConnected
                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                        : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                    }`}
                  >
                    {isApiConnected ? "🟢 Connected" : "⚪ Belum Diatur"}
                  </span>
                </div>

                {/* Gemini API Key Section */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-800 dark:text-zinc-200">
                      Google Gemini API Key
                    </label>
                    <span className="text-[9.5px] text-zinc-400 font-mono">
                      {isApiConnected ? "Tersimpan di SQLite" : "Wajib untuk Chat & Riset"}
                    </span>
                  </div>

                  <div className="relative flex items-center">
                    <input
                      ref={inputKeyRef}
                      type={showKey ? "text" : "password"}
                      value={geminiKeyInput}
                      onChange={(e) => setGeminiKeyInput(e.target.value)}
                      placeholder="Tempel Gemini API Key di sini (AIzaSy...)"
                      className={`w-full text-xs px-2.5 py-1.5 pr-8 rounded-lg border outline-none font-mono ${
                        isDark
                          ? "bg-white/[0.06] border-white/10 text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-400"
                          : "bg-slate-100/80 border-slate-200/70 text-slate-900 placeholder:text-slate-400 focus:border-indigo-500"
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-2 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>

                  <p className="text-[10px] text-zinc-400 leading-tight">
                    Dapatkan gratis di{" "}
                    <a
                      href="https://aistudio.google.com/app/apikey"
                      target="_blank"
                      rel="noreferrer"
                      className="text-indigo-400 hover:underline"
                    >
                      aistudio.google.com
                    </a>
                  </p>
                </div>

                {/* Prominent "Simpan & Hubungkan" Button */}
                <button
                  type="button"
                  onClick={handleSaveAndConnect}
                  disabled={isSaving}
                  className={`w-full py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-all active:scale-98 shadow-sm ${
                    isSaving
                      ? "opacity-60 cursor-not-allowed bg-indigo-600 text-white"
                      : "btn-warm-sunrise text-white"
                  }`}
                >
                  <Zap className={`w-3 h-3 ${isSaving ? "animate-spin" : ""}`} />
                  <span>{isSaving ? "Menguji Koneksi..." : "Simpan & Hubungkan"}</span>
                </button>

                {/* Status Feedback Banner */}
                {statusFeedback && (
                  <div
                    className={`text-[10.5px] p-2 rounded-lg border leading-tight ${
                      statusFeedback.type === "success"
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 font-medium"
                        : statusFeedback.type === "error"
                        ? "bg-rose-500/10 border-rose-500/30 text-rose-400"
                        : "bg-indigo-500/10 border-indigo-500/30 text-indigo-300"
                    }`}
                  >
                    {statusFeedback.text}
                  </div>
                )}

                {/* Token Analytics Preview */}
                <div
                  className={`p-2.5 rounded-xl border ${
                    isDark ? "bg-white/[0.04] border-white/10" : "bg-slate-100/80 border-slate-200/70"
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 mb-1.5">
                    <span className="flex items-center gap-1 font-mono uppercase">
                      <Coins className="w-3 h-3 text-amber-400" /> Token Analytics (SQLite)
                    </span>
                    <span>{tokenStats?.totals.total_calls ?? 0} calls</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-center">
                    <div
                      className={`p-1.5 rounded-lg border ${
                        isDark ? "bg-black/20 border-white/5" : "bg-white border-slate-200/60"
                      }`}
                    >
                      <div className="text-[9px] text-zinc-400">Total Token</div>
                      <div className="font-mono font-bold text-xs mt-0.5">
                        {((tokenStats?.totals.total_tokens_in ?? 0) +
                          (tokenStats?.totals.total_tokens_out ?? 0)).toLocaleString()}
                      </div>
                    </div>
                    <div
                      className={`p-1.5 rounded-lg border ${
                        isDark ? "bg-black/20 border-white/5" : "bg-white border-slate-200/60"
                      }`}
                    >
                      <div className="text-[9px] text-zinc-400">Est. Biaya</div>
                      <div className="font-mono font-bold text-xs mt-0.5 text-emerald-400">
                        Rp {Math.round(tokenStats?.totals.total_cost_idr ?? 0).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "plan" && <ModelPlanPanel />}

            {activeTab === "phone" && <MobileConnectPanel />}

            {activeTab === "appearance" && (
              <div className="space-y-3">
                {/* Theme Mode */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-800 dark:text-zinc-200">
                    Mode Tema Kaca
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { mode: "light" as ThemeMode, label: "Light", icon: Sun },
                      { mode: "dark" as ThemeMode, label: "Dark", icon: Moon },
                      { mode: "system" as ThemeMode, label: "Sistem", icon: Laptop },
                    ].map(({ mode, label, icon: Icon }) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => onThemeModeChange(mode)}
                        className={`p-2 rounded-lg border flex flex-col items-center gap-1 text-[11px] font-medium transition-all cursor-pointer ${
                          themeMode === mode
                            ? isDark
                              ? "bg-white/20 border-white/40 text-white shadow-xs"
                              : "bg-white border-slate-300 text-slate-900 shadow-xs"
                            : "border-transparent text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        <span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notch Size */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-800 dark:text-zinc-200">
                    Ukuran Dynamic Island
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => onNotchSizeChange("compact")}
                      className={`p-2 rounded-lg border text-[11px] font-medium transition-all cursor-pointer ${
                        notchSize === "compact"
                          ? isDark
                            ? "bg-white/20 border-white/40 text-white"
                            : "bg-white border-slate-300 text-slate-900"
                          : "border-transparent text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Compact (Ramping)
                    </button>
                    <button
                      type="button"
                      onClick={() => onNotchSizeChange("normal")}
                      className={`p-2 rounded-lg border text-[11px] font-medium transition-all cursor-pointer ${
                        notchSize === "normal"
                          ? isDark
                            ? "bg-white/20 border-white/40 text-white"
                            : "bg-white border-slate-300 text-slate-900"
                          : "border-transparent text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      Normal
                    </button>
                  </div>
                </div>

                {/* Mascot Body Color */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold text-slate-800 dark:text-zinc-200">
                      Warna Karakter Karsa
                    </label>
                    {onOpenWardrobe && (
                      <button
                        type="button"
                        onClick={onOpenWardrobe}
                        className="text-[10px] text-indigo-400 hover:underline cursor-pointer"
                      >
                        Buka Wardrobe Studio →
                      </button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {PRESET_BODY_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onMascotColorChange(c)}
                        className={`w-6 h-6 rounded-full border transition-all cursor-pointer flex items-center justify-center ${
                          mascotColor === c ? "scale-110 ring-2 ring-indigo-400" : "hover:scale-105"
                        }`}
                        style={{ backgroundColor: c }}
                      >
                        {mascotColor === c && (
                          <Check
                            className={`w-3 h-3 ${c === "#FAF9F6" ? "text-zinc-900" : "text-white"}`}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {activeTab === "hardware" && (
              <div className="space-y-3">
                <div
                  className={`p-2.5 rounded-xl border flex items-center justify-between ${
                    isDark ? "bg-white/[0.04] border-white/10" : "bg-slate-100/80 border-slate-200/70"
                  }`}
                >
                  <div className="space-y-0.5">
                    <div className="text-[10px] text-zinc-400 uppercase font-mono">Profil Mesin</div>
                    <div className="font-semibold text-xs flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>{hardware?.mode === "turbo_gpu" ? "GPU Accelerated" : "Eco Local CPU"}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={fetchStats}
                    className="p-1 rounded-md text-zinc-400 hover:text-zinc-200"
                    title="Segarkan data"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div
                    className={`p-2 rounded-lg border ${
                      isDark ? "bg-white/[0.04] border-white/10" : "bg-slate-100/80 border-slate-200/70"
                    }`}
                  >
                    <div className="text-[10px] text-zinc-400">RAM Bebas</div>
                    <div className="font-mono font-bold text-xs mt-0.5">
                      {hardware?.ram_available_gb.toFixed(1) ?? "..."} GB
                    </div>
                  </div>
                  <div
                    className={`p-2 rounded-lg border ${
                      isDark ? "bg-white/[0.04] border-white/10" : "bg-slate-100/80 border-slate-200/70"
                    }`}
                  >
                    <div className="text-[10px] text-zinc-400">Total RAM</div>
                    <div className="font-mono font-bold text-xs mt-0.5">
                      {hardware?.ram_total_gb.toFixed(1) ?? "..."} GB
                    </div>
                  </div>
                </div>

                {hardware?.gpu_name && (
                  <div
                    className={`p-2 rounded-lg border text-[11px] font-mono ${
                      isDark ? "bg-white/[0.04] border-white/10" : "bg-slate-100/80 border-slate-200/70"
                    }`}
                  >
                    <div className="text-[9.5px] text-zinc-400">GPU Aktif:</div>
                    <div className="truncate font-semibold text-slate-800 dark:text-zinc-200">
                      {hardware.gpu_name}
                    </div>
                  </div>
                )}

                {/* Model hot-swap, Turbo/Eco mode, Zero-Heat sleep & token cost (formerly carousel slide 7) */}
                <SettingsSlide
                  isDark={isDark}
                  onOpenFullSettings={() => setActiveTab("keys")}
                  isSleeping={isSleeping}
                  onSleepChange={onSleepChange}
                />
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
