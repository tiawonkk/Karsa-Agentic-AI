import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";

import { NotchShell, ShellMode } from "./NotchShell";
import { IdleEyesView } from "./IdleEyesView";
import { CompactPillView } from "./CompactPillView";
import { SystemToastView, SystemToastData } from "./SystemToastView";
import { DynamicIslandDeck } from "./DynamicIslandDeck";

import { WardrobeStudio } from "./WardrobeStudio";
import { SettingsModal, ThemeMode, NotchSize } from "./SettingsModal";
import { FinanceReportDrawer } from "./FinanceReportDrawer";
import { TasksDrawer } from "./TasksDrawer";
import { ChatDrawer } from "./ChatDrawer";
import { HitlApprovalPill, PendingApprovalData } from "./HitlApprovalPill";
import { useDashboard } from "../hooks/useDashboard";

type ActivePopover = null | "REPORT" | "TASKS" | "CHAT" | "SETTINGS" | "WARDROBE";

export const NotchIsland: React.FC = () => {
  // Mode state: 4-mode adaptive Dynamic Island
  const [shellMode, setShellMode] = useState<ShellMode>("COMPACT_PILL");
  const [isLyricsExpanded, setIsLyricsExpanded] = useState(false);
  const [toastData, setToastData] = useState<SystemToastData | null>(null);
  const prevModeRef = useRef<ShellMode>("COMPACT_PILL");
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  // File drag & drop
  const [, setIsDraggingFile] = useState(false);

  // Real-time Dashboard Summary
  const { refresh: refreshDashboard } = useDashboard(isSleeping);

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

  // Helper to trigger hardware toast and auto-revert after 2 seconds
  const triggerHardwareToast = (toast: SystemToastData) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (shellMode !== "SYSTEM_TOAST") {
      prevModeRef.current = shellMode;
    }
    setToastData(toast);
    setShellMode("SYSTEM_TOAST");
    toastTimerRef.current = setTimeout(() => {
      setShellMode(prevModeRef.current || "COMPACT_PILL");
    }, 2000);
  };

  // Hardware OSD SSE Event Stream & Key Listeners
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/v1/system/osd/stream");

      eventSource.addEventListener("osd://lock-key", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          triggerHardwareToast({
            category: "capslock",
            title: d.key || "Caps Lock",
            subtitle: d.active ? "Key Active" : "Key Inactive",
            badge: d.active ? "ON" : "OFF",
          });
        } catch (_) {}
      });

      eventSource.addEventListener("osd://power", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          triggerHardwareToast({
            category: "charging",
            title: d.charging ? "Charging" : "Battery",
            subtitle: d.charging ? "Fast charger connected" : "Power unplugged",
            value: d.percent,
            badge: `${d.percent}%`,
          });
        } catch (_) {}
      });

      eventSource.addEventListener("osd://volume", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          triggerHardwareToast({
            category: "volume",
            title: "Volume",
            subtitle: d.muted ? "Muted" : `${d.level}% Master Audio`,
            value: d.level,
          });
        } catch (_) {}
      });

      eventSource.addEventListener("osd://brightness", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          triggerHardwareToast({
            category: "brightness",
            title: "Brightness",
            subtitle: "Built-in Display",
            value: d.level,
          });
        } catch (_) {}
      });

      eventSource.addEventListener("osd://bluetooth", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          triggerHardwareToast({
            category: "bluetooth",
            title: d.device || "Bluetooth Device",
            subtitle: d.connected ? "Connected" : "Disconnected",
          });
        } catch (_) {}
      });
    } catch (_) {}

    // Fallback key listener for CapsLock and NumLock
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "CapsLock") {
        const isCaps = e.getModifierState("CapsLock");
        triggerHardwareToast({
          category: "capslock",
          title: "Caps Lock",
          subtitle: isCaps ? "Key Active" : "Key Inactive",
          badge: isCaps ? "ON" : "OFF",
        });
      } else if (e.key === "NumLock") {
        const isNum = e.getModifierState("NumLock");
        triggerHardwareToast({
          category: "numlock",
          title: "Num Lock",
          subtitle: isNum ? "Key Active" : "Key Inactive",
          badge: isNum ? "ON" : "OFF",
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      if (eventSource) eventSource.close();
      window.removeEventListener("keydown", handleKeyDown);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, [shellMode]);

  // Click-outside listener & Escape shortcut
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activePopover) {
          setActivePopover(null);
        } else if (shellMode === "EXPANDED") {
          setShellMode(prevModeRef.current === "IDLE_EYES" ? "IDLE_EYES" : "COMPACT_PILL");
        }
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node) &&
        !activePopover
      ) {
        if (shellMode === "EXPANDED") {
          setShellMode(prevModeRef.current === "IDLE_EYES" ? "IDLE_EYES" : "COMPACT_PILL");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [shellMode, activePopover]);

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

  // Submit message: Checks for deterministic directives first (0-token execution)
  const handleSubmit = async (customText: string) => {
    const text = customText.trim();
    if (!text || isStreaming) return;

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
            setTimeout(() => {
              setFeedbackToast(null);
            }, 4000);
            refreshDashboard();
            return;
          }
        }
      } catch (e) {
        // proceed to assistant stream
      }
    }

    // 2. Open Chat Drawer and stream assistant response
    setActivePopover("CHAT");
    const newHistory = [...chatHistory, { role: "user" as const, text }];
    setChatHistory(newHistory);
    setIsStreaming(true);

    try {
      const response = await fetch("/api/v1/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          thread_id: threadId,
        }),
      });

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = "";

      setChatHistory((prev) => [...prev, { role: "assistant", text: "" }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
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

  // Drag & drop file handler
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
      {/* Dynamic Island V3 NotchShell Chassis with S-Curve Ears */}
      <NotchShell
        mode={shellMode}
        isLyricsExpanded={isLyricsExpanded}
        isDark={isDark}
      >
        {/* Mode 1: AI Glowing Eyes (190px x 38px) */}
        {shellMode === "IDLE_EYES" && (
          <div
            className="w-full h-full cursor-pointer flex items-center justify-center"
            onClick={() => {
              prevModeRef.current = "IDLE_EYES";
              setShellMode("EXPANDED");
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setShellMode("COMPACT_PILL");
            }}
            title="Klik untuk membuka Carousel Deck, Dobel-klik untuk Jam & Waveform"
          >
            <IdleEyesView isDark={isDark} />
          </div>
        )}

        {/* Mode 2: Compact Status Pill (210px x 38px) */}
        {shellMode === "COMPACT_PILL" && (
          <div
            className="w-full h-full cursor-pointer flex items-center justify-center"
            onClick={() => {
              prevModeRef.current = "COMPACT_PILL";
              setShellMode("EXPANDED");
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setShellMode("IDLE_EYES");
            }}
            title="Klik untuk membuka Carousel Deck, Dobel-klik untuk Mata AI"
          >
            <CompactPillView isDark={isDark} />
          </div>
        )}

        {/* Mode 3: Hardware System Toast (340px x 68px) */}
        {shellMode === "SYSTEM_TOAST" && toastData && (
          <SystemToastView toast={toastData} isDark={isDark} />
        )}

        {/* Mode 4: Expanded 5-Slide Carousel Deck (480px / 580px x 185px) */}
        {shellMode === "EXPANDED" && (
          <DynamicIslandDeck
            isDark={isDark}
            onLyricsToggle={(expanded) => setIsLyricsExpanded(expanded)}
            onSubmitMessage={handleSubmit}
            onCollapse={() =>
              setShellMode(prevModeRef.current === "IDLE_EYES" ? "IDLE_EYES" : "COMPACT_PILL")
            }
            onOpenChat={() => setActivePopover((prev) => (prev === "CHAT" ? null : "CHAT"))}
            onOpenSettings={() => setActivePopover((prev) => (prev === "SETTINGS" ? null : "SETTINGS"))}
          />
        )}
      </NotchShell>

      {/* Popovers & Drawers */}
      <FinanceReportDrawer
        isOpen={activePopover === "REPORT"}
        onClose={() => setActivePopover(null)}
        isDark={isDark}
      />

      <TasksDrawer
        isOpen={activePopover === "TASKS"}
        onClose={() => setActivePopover(null)}
        isDark={isDark}
      />

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

      {/* Floating Feedback Toast Notification */}
      <AnimatePresence>
        {feedbackToast && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={`mt-2 p-3 rounded-2xl border text-xs leading-relaxed whitespace-pre-wrap max-w-sm shadow-xl ${
              isDark
                ? "bg-emerald-950/90 border-emerald-500/40 text-emerald-200"
                : "bg-emerald-50 border-emerald-300 text-emerald-900 shadow-sm"
            }`}
          >
            {feedbackToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Pending HITL Approval Card */}
      {pendingApprovals.length > 0 && (
        <div className="mt-2 space-y-2 max-w-md w-full">
          {pendingApprovals.map((approval) => (
            <HitlApprovalPill
              key={approval.action_id}
              approval={approval}
              onDecision={handleApprovalDecision}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default NotchIsland;
