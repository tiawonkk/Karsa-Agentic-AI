import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

interface SystemStatusContextType {
  isApiConnected: boolean;
  connectedModel: string;
  activeBadge: string;
  geminiKey: string;
  deepseekKey: string;
  anthropicKey: string;
  isDbConnected: boolean;
  refreshStatus: () => Promise<void>;
  saveAndTestKey: (
    key: string,
    provider?: string
  ) => Promise<{ success: boolean; message: string; model?: string }>;
  focusApiKeyTrigger: number;
  openSettingsAndFocusKey: () => void;
}

const SystemStatusContext = createContext<SystemStatusContextType | null>(null);

export const SystemStatusProvider: React.FC<{
  children: React.ReactNode;
  onOpenSettings?: () => void;
  paused?: boolean;
}> = ({ children, onOpenSettings, paused = false }) => {
  const [isApiConnected, setIsApiConnected] = useState<boolean>(false);
  const [connectedModel, setConnectedModel] = useState<string>("None");
  const [activeBadge, setActiveBadge] = useState<string>("🔴 API Disconnected");
  const [geminiKey, setGeminiKey] = useState<string>("");
  const [deepseekKey, setDeepseekKey] = useState<string>("");
  const [anthropicKey, setAnthropicKey] = useState<string>("");
  const [isDbConnected, setIsDbConnected] = useState<boolean>(true);
  const [focusApiKeyTrigger, setFocusApiKeyTrigger] = useState<number>(0);

  const refreshStatus = useCallback(async () => {
    try {
      // 1. Fetch live keys and status from SQLite backend
      const resKeys = await fetch("/api/v1/settings/keys");
      if (resKeys.ok) {
        const data = await resKeys.json();
        setGeminiKey(data.gemini_api_key || "");
        setDeepseekKey(data.deepseek_api_key || "");
        setAnthropicKey(data.anthropic_api_key || "");

        const connected = Boolean(data.is_connected);
        setIsApiConnected(connected);
        setConnectedModel(data.connected_model || (connected ? "Gemini Flash" : "None"));
        setActiveBadge(data.badge_simple || (connected ? "🟢 Gemini Active" : "🔴 API Disconnected"));
        setIsDbConnected(Boolean(data.database?.connected ?? true));
        // what really works right now: a live 1-token ping per provider (cached 30 s by the backend)
        try {
          const live = await fetch("/api/health/models");
          if (live.ok) {
            const h = await live.json();
            setIsApiConnected(Boolean(h.ok));
            if (h.badge) setActiveBadge(h.badge);
            if (h.active) setConnectedModel(h.providers?.find((p: any) => p.id === h.active)?.label ?? h.active);
          }
        } catch (_) {}
      } else {
        // Fallback to /api/health/models
        const resHealth = await fetch("/api/health/models");
        if (resHealth.ok) {
          const hData = await resHealth.json();
          const connected = Boolean(hData.is_connected || hData.gemini?.connected || hData.deepseek?.connected);
          setIsApiConnected(connected);
          setConnectedModel(hData.connected_model || (connected ? "Gemini Flash" : "None"));
          setActiveBadge(hData.badge_simple || (connected ? "🟢 Gemini Active" : "🔴 API Disconnected"));
          setIsDbConnected(Boolean(hData.database?.connected ?? true));
        }
      }
    } catch (_) {
      setIsApiConnected(false);
      setConnectedModel("None");
      setActiveBadge("🔴 API Disconnected");
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    refreshStatus();
    const interval = setInterval(refreshStatus, 20000);
    return () => clearInterval(interval);
  }, [refreshStatus, paused]);

  const saveAndTestKey = async (
    key: string,
    provider: string = "gemini"
  ): Promise<{ success: boolean; message: string; model?: string }> => {
    try {
      const res = await fetch("/api/v1/settings/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider,
          api_key: key,
          gemini_api_key: provider === "gemini" ? key : undefined,
          deepseek_api_key: provider === "deepseek" ? key : undefined,
        }),
      });

      const data = await res.json();
      if (res.ok && data.status === "connected") {
        setIsApiConnected(true);
        setConnectedModel(data.model || "Gemini Flash");
        setActiveBadge("🟢 Gemini Active");
        if (provider === "gemini") setGeminiKey(key);
        else if (provider === "deepseek") setDeepseekKey(key);
        await refreshStatus();
        return { success: true, message: data.message, model: data.model };
      } else if (data.status === "disconnected") {
        setIsApiConnected(false);
        setActiveBadge("🔴 API Disconnected");
        setGeminiKey("");
        await refreshStatus();
        return { success: true, message: data.message };
      } else {
        return { success: false, message: data.message || "Gagal menghubungkan API Key." };
      }
    } catch (err: any) {
      return { success: false, message: err?.message || "Kesalahan jaringan saat menghubungi backend." };
    }
  };

  const openSettingsAndFocusKey = () => {
    if (onOpenSettings) onOpenSettings();
    setFocusApiKeyTrigger((prev) => prev + 1);
  };

  return (
    <SystemStatusContext.Provider
      value={{
        isApiConnected,
        connectedModel,
        activeBadge,
        geminiKey,
        deepseekKey,
        anthropicKey,
        isDbConnected,
        refreshStatus,
        saveAndTestKey,
        focusApiKeyTrigger,
        openSettingsAndFocusKey,
      }}
    >
      {children}
    </SystemStatusContext.Provider>
  );
};

export const useSystemStatus = () => {
  const ctx = useContext(SystemStatusContext);
  if (!ctx) {
    throw new Error("useSystemStatus must be used within a SystemStatusProvider");
  }
  return ctx;
};
