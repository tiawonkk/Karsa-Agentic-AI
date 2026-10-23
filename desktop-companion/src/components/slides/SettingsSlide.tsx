import React, { useState, useEffect } from "react";
import {
  Cpu,
  Zap,
  Coins,
  Moon,
  Sun,
  Laptop,
  SlidersHorizontal,
  Check,
  RefreshCw,
  Sparkles,
} from "lucide-react";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
  model: string;
  tier: string;
}

const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "gemini_flash",
    name: "Gemini Flash",
    provider: "gemini",
    model: "gemini-2.0-flash",
    tier: "tier1_utility",
  },
  {
    id: "gemini_pro",
    name: "Gemini Pro",
    provider: "gemini",
    model: "gemini-1.5-pro",
    tier: "tier3_reasoning",
  },
  {
    id: "kiro_ai",
    name: "Kiro AI",
    provider: "openai_compatible",
    model: "kiro-agent-v1",
    tier: "tier2_code",
  },
  {
    id: "deepseek_r1",
    name: "DeepSeek-R1 8B",
    provider: "deepseek",
    model: "deepseek-ai/deepseek-v4.1-flash-1017",
    tier: "tier3_reasoning",
  },
  {
    id: "hermes3",
    name: "Hermes 3 8B",
    provider: "ollama",
    model: "hermes3:8b",
    tier: "tier2_code",
  },
];

interface SettingsSlideProps {
  isDark: boolean;
  onOpenFullSettings: () => void;
}

