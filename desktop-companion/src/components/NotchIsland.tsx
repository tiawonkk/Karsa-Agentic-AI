import React, { useState, useEffect, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { createPortal } from "react-dom";

import { NotchShell, ShellMode } from "./NotchShell";
import { IdleEyesView } from "./IdleEyesView";
import { CompactPillView } from "./CompactPillView";
import { SystemToastView, SystemToastData } from "./SystemToastView";
import { FloatingWidgets } from "./widgets/WidgetLayer";
import { ChatBridge } from "./widgets/ChatWidget";
import { useWaterReminder } from "./widgets/WaterWidget";
import { useWidgets } from "../context/WidgetsContext";
import { addFileToActiveNotebook, isNotebookFile } from "../lib/notebookApi";
import { useTheme } from "../context/ThemeContext";

import { WardrobeStudio } from "./WardrobeStudio";
import { SettingsModal, NotchSize } from "./SettingsModal";
import { HitlApprovalPill, PendingApprovalData } from "./HitlApprovalPill";
import { announceApprovalsChanged } from "./widgets/ApprovalsWidget";
import { RightAgenticDock } from "./RightAgenticDock";
import { IslandDeck } from "./IslandDeck";
import { FullAppStudioModal } from "./FullAppStudioModal";
import { KarsaStage } from "./KarsaStage";
import { OutfitItem, sanitizeOutfit, newItem } from "../lib/jelly";
import { useJellyMoodSync } from "../hooks/useJellyMoodSync";
import { FloatingPopupCard } from "./FloatingPopupCard";
import { ReceiptPreviewCard, isImageFile } from "./ReceiptPreviewCard";
import { PeekView } from "./PeekView";
import { currentProjectFolder } from "../stores/projectFolder";
import { useDashboard } from "../hooks/useDashboard";
import { SystemStatusProvider } from "../context/SystemStatusContext";

type ActivePopover = null | "SETTINGS" | "WARDROBE";

export const NotchIsland: React.FC = () => {
  // Mode state: 4-mode adaptive Dynamic Island (Defaults to Coucou Mascot Face when idle)
  const [shellMode, setShellMode] = useState<ShellMode>("IDLE_EYES");
  const [focusSearchTrigger, setFocusSearchTrigger] = useState<number>(0);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [toastData, setToastData] = useState<SystemToastData | null>(null);
  const prevModeRef = useRef<ShellMode>("IDLE_EYES");
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [islandWide, setIslandWide] = useState(false);
  const [isSleeping, setIsSleeping] = useState(false);
  const [activePopover, setActivePopover] = useState<ActivePopover>(null);
  const [directivePopup, setDirectivePopup] = useState<{
    title: string;
    badge?: string;
    badgeColor?: string;
    result: string;
  } | null>(null);

  // Appearance: the theme (light/dark/system) is owned by ThemeContext and drives the CSS variables
  const { themeMode, setThemeMode, isDark } = useTheme();
  const { openWidget } = useWidgets();
  const [stageOpen, setStageOpen] = useState(false);
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
  // What Karsa wears: presets + drawn accessories. localStorage is the quick cache, SQLite the source of truth.
  const [outfit, setOutfit] = useState<OutfitItem[]>(() => {
    try {
      const list = sanitizeOutfit(JSON.parse(localStorage.getItem("karsa_outfit_v2") || "null"));
      if (list.length) return list;
      const legacy = localStorage.getItem("karsa_active_accessory"); // the old single drawn accessory
      if (legacy && legacy.startsWith("data:image/png")) {
        const it = newItem("custom", legacy);
        if (it) return [it];
      }
    } catch (_) {}
    return [];
  });
  const outfitLoaded = useRef(false);

  // File drag & drop
  const [, setIsDraggingFile] = useState(false);

  // Real-time Dashboard Summary
  const { data: dashboard, refresh: refreshDashboard } = useDashboard(isSleeping);

  // Hover peek: the idle island grows to 220x40 with a greeting and today's Daily Safe Spend
  const peekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearPeekTimer = () => {
    if (peekTimerRef.current) clearTimeout(peekTimerRef.current);
    peekTimerRef.current = null;
  };
  const handlePeekEnter = () => {
    clearPeekTimer();
    if (isSleeping) return;
    if (shellMode === "IDLE_EYES" || shellMode === "COMPACT_PILL") {
      const underlying = shellMode;
      peekTimerRef.current = setTimeout(() => {
        prevModeRef.current = underlying;
        setShellMode("PEEK");
      }, 150);
    }
  };
  const handlePeekLeave = () => {
    clearPeekTimer();
    if (shellMode === "PEEK") {
      peekTimerRef.current = setTimeout(() => {
        setShellMode((m) => (m === "PEEK" ? (prevModeRef.current === "COMPACT_PILL" ? "COMPACT_PILL" : "IDLE_EYES") : m));
      }, 250);
    }
  };
  useEffect(() => clearPeekTimer, []);

  // Zero-Heat Sleep: collapse to the idle island, drop any peek/toast, and let the effects below stop pollers
  const handleSleepChange = (sleeping: boolean) => {
    setIsSleeping(sleeping);
    if (sleeping) {
      clearPeekTimer();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setShellMode("IDLE_EYES");
    }
  };

  // Chat conversation
  const [chatHistory, setChatHistory] = useState<Array<{ role: "user" | "assistant"; text: string }>>([
    {
      role: "assistant",
      text: "Halo! Aku Karsa. Ada yang bisa kubantu untuk tugas kuliah, catat jajan hari ini, atau riset paper?",
    },
  ]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  // Survives a page reload: a new id per load would orphan an approval still waiting on the old thread
  const [threadId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem("karsa_thread_id");
      if (saved) return saved;
      const fresh = `thread_${Date.now()}`;
      localStorage.setItem("karsa_thread_id", fresh);
      return fresh;
    } catch (_) {
      return `thread_${Date.now()}`;
    }
  });

  // HITL Approvals
  const [pendingApprovals, setPendingApprovals] = useState<PendingApprovalData[]>([]);

  useEffect(() => {
    localStorage.setItem("karsa_notch_size", notchSize);
  }, [notchSize]);

  useEffect(() => {
    localStorage.setItem("karsa_mascot_color", mascotColor);
  }, [mascotColor]);

  useEffect(() => {
    localStorage.setItem("karsa_eye_color", eyeColor);
  }, [eyeColor]);

  // Alt+K: invite Karsa to the screen (and back)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setStageOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Outfit: load the saved one from the backend once, then save every change (debounced)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/wardrobe/outfit")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled || !d) return;
        const saved = sanitizeOutfit(d.items);
        if (saved.length) setOutfit(saved);
      })
      .catch(() => {})
      .finally(() => {
        outfitLoaded.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("karsa_outfit_v2", JSON.stringify(outfit));
      localStorage.removeItem("karsa_active_accessory");
    } catch (_) {}
    if (!outfitLoaded.current) return;
    const t = setTimeout(() => {
      fetch("/api/v1/wardrobe/outfit", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: outfit }),
      }).catch(() => {});
    }, 450);
    return () => clearTimeout(t);
  }, [outfit]);


  // Helper to trigger hardware toast and auto-revert after 2.5 seconds to Coucou Mascot Face
  const triggerHardwareToast = (toast: SystemToastData) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (shellMode !== "SYSTEM_TOAST") {
      prevModeRef.current = shellMode;
    }
    setToastData(toast);
    setShellMode("SYSTEM_TOAST");
    toastTimerRef.current = setTimeout(() => {
      setShellMode("IDLE_EYES");
    }, 1800);
  };

  // Hardware OSD SSE Event Stream & Key Listeners (closed while asleep: no background watchers)
  useEffect(() => {
    if (isSleeping) return;
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

      // F1-F12 and media keys, read by the backend (only the key name; see KARSA_FKEY_OSD to turn this off)
      eventSource.addEventListener("osd://fkey", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          if (d.kind === "media") {
            triggerHardwareToast({ category: "media", title: d.key, subtitle: d.label, mediaKey: d.key });
          } else {
            triggerHardwareToast({ category: "fkey", title: d.label, subtitle: `Tombol fungsi ${d.key}`, keyName: d.key });
          }
        } catch (_) {}
      });

      eventSource.addEventListener("osd://bluetooth", (e: MessageEvent) => {
        try {
          const d = JSON.parse(e.data);
          triggerHardwareToast({
            category: "bluetooth",
            title: d.device || "Bluetooth Device",
            subtitle: d.connected ? (typeof d.battery_percent === "number" ? `Tersambung · baterai ${d.battery_percent}%` : "Tersambung") : "Terputus",
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
  }, [shellMode, isSleeping]);

  // Receipt photo chosen in the Finance workspace: same OCR preview as dropping it on the island
  useEffect(() => {
    const onReceipt = (e: Event) => {
      const f = (e as CustomEvent<File>).detail;
      if (f) setReceiptFile(f);
    };
    window.addEventListener("karsa:receipt-file", onReceipt);
    return () => window.removeEventListener("karsa:receipt-file", onReceipt);
  }, []);

  // Tray menu "Mode Tidur" (desktop shell)
  const isSleepingRef = useRef(isSleeping);
  isSleepingRef.current = isSleeping;
  useEffect(() => {
    const onToggle = () => handleSleepChange(!isSleepingRef.current);
    window.addEventListener("karsa:toggle-sleep", onToggle);
    return () => window.removeEventListener("karsa:toggle-sleep", onToggle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-outside listener & Escape shortcut
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global Shortcut: Alt + Space to open Omni-Search Bar in Dynamic Island
      if (e.altKey && (e.code === "Space" || e.key === " ")) {
        e.preventDefault();
        setShellMode("EXPANDED");
        setFocusSearchTrigger((prev) => prev + 1);
        return;
      }

      if (e.key === "Escape") {
        if (activePopover) {
          setActivePopover(null);
        } else if (shellMode === "EXPANDED") {
          setShellMode("IDLE_EYES");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [shellMode, activePopover]);

  // Poll for pending HITL approvals
  useEffect(() => {
    if (isSleeping) return;
    let cancelled = false;
    let timer: NodeJS.Timeout;
    const fetchApprovals = async () => {
      try {
        const res = await fetch("/api/v1/approvals/pending");
        if (res.ok) {
          const data = await res.json();
          setPendingApprovals(data.pending_approvals || []);
        }
      } catch (e) {
        // silent fail
      } finally {
        if (!cancelled) timer = setTimeout(fetchApprovals, 6000);
      }
    };
    fetchApprovals();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isSleeping]);

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
            const cmd = text.split(" ")[0];
            setDirectivePopup({
              title: `Hasil Direktif ${cmd}`,
              badge: "BERHASIL",
              badgeColor: "text-emerald-500 bg-emerald-500/10 border-emerald-500/30",
              result: parsed.execution_result,
            });
            refreshDashboard();
            return;
          }
        }
      } catch (e) {
        // proceed to assistant stream
      }
    }

    // 2. Open Chat Drawer and stream assistant response
    if (!stageOpen) openWidget("chat"); // the big Karsa shows the answer itself
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
          workspace_path: currentProjectFolder(), // the agent works in the folder the user chose
        }),
      });

      if (!response.ok) {
        let errDetail = "Koneksi ke backend gagal.";
        try {
          const errData = await response.json();
          errDetail = errData.detail || errData.error || errDetail;
        } catch (_) {}
        setChatHistory((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `⚠️ Gagal memanggil AI: ${errDetail}\nPeriksa status API key di menu Settings.`,
          },
        ]);
        return;
      }

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
              } else if (data.error) {
                assistantText += `\n⚠️ Error: ${data.error}`;
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

    if (isNotebookFile(file)) {
      // Research files (PDF/DOCX/PPTX/TXT/MD/CSV/XLSX) become sources of the active notebook
      addFileToActiveNotebook(file)
        .then(() => openWidget("notebook"))
        .catch((e) => setFeedbackToast(`⚠️ ${e instanceof Error ? e.message : "Gagal menambah sumber."}`));
    } else if (isImageFile(file)) {
      // Receipt photo: OCR into an editable preview; nothing is recorded until the user confirms
      setReceiptFile(file);
    } else {
      handleSubmit(`@Code periksa file ${file.name}`);
    }
  };

  // HITL decision
  const handleApprovalDecision = async (
    actionId: string,
    decision: "approve" | "edit" | "reject"
  ) => {
    // "Ubah Dulu" needs the parameter editor: hand over to the Approvals widget instead of sending an empty edit
    if (decision === "edit") {
      openWidget("approvals");
      return;
    }
    const approval = pendingApprovals.find((a) => a.action_id === actionId);
    try {
      await fetch(`/api/v1/threads/${encodeURIComponent(approval?.session_thread_id ?? threadId)}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action_id: actionId, decision, reviewer_id: "pengguna" }),
      });
      setPendingApprovals((prev) => prev.filter((a) => a.action_id !== actionId));
      announceApprovalsChanged();
      refreshDashboard();
    } catch (err) {
      console.error(err);
    }
  };

  useJellyMoodSync(isStreaming, [...chatHistory].reverse().find((m) => m.role === "assistant")?.text ?? "", pendingApprovals.length);

  const chat: ChatBridge = {
    messages: chatHistory,
    isStreaming,
    onSend: (text) => handleSubmit(text),
    onClear: () =>
      setChatHistory([
        { role: "assistant", text: "Halo! Riwayat percakapan telah dibersihkan. Ada yang bisa kubantu?" },
      ]),
  };

  // Hydration reminder runs even when the Water widget is closed (paused while asleep)
  useWaterReminder(isSleeping);

  return (
    <SystemStatusProvider onOpenSettings={() => setActivePopover("SETTINGS")} paused={isSleeping}>
      <div
        ref={containerRef}
      className="fixed top-0 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center select-none font-sans pointer-events-auto"
      onMouseEnter={handlePeekEnter}
      onMouseLeave={handlePeekLeave}
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
      <NotchShell mode={shellMode} isDark={isDark} calm={isSleeping} wide={islandWide}>
        {/* Mode 1: AI Glowing Eyes (190px x 38px) */}
        {shellMode === "IDLE_EYES" && (
          <div
            className="w-full h-full cursor-pointer flex items-center justify-center"
            onClick={() => {
              // First touch wakes a sleeping Karsa, then opens the deck
              if (isSleeping) setIsSleeping(false);
              prevModeRef.current = "IDLE_EYES";
              setShellMode("EXPANDED");
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setShellMode("COMPACT_PILL");
            }}
            title="Klik untuk membuka Carousel Deck, Dobel-klik untuk Jam & Waveform"
          >
            <IdleEyesView isDark={isDark} isSleeping={isSleeping} />
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
            <CompactPillView
              isDark={isDark}
              hasPendingApproval={pendingApprovals.length > 0}
            />
          </div>
        )}

        {/* Mode 2b: Hover Peek (220px x 40px) */}
        {shellMode === "PEEK" && (
          <div
            className="w-full h-full flex items-center"
            onClick={() => {
              clearPeekTimer();
              setShellMode("EXPANDED");
            }}
            title="Klik untuk membuka Carousel Deck"
          >
            <PeekView
              isDark={isDark}
              mascotColor={mascotColor}
              eyeColor={eyeColor}
              dailySafeSpendIdr={dashboard?.finance?.daily_safe_spend_idr ?? null}
            />
          </div>
        )}

        {/* Mode 3: Hardware System Toast (340px x 68px) */}
        {shellMode === "SYSTEM_TOAST" && toastData && (
          <SystemToastView
            toast={toastData}
            isDark={isDark}
            onClick={() => {
              if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
              setShellMode("EXPANDED");
            }}
          />
        )}

        {/* Mode 4: Expanded island = the 5 daily utility slides only (chat and the AI automations live in the right dock) */}
        {shellMode === "EXPANDED" && <IslandDeck chat={chat} onWide={setIslandWide} onCollapse={() => setShellMode(prevModeRef.current === "IDLE_EYES" ? "IDLE_EYES" : "COMPACT_PILL")} />}
      </NotchShell>

      {/* Right-side mini screen + floating widgets (unmounted while asleep: Zero-Heat) */}
      {!isSleeping &&
        createPortal(
        <>
          <RightAgenticDock
            chat={chat}
            onOpenSettings={() => setActivePopover("SETTINGS")}
            onOpenWardrobe={() => setActivePopover("WARDROBE")}
            isDark={isDark}
            mascotColor={mascotColor}
            eyeColor={eyeColor}
            outfit={outfit}
            isSleeping={isSleeping}
          />
          <FullAppStudioModal
            chat={chat}
            onOpenSettings={() => setActivePopover("SETTINGS")}
            onOpenWardrobe={() => setActivePopover("WARDROBE")}
            isDark={isDark}
            mascotColor={mascotColor}
            eyeColor={eyeColor}
            outfit={outfit}
            isSleeping={isSleeping}
          />
          <FloatingWidgets chat={chat} onOpenSettings={() => setActivePopover("SETTINGS")} />
          <KarsaStage
            open={stageOpen}
            onClose={() => setStageOpen(false)}
            chat={chat}
            approvals={pendingApprovals}
            onApprovalDecision={handleApprovalDecision}
            onDropFile={handleDropFiles}
            isDark={isDark}
            mascotColor={mascotColor}
            eyeColor={eyeColor}
            outfit={outfit}
          />
        </>,
        // portaled: the notch container has a transform, which would otherwise re-anchor `fixed` children to it
        document.body
      )}

      {/* Receipt OCR: editable preview, recorded only after the user confirms */}
      <ReceiptPreviewCard
        file={receiptFile}
        isDark={isDark}
        onClose={() => setReceiptFile(null)}
        onRecorded={() => refreshDashboard()}
      />

      {/* Minimalist Floating Pop-up Card for @Directives & Detailed Results (Rule 4) */}
      <FloatingPopupCard
        isOpen={directivePopup !== null}
        onClose={() => setDirectivePopup(null)}
        title={directivePopup?.title || "Hasil Direktif"}
        badge={directivePopup?.badge}
        badgeColor={directivePopup?.badgeColor}
        isDark={isDark}
      >
        <div className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-zinc-800 dark:text-zinc-200">
          {directivePopup?.result}
        </div>
      </FloatingPopupCard>

      {/* Popovers & Drawers */}
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
        isSleeping={isSleeping}
        onSleepChange={handleSleepChange}
        isDark={isDark}
      />

        <WardrobeStudio
          isOpen={activePopover === "WARDROBE"}
          onClose={() => setActivePopover(null)}
          currentColor={mascotColor}
          onColorChange={setMascotColor}
          currentEyeColor={eyeColor}
          onEyeColorChange={setEyeColor}
          outfit={outfit}
          onOutfitChange={setOutfit}
          isDark={isDark}
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
        {pendingApprovals.length > 0 && !stageOpen && (
          <div className="mt-2 space-y-2 max-w-md w-full">
            {/* One card at a time: its Enter/E/Esc shortcuts must never answer several approvals at once */}
            <HitlApprovalPill
              key={pendingApprovals[0].action_id}
              approval={pendingApprovals[0]}
              onDecision={handleApprovalDecision}
            />
            {pendingApprovals.length > 1 && (
              <button
                type="button"
                onClick={() => openWidget("approvals")}
                className="pointer-events-auto w-full text-center text-[11px] font-medium text-ink-2 hover:text-ink py-1 cursor-pointer"
              >
                +{pendingApprovals.length - 1} permintaan lain di widget Approvals
              </button>
            )}
          </div>
        )}
      </div>
    </SystemStatusProvider>
  );
};

export default NotchIsland;
