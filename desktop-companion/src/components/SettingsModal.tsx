import React, { useEffect, useState, useCallback } from "react";
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
  Activity,
  Coins,
  ShieldCheck,
  Plus,
  RefreshCw,
  Sun,
  Moon,
  Laptop,
} from "lucide-react";

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
  isDark?: boolean;
}

interface HardwareProfile {
  mode: string;
  ram_total_gb: number;
  ram_available_gb: number;
  vram_total_gb: number;
  vram_free_gb: number;
  gpu_name: string | null;
  recommended_tier: string;
}

interface ModuleItem {
  id: string;
  name: string;
  version: string;
  description: string;
  model_tier: string;
  shortcuts: string[];
  enabled: boolean;
}

interface TokenAnalytics {
  totals: {
    total_tokens_in: number;
    total_tokens_out: number;
    total_cost_idr: number;
    total_calls: number;
  };
  by_model: Array<{
    model_used: string;
    tokens: number;
    cost_idr: number;
    calls: number;
  }>;
  recent_logs: Array<{
    id: number;
    timestamp: string;
    module: string;
    model_used: string;
    tokens_in: number;
    tokens_out: number;
    estimated_cost_idr: number;
  }>;
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
  isDark = true,
}) => {
  const [activeTab, setActiveTab] = useState<"models" | "modules" | "appearance">("models");

  // Hardware state
  const [hardware, setHardware] = useState<HardwareProfile | null>(null);
  const [hwLoading, setHwLoading] = useState(false);

  // Provider & API Keys state
  const [providerStatus, setProviderStatus] = useState<any>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [revealKey, setRevealKey] = useState<Record<string, boolean>>({});
  const [savingKeys, setSavingKeys] = useState(false);
  const [keySaveMessage, setKeySaveMessage] = useState<string | null>(null);

  // Token Analytics state
  const [tokenStats, setTokenStats] = useState<TokenAnalytics | null>(null);

  // Modules state
  const [modules, setModules] = useState<ModuleItem[]>([]);
  const [modLoading, setModLoading] = useState(false);

  const fetchHardware = useCallback(async () => {
    setHwLoading(true);
    try {
      const res = await fetch("/api/v1/system/hardware");
      if (res.ok) setHardware(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setHwLoading(false);
    }
  }, []);

  const fetchProvidersAndKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/settings/providers");
      if (res.ok) setProviderStatus(await res.json());
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchTokenAnalytics = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/system/tokens/analytics");
      if (res.ok) setTokenStats(await res.json());
    } catch (e) {
      console.error(e);
    }
  }, []);

  const fetchModules = useCallback(async () => {
    setModLoading(true);
    try {
      const res = await fetch("/api/v1/modules");
      if (res.ok) {
        const data = await res.json();
        setModules(data.modules || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setModLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchHardware();
      fetchProvidersAndKeys();
      fetchTokenAnalytics();
      fetchModules();
      setKeySaveMessage(null);
    }
  }, [isOpen, fetchHardware, fetchProvidersAndKeys, fetchTokenAnalytics, fetchModules]);

  const handleSaveApiKeys = async () => {
    const filledKeys = Object.fromEntries(
      Object.entries(apiKeys).filter(([, v]) => v.trim().length > 0)
    );
    if (Object.keys(filledKeys).length === 0) {
      setKeySaveMessage("Belum ada API key yang diisi.");
      return;
    }
    setSavingKeys(true);
    try {
      const res = await fetch("/api/v1/settings/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(filledKeys),
      });
      if (!res.ok) throw new Error("Gagal menyimpan key");
      setApiKeys({});
      setKeySaveMessage("✅ API Keys berhasil disimpan ke .env!");
      fetchProvidersAndKeys();
    } catch (e) {
      setKeySaveMessage("❌ Gagal menyimpan. Pastikan server backend aktif.");
    } finally {
      setSavingKeys(false);
    }
  };

  const handleToggleModule = async (moduleId: string) => {
    try {
      const res = await fetch(`/api/v1/modules/${moduleId}/toggle`, { method: "POST" });
      if (res.ok) {
        setModules((prev) =>
          prev.map((m) => (m.id === moduleId ? { ...m, enabled: !m.enabled } : m))
        );
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-12 pb-6 bg-black/70 backdrop-blur-md overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 12 }}
        transition={{ type: "spring", stiffness: 350, damping: 28 }}
        className={`w-full max-w-[560px] h-[82vh] max-h-[660px] rounded-3xl overflow-hidden flex flex-col border shadow-2xl transition-colors ${
          isDark
            ? "bg-[#18181B] border-white/10 text-zinc-100"
            : "bg-[#FAF9F6] border-zinc-200 text-zinc-900"
        }`}
        style={{
          boxShadow: isDark
            ? "0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08)"
            : "0 24px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)",
        }}
      >
        {/* Header */}
        <div
          className={`px-6 py-4.5 flex items-center justify-between border-b ${
            isDark ? "border-white/5 bg-white/[0.02]" : "border-zinc-200/80 bg-black/[0.01]"
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-orange-500/15 border border-orange-500/30 flex items-center justify-center text-orange-500">
              <Boxes className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight">Karsa Settings & Engine Control</h2>
              <p className="text-[11px] text-zinc-400">Pusat konfigurasi model, modul, dan antarmuka</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`w-8 h-8 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
              isDark ? "hover:bg-white/10 text-zinc-400" : "hover:bg-zinc-200 text-zinc-600"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          className={`px-6 py-2 flex items-center gap-2 border-b text-xs font-medium ${
            isDark ? "border-white/5 bg-black/20" : "border-zinc-200/60 bg-zinc-100/50"
          }`}
        >
          <button
            onClick={() => setActiveTab("models")}
            className={`px-3.5 py-1.5 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "models"
                ? isDark
                  ? "bg-white/15 text-white shadow-sm"
                  : "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Cpu className="w-3.5 h-3.5 text-blue-400" />
            <span>Models & Hardware</span>
          </button>

          <button
            onClick={() => setActiveTab("modules")}
            className={`px-3.5 py-1.5 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "modules"
                ? isDark
                  ? "bg-white/15 text-white shadow-sm"
                  : "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Boxes className="w-3.5 h-3.5 text-emerald-400" />
            <span>Modules Manager</span>
          </button>

          <button
            onClick={() => setActiveTab("appearance")}
            className={`px-3.5 py-1.5 rounded-xl flex items-center gap-2 transition-all cursor-pointer ${
              activeTab === "appearance"
                ? isDark
                  ? "bg-white/15 text-white shadow-sm"
                  : "bg-white text-zinc-900 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Palette className="w-3.5 h-3.5 text-orange-400" />
            <span>Appearance & Mascot</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* TAB 1: MODELS & HARDWARE */}
          {activeTab === "models" && (
            <div className="space-y-6">
              {/* Real Hardware Card */}
              <div
                className={`p-4 rounded-2xl border ${
                  isDark ? "bg-white/[0.03] border-white/5" : "bg-white border-zinc-200/80"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Real Hardware Telemetry
                    </span>
                  </div>
                  <button
                    onClick={fetchHardware}
                    disabled={hwLoading}
                    className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${hwLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div
                    className={`p-3 rounded-xl border ${
                      isDark ? "bg-black/30 border-white/5" : "bg-zinc-50 border-zinc-200/60"
                    }`}
                  >
                    <div className="text-[10px] text-zinc-400 mb-0.5">RAM Sistem</div>
                    <div className="font-mono font-bold text-sm">
                      {hardware?.ram_available_gb.toFixed(1) ?? "..."} GB{" "}
                      <span className="text-[10px] font-normal text-zinc-400">
                        / {hardware?.ram_total_gb.toFixed(1) ?? "..."} GB bebas
                      </span>
                    </div>
                  </div>

                  <div
                    className={`p-3 rounded-xl border ${
                      isDark ? "bg-black/30 border-white/5" : "bg-zinc-50 border-zinc-200/60"
                    }`}
                  >
                    <div className="text-[10px] text-zinc-400 mb-0.5">Mode Mesin</div>
                    <div className="flex items-center gap-1.5 font-bold">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          hardware?.mode === "turbo_gpu" ? "bg-emerald-400" : "bg-amber-400"
                        }`}
                      />
                      <span>{hardware?.mode === "turbo_gpu" ? "Turbo GPU Local" : "Eco Cloud CPU"}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Token Analytics */}
              <div
                className={`p-4 rounded-2xl border ${
                  isDark ? "bg-white/[0.03] border-white/5" : "bg-white border-zinc-200/80"
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Coins className="w-4 h-4 text-amber-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Token & Cost Analytics (SQLite Asli)
                    </span>
                  </div>
                  <span className="text-[10px] text-zinc-400">
                    {tokenStats?.totals.total_calls ?? 0} pemanggilan
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5 text-center">
                  <div
                    className={`p-2.5 rounded-xl border ${
                      isDark ? "bg-black/30 border-white/5" : "bg-zinc-50 border-zinc-200/60"
                    }`}
                  >
                    <div className="text-[9px] text-zinc-400">Input Token</div>
                    <div className="font-mono font-bold text-xs mt-0.5">
                      {tokenStats?.totals.total_tokens_in.toLocaleString() ?? "0"}
                    </div>
                  </div>
                  <div
                    className={`p-2.5 rounded-xl border ${
                      isDark ? "bg-black/30 border-white/5" : "bg-zinc-50 border-zinc-200/60"
                    }`}
                  >
                    <div className="text-[9px] text-zinc-400">Output Token</div>
                    <div className="font-mono font-bold text-xs mt-0.5">
                      {tokenStats?.totals.total_tokens_out.toLocaleString() ?? "0"}
                    </div>
                  </div>
                  <div
                    className={`p-2.5 rounded-xl border ${
                      isDark ? "bg-black/30 border-white/5" : "bg-zinc-50 border-zinc-200/60"
                    }`}
                  >
                    <div className="text-[9px] text-zinc-400">Est. Biaya IDR</div>
                    <div className="font-mono font-bold text-xs mt-0.5 text-emerald-400">
                      Rp {Math.round(tokenStats?.totals.total_cost_idr ?? 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              {/* API Keys Configuration */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDark ? "bg-white/[0.03] border-white/5" : "bg-white border-zinc-200/80"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Hot-Swap Model & API Keys
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {[
                    {
                      id: "gemini_api_key",
                      label: "Google Gemini 2.0 / 3.8 Flash",
                      hint: "Default Tier 1 & Sintesis Akhir Council",
                      hasKey: providerStatus?.keys?.gemini_api_key,
                    },
                    {
                      id: "deepseek_api_key",
                      label: "TheHive.ai DeepSeek Flash 1017",
                      hint: "Tier 2 Coding & Kritik Logika Council",
                      hasKey: providerStatus?.keys?.deepseek_api_key,
                    },
                    {
                      id: "anthropic_api_key",
                      label: "Anthropic Claude 3.5 Sonnet",
                      hint: "Opsional untuk Skripsi IMRaD & Riset",
                      hasKey: providerStatus?.keys?.anthropic_api_key,
                    },
                  ].map((field) => (
                    <div key={field.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-zinc-300">{field.label}</span>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded-md ${
                            field.hasKey
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                              : "bg-zinc-500/15 text-zinc-400"
                          }`}
                        >
                          {field.hasKey ? "Aktif" : "Belum Ada"}
                        </span>
                      </div>
                      <div className="relative">
                        <input
                          type={revealKey[field.id] ? "text" : "password"}
                          value={apiKeys[field.id] ?? ""}
                          onChange={(e) =>
                            setApiKeys((prev) => ({ ...prev, [field.id]: e.target.value }))
                          }
                          placeholder={field.hasKey ? "••••••••••••••••" : `Masukkan ${field.label}...`}
                          className={`w-full text-xs px-3 py-2 pr-9 rounded-xl border outline-none font-mono ${
                            isDark
                              ? "bg-black/30 border-white/10 text-white placeholder-zinc-500 focus:border-orange-500/50"
                              : "bg-white border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-orange-500/50"
                          }`}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setRevealKey((prev) => ({ ...prev, [field.id]: !prev[field.id] }))
                          }
                          className="absolute right-2.5 top-2.5 text-zinc-400 hover:text-zinc-200"
                        >
                          {revealKey[field.id] ? (
                            <EyeOff className="w-3.5 h-3.5" />
                          ) : (
                            <Eye className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      <p className="text-[10px] text-zinc-400/80">{field.hint}</p>
                    </div>
                  ))}
                </div>

                {keySaveMessage && (
                  <div className="text-xs p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-400 font-medium">
                    {keySaveMessage}
                  </div>
                )}

                <button
                  onClick={handleSaveApiKeys}
                  disabled={savingKeys}
                  className="w-full py-2 px-4 rounded-xl text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>{savingKeys ? "Menyimpan ke .env..." : "Simpan & Terapkan Kunci"}</span>
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: MODULES MANAGER */}
          {activeTab === "modules" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Plug-and-Play Modules ({modules.length})
                </span>
                <span className="text-[10px] text-zinc-400">Zero-dummy data • SQLite connected</span>
              </div>

              {modLoading ? (
                <div className="text-xs text-center py-8 text-zinc-400">Memuat modul terpasang...</div>
              ) : (
                <div className="space-y-2.5">
                  {modules.map((mod) => (
                    <div
                      key={mod.id}
                      className={`p-3.5 rounded-2xl border flex items-center justify-between transition-all ${
                        isDark ? "bg-white/[0.03] border-white/5" : "bg-white border-zinc-200/80"
                      }`}
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-semibold">{mod.name}</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-500/15 text-zinc-400 font-mono">
                            v{mod.version}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-400 truncate mb-1.5">{mod.description}</p>
                        <div className="flex flex-wrap gap-1">
                          {mod.shortcuts.map((sc) => (
                            <span
                              key={sc}
                              className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-orange-500/10 text-orange-400 border border-orange-500/20"
                            >
                              {sc}
                            </span>
                          ))}
                        </div>
                      </div>

                      <button
                        onClick={() => handleToggleModule(mod.id)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-all cursor-pointer flex-shrink-0 ${
                          mod.enabled
                            ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25"
                            : isDark
                            ? "bg-white/5 text-zinc-400 border-white/10 hover:bg-white/10"
                            : "bg-zinc-100 text-zinc-500 border-zinc-200 hover:bg-zinc-200"
                        }`}
                      >
                        {mod.enabled ? "Aktif" : "Nonaktif"}
                      </button>
                    </div>
                  ))}

                  <div
                    className={`p-4 rounded-2xl border border-dashed flex items-center justify-center gap-2 text-xs font-medium cursor-pointer transition-colors ${
                      isDark
                        ? "border-white/15 text-zinc-400 hover:text-zinc-200 hover:border-white/30"
                        : "border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:border-zinc-400"
                    }`}
                    onClick={() =>
                      alert(
                        "Untuk menambah modul baru, buat folder di backend/modules/<nama_modul>/ dengan mewarisi BaseKarsaModule."
                      )
                    }
                  >
                    <Plus className="w-4 h-4 text-orange-400" />
                    <span>+ Tambah Modul Baru</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: APPEARANCE & MASCOT */}
          {activeTab === "appearance" && (
            <div className="space-y-6">
              {/* Theme Selection */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDark ? "bg-white/[0.03] border-white/5" : "bg-white border-zinc-200/80"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Tema Antarmuka OS
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: "system", label: "Ikuti Komputer", icon: Laptop },
                    { id: "light", label: "Light (Warm Paper)", icon: Sun },
                    { id: "dark", label: "Dark (Cosmic)", icon: Moon },
                  ].map((t) => {
                    const Icon = t.icon;
                    const isSelected = themeMode === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => onThemeModeChange(t.id as ThemeMode)}
                        className={`p-3 rounded-xl border flex flex-col items-center gap-2 text-xs transition-all cursor-pointer ${
                          isSelected
                            ? "bg-orange-500/15 border-orange-500/40 text-orange-500 font-semibold"
                            : isDark
                            ? "bg-black/20 border-white/5 text-zinc-400 hover:bg-white/5"
                            : "bg-zinc-50 border-zinc-200/60 text-zinc-600 hover:bg-zinc-100"
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="text-[11px] text-center">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Notch Size */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDark ? "bg-white/[0.03] border-white/5" : "bg-white border-zinc-200/80"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Ukuran Notch Island
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => onNotchSizeChange("compact")}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      notchSize === "compact"
                        ? "bg-orange-500/15 border-orange-500/40 text-orange-500 font-semibold"
                        : isDark
                        ? "bg-black/20 border-white/5 text-zinc-400 hover:bg-white/5"
                        : "bg-zinc-50 border-zinc-200/60 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    <span>Compact (400px)</span>
                    <span className="text-[10px] opacity-70">Anti-terhalang layar</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onNotchSizeChange("normal")}
                    className={`p-3 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer ${
                      notchSize === "normal"
                        ? "bg-orange-500/15 border-orange-500/40 text-orange-500 font-semibold"
                        : isDark
                        ? "bg-black/20 border-white/5 text-zinc-400 hover:bg-white/5"
                        : "bg-zinc-50 border-zinc-200/60 text-zinc-600 hover:bg-zinc-100"
                    }`}
                  >
                    <span>Normal (440px)</span>
                    <span className="text-[10px] opacity-70">Kanvas maskot lebih lega</span>
                  </button>
                </div>
              </div>

              {/* Mascot Color Palette */}
              <div
                className={`p-4 rounded-2xl border space-y-3 ${
                  isDark ? "bg-white/[0.03] border-white/5" : "bg-white border-zinc-200/80"
                }`}
              >
                <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Warna Tubuh & Paws Maskot
                </div>
                <div className="flex items-center gap-2.5">
                  {PRESET_BODY_COLORS.map((col) => (
                    <button
                      key={col}
                      type="button"
                      onClick={() => onMascotColorChange(col)}
                      className={`w-7 h-7 rounded-full border-2 transition-transform cursor-pointer flex items-center justify-center ${
                        mascotColor === col ? "scale-115 border-orange-500 shadow-md" : "border-white/20"
                      }`}
                      style={{ backgroundColor: col }}
                    >
                      {mascotColor === col && (
                        <Check className={`w-3.5 h-3.5 ${col === "#FAF9F6" ? "text-black" : "text-white"}`} />
                      )}
                    </button>
                  ))}
                </div>

                {onOpenWardrobe && (
                  <button
                    onClick={() => {
                      onClose();
                      onOpenWardrobe();
                    }}
                    className="w-full mt-2 py-2 px-3 rounded-xl text-xs font-medium border border-orange-500/30 text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Palette className="w-3.5 h-3.5" />
                    <span>Buka Wardrobe Studio & Gambar Aksesoris Sendiri</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