export const SettingsSlide: React.FC<SettingsSlideProps> = ({
  isDark,
  onOpenFullSettings,
}) => {
  const [activeModelId, setActiveModelId] = useState<string>("gemini_flash");
  const [hardwareMode, setHardwareMode] = useState<"turbo_gpu" | "eco_cpu">("eco_cpu");
  const [isSleeping, setIsSleeping] = useState<boolean>(false);
  const [tokenUsage, setTokenUsage] = useState({
    totalTokens: 0,
    totalCostIdr: 0,
    calls: 0,
  });
  const [isUpdatingModel, setIsUpdatingModel] = useState<boolean>(false);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  // Load hardware, token stats, and active models
  useEffect(() => {
    const fetchData = async () => {
      try {
        // Hardware
        const hwRes = await fetch("/api/v1/system/hardware");
        if (hwRes.ok) {
          const hw = await hwRes.json();
          setHardwareMode(hw.mode === "turbo_gpu" ? "turbo_gpu" : "eco_cpu");
        }

        // Tokens & Cost from SQLite token_logs
        const tokRes = await fetch("/api/v1/system/tokens/analytics");
        if (tokRes.ok) {
          const t = await tokRes.json();
          if (t.totals) {
            setTokenUsage({
              totalTokens: (t.totals.total_tokens_in || 0) + (t.totals.total_tokens_out || 0),
              totalCostIdr: t.totals.total_cost_idr || 0,
              calls: t.totals.total_calls || 0,
            });
          }
        }
      } catch (_) {}
    };

    fetchData();
  }, []);

  // Hot-swap AI Model
  const handleModelChange = async (opt: ModelOption) => {
    setActiveModelId(opt.id);
    setIsUpdatingModel(true);
    try {
      const res = await fetch("/api/v1/settings/models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tier: opt.tier,
          provider: opt.provider,
          model: opt.model,
          temperature: 0.2,
        }),
      });
      if (res.ok) {
        setStatusFeedback(`✅ Model aktif: ${opt.name}`);
      } else {
        setStatusFeedback(`⚠️ Gagal ganti ke ${opt.name}`);
      }
    } catch (_) {
      setStatusFeedback(`❌ Koneksi model gagal`);
    } finally {
      setIsUpdatingModel(false);
      setTimeout(() => setStatusFeedback(null), 2500);
    }
  };

  // Toggle Hardware Mode (Turbo GPU vs Eco CPU)
  const handleToggleHardware = () => {
    const next = hardwareMode === "turbo_gpu" ? "eco_cpu" : "turbo_gpu";
    setHardwareMode(next);
    setStatusFeedback(
      next === "turbo_gpu"
        ? "⚡ Mode Turbo GPU diaktifkan (High Performance)"
        : "🌱 Mode Eco CPU diaktifkan (Battery Saver)"
    );
    setTimeout(() => setStatusFeedback(null), 2500);
  };

  // Toggle Zero-Heat Sleep Mode
  const handleToggleSleep = async () => {
    const next = !isSleeping;
    setIsSleeping(next);
    if (next) {
      try {
        await fetch("/api/v1/system/sleep", { method: "POST" });
        setStatusFeedback("💤 Zero-Heat Sleep Mode (0.0% CPU/GPU VRAM Unloaded)");
      } catch (_) {}
    } else {
      setStatusFeedback("✨ Karsa bangun dan siap beraktivitas!");
    }
    setTimeout(() => setStatusFeedback(null), 2500);
  };

  const formatRupiah = (val: number) => {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(val);
  };

  return (
    <div className="w-full flex flex-col justify-between select-none px-1 py-0.5 gap-2 text-xs">
      {/* 1. Model Selector Hot-Swap Row */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-400 font-mono">
          <span>Hot-Swap AI Model (Real-time):</span>
          {isUpdatingModel && <span className="text-orange-400 animate-pulse">Menghubungkan...</span>}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {MODEL_OPTIONS.map((opt) => {
            const isActive = opt.id === activeModelId;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleModelChange(opt)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer ${
                  isActive
                    ? "bg-orange-600 text-white shadow-sm font-semibold scale-[1.02]"
                    : "bg-white/[0.04] hover:bg-white/10 text-zinc-300 border border-white/5"
                }`}
              >
                {isActive && <Check className="w-3 h-3 stroke-[3]" />}
                <span>{opt.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 2. Hardware Mode, Sleep, & Token Telemetry Controls */}
      <div className="flex items-center justify-between gap-2">
        {/* Turbo GPU vs Eco CPU */}
        <button
          type="button"
          onClick={handleToggleHardware}
          className={`flex-1 px-2.5 py-1.5 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
            hardwareMode === "turbo_gpu"
              ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
              : "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
          }`}
          title="Klik untuk beralih mode performa"
        >
          <div className="flex items-center gap-1.5">
            {hardwareMode === "turbo_gpu" ? (
              <Zap className="w-3.5 h-3.5 text-amber-400" />
            ) : (
              <Cpu className="w-3.5 h-3.5 text-emerald-400" />
            )}
            <span className="font-semibold text-[11px]">
              {hardwareMode === "turbo_gpu" ? "Turbo GPU" : "Eco CPU"}
            </span>
          </div>
          <span className="text-[9px] font-mono opacity-60">Ganti</span>
        </button>

        {/* Real Token & IDR Tracker from SQLite */}
        <div className="flex-1 px-2.5 py-1.5 rounded-xl bg-white/[0.04] border border-white/5 flex items-center justify-between font-mono">
          <div className="flex items-center gap-1.5">
            <Coins className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[10px] text-zinc-300">Biaya Token:</span>
          </div>
          <span className="font-bold text-[11px] text-emerald-400">
            {formatRupiah(tokenUsage.totalCostIdr)}
          </span>
        </div>

        {/* Zero-Heat Sleep Toggle */}
        <button
          type="button"
          onClick={handleToggleSleep}
          className={`px-3 py-1.5 rounded-xl border flex items-center gap-1.5 transition-all cursor-pointer flex-shrink-0 ${
            isSleeping
              ? "bg-indigo-600 border-indigo-400 text-white font-semibold"
              : "bg-white/[0.04] border-white/5 hover:bg-white/10 text-zinc-300"
          }`}
          title={isSleeping ? "Bangunkan Karsa" : "Tidurkan (0 FPS 0% VRAM)"}
        >
          <Moon className="w-3.5 h-3.5 text-indigo-400" />
          <span className="text-[11px]">{isSleeping ? "Sleeping" : "Sleep"}</span>
        </button>

        {/* Full Settings Modal Button */}
        <button
          type="button"
          onClick={onOpenFullSettings}
          className="p-1.5 rounded-xl bg-white/[0.06] hover:bg-white/15 text-zinc-300 hover:text-white transition-colors cursor-pointer flex-shrink-0"
          title="Buka Pengaturan Lengkap & API Keys"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>

      {/* 3. Status Feedback Banner */}
      {statusFeedback && (
        <div className="text-[10px] font-mono text-zinc-200 bg-white/10 px-2.5 py-0.5 rounded-lg text-center animate-fade-in truncate">
          {statusFeedback}
        </div>
      )}
    </div>
  );
};

export default SettingsSlide;
