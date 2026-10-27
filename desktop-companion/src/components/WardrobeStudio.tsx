import React, { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Brush, Eraser, RotateCcw, Check, Sparkles, X, Pin, Minus, Maximize2, Trash2 } from "lucide-react";
import { MascotCanvas } from "./MascotCanvas";
import { MAX_OUTFIT_ITEMS, OutfitItem, PRESETS, PRESET_IDS, drawOutfit, newItem } from "../lib/jelly";

export interface AccessoryItem {
  id: string;
  name: string;
  dataUrl: string;
  createdAt: number;
}

interface WardrobeStudioProps {
  isOpen: boolean;
  onClose: () => void;
  currentColor: string;
  onColorChange: (color: string) => void;
  currentEyeColor: string;
  onEyeColorChange: (color: string) => void;
  outfit: OutfitItem[];
  onOutfitChange: (items: OutfitItem[]) => void;
  isDark?: boolean;
}

const PRESET_BODY_COLORS = [
  "#FAF9F6", // Warm Paper
  "#D95D39", // Terracotta Solid
  "#3B7A57", // Sage Green
  "#E09F3E", // Honey Amber
  "#1A1917", // Obsidian Charcoal
  "#38bdf8", // Sky Blue
  "#C47A74", // Dusty Rose
];

const PRESET_EYE_COLORS = [
  "#121212", // Obsidian Jet
  "#1E293B", // Deep Slate
  "#2E5F44", // Forest Sage
  "#782E1E", // Roasted Terracotta
];

/** Small canvas preview of one preset (drawn with the same code that dresses Karsa). */
const THUMB: Record<string, { y: number; s: number }> = {
  party_hat: { y: 0.46, s: 0.95 }, crown: { y: 0.05, s: 1.45 }, bow: { y: 0, s: 1.2 }, glasses: { y: 0, s: 1.15 },
  shades: { y: 0, s: 1.15 }, headphones: { y: 0.05, s: 0.62 }, flower: { y: 0, s: 1.5 }, halo: { y: 0, s: 1.5 },
  wizard_hat: { y: 0.45, s: 0.9 }, scarf: { y: -0.05, s: 1.0 }, mustache: { y: 0, s: 1.7 }, star: { y: 0, s: 1.7 },
};
const PresetThumb: React.FC<{ kind: string }> = ({ kind }) => {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.save();
    ctx.translate(c.width / 2, c.height / 2);
    const t = THUMB[kind] ?? { y: 0, s: 1 };
    drawOutfit(ctx, 17, [{ id: "t", kind, x: 0, y: t.y, s: t.s, rot: 0, color: PRESETS[kind].defaults.color }], () => null);
    ctx.restore();
  }, [kind]);
  return <canvas ref={ref} width={52} height={40} className="w-[52px] h-[40px] rounded-lg bg-white/85" />;
};

export const WardrobeStudio: React.FC<WardrobeStudioProps> = ({
  isOpen,
  onClose,
  currentColor,
  onColorChange,
  currentEyeColor,
  onEyeColorChange,
  outfit,
  onOutfitChange,
  isDark = true,
}) => {
  const [tab, setTab] = useState<"outfit" | "colors" | "draw" | "closet">("outfit");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = outfit.find((i) => i.id === selectedId) ?? null;

  const wear = (kind: string, src?: string) => {
    if (outfit.length >= MAX_OUTFIT_ITEMS) return;
    if (kind === "custom" && outfit.filter((i) => i.kind === "custom").length >= 3) return;
    const it = newItem(kind, src);
    if (!it) return;
    onOutfitChange([...outfit, it]);
    setSelectedId(it.id);
  };
  const takeOff = (id: string) => {
    onOutfitChange(outfit.filter((i) => i.id !== id));
    if (selectedId === id) setSelectedId(null);
  };
  const patchItem = (id: string, patch: Partial<OutfitItem>) =>
    onOutfitChange(outfit.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const togglePreset = (kind: string) => {
    const worn = outfit.find((i) => i.kind === kind);
    if (worn) takeOff(worn.id);
    else wear(kind);
  };
  const [isPinned, setIsPinned] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Drawing Pad state
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [brushColor, setBrushColor] = useState("#fbbf24");
  const [brushSize, setBrushSize] = useState(4);
  const [accessoryName, setAccessoryName] = useState("");
  const historyStack = useRef<ImageData[]>([]);

  // Saved items list
  const [accessories, setAccessories] = useState<AccessoryItem[]>(() => {
    const saved = localStorage.getItem("karsa_wardrobe_items");
    return saved ? JSON.parse(saved) : [];
  });

  // Fetch accessories from SQLite on mount
  useEffect(() => {
    const fetchSqliteAccessories = async () => {
      try {
        const res = await fetch("/api/v1/wardrobe/items");
        if (res.ok) {
          const data = await res.json();
          if (data.items && data.items.length > 0) {
            const formatted: AccessoryItem[] = data.items.map((i: any) => ({
              id: i.id,
              name: i.name,
              dataUrl: i.data_url,
              createdAt: new Date(i.created_at).getTime(),
            }));
            setAccessories(formatted);
            localStorage.setItem("karsa_wardrobe_items", JSON.stringify(formatted));
          }
        }
      } catch (_) {}
    };
    fetchSqliteAccessories();
  }, []);

  const clearDrawPad = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    historyStack.current = [];
  };

  useEffect(() => {
    if (tab === "draw") {
      clearDrawPad();
    }
  }, [tab]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const currentFrame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (historyStack.current.length >= 20) historyStack.current.shift();
    historyStack.current.push(currentFrame);

    setIsDrawing(true);
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    ctx.lineWidth = brushSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = brushColor;
    }

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const handleUndo = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas || historyStack.current.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const previous = historyStack.current.pop();
    if (previous) {
      ctx.putImageData(previous, 0, 0);
    }
  };

  const handleSaveDrawnAccessory = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");

    const newItem: AccessoryItem = {
      id: `acc_${Date.now()}`,
      name: accessoryName.trim() || `Koleksi #${accessories.length + 1}`,
      dataUrl,
      createdAt: Date.now(),
    };

    const updated = [newItem, ...accessories];
    setAccessories(updated);
    localStorage.setItem("karsa_wardrobe_items", JSON.stringify(updated));
    wear("custom", dataUrl);

    fetch("/api/v1/wardrobe/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newItem.id,
        name: newItem.name,
        data_url: newItem.dataUrl,
      }),
    }).catch(() => {});

    setAccessoryName("");
    setTab("closet");
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isPinned) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, isPinned]);

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isMinimized ? (
        /* Floating Mini-Widget */
        <motion.div
          key="minimized-wardrobe-widget"
          drag
          dragMomentum={false}
          initial={{ opacity: 0, scale: 0.85, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.85, y: -8 }}
          transition={{ type: "spring", stiffness: 420, damping: 25 }}
          className={`fixed top-12 left-24 z-50 w-[128px] h-[36px] rounded-full flex items-center justify-between px-3 cursor-grab active:cursor-grabbing select-none pointer-events-auto border backdrop-blur-2xl shadow-lg ${
            isDark
              ? "bg-zinc-950/90 border-white/10 text-zinc-100 shadow-[0_12px_28px_rgba(0,0,0,0.6)]"
              : "bg-white/90 border-slate-200/80 text-slate-900 shadow-[0_12px_28px_rgba(15,23,42,0.12)]"
          }`}
          onClick={() => setIsMinimized(false)}
          title="Tarik untuk memindahkan • Klik untuk membuka Wardrobe"
        >
          <div className="flex items-center gap-1.5 overflow-hidden">
            <Sparkles className="w-3 h-3 text-pink-400 flex-shrink-0" />
            <span className="text-xs font-semibold tracking-tight truncate">Wardrobe</span>
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
        /* Compact Draggable Floating Wardrobe Card (330px × 380px max) */
        <motion.div
          key="floating-wardrobe-card"
          drag
          dragMomentum={false}
          initial={{ opacity: 0, scale: 0.94, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94, y: 10 }}
          transition={{ type: "spring", stiffness: 380, damping: 28 }}
          className={`fixed top-12 left-24 z-50 w-[335px] max-w-[calc(100vw-1.5rem)] h-[480px] max-h-[88vh] rounded-[28px] flex flex-col pointer-events-auto border backdrop-blur-2xl select-none overflow-hidden karsa-surface`}
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
                <Sparkles className="w-3 h-3 text-pink-400" />
              </div>
              <h2 className="text-[11.5px] font-semibold tracking-tight truncate">
                Wardrobe & Studio
              </h2>
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

          {/* Navigation Tabs */}
          <div
            className={`px-3 py-1.5 flex items-center gap-1 border-b text-[11px] font-medium flex-shrink-0 ${
              isDark ? "border-white/10 bg-black/20" : "border-slate-200/80 bg-slate-100/40"
            }`}
          >
            <button
              onClick={() => setTab("outfit")}
              className={`px-2 py-1 rounded-md flex-1 text-center transition-all cursor-pointer ${
                tab === "outfit"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Aksesori
            </button>
            <button
              onClick={() => setTab("colors")}
              className={`px-2.5 py-1 rounded-md flex-1 text-center transition-all cursor-pointer ${
                tab === "colors"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Warna
            </button>
            <button
              onClick={() => setTab("draw")}
              className={`px-2.5 py-1 rounded-md flex-1 text-center transition-all cursor-pointer ${
                tab === "draw"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              ✏️ Gambar
            </button>
            <button
              onClick={() => setTab("closet")}
              className={`px-2.5 py-1 rounded-md flex-1 text-center transition-all cursor-pointer ${
                tab === "closet"
                  ? isDark
                    ? "bg-white/15 text-white shadow-xs"
                    : "bg-white text-slate-900 shadow-xs border border-slate-200/80"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              Koleksi
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto p-3 text-xs">
            {tab === "outfit" && (
              <div className="space-y-2.5">
                <div className="sticky top-0 z-10 flex justify-center items-center h-[112px] rounded-2xl bg-card border border-subtle overflow-hidden">
                  <MascotCanvas
                    size={52}
                    bodyColor={currentColor}
                    eyeColor={currentEyeColor}
                    outfit={outfit}
                    isDark={isDark}
                    showStarOrbit={false}
                    mood="idle"
                    passThrough
                  />
                </div>

                <div className="grid grid-cols-4 gap-1.5">
                  {PRESET_IDS.map((id) => {
                    const worn = outfit.some((i) => i.kind === id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => togglePreset(id)}
                        title={PRESETS[id].label}
                        aria-pressed={worn}
                        className={`rounded-xl border p-1 flex flex-col items-center gap-0.5 cursor-pointer transition active:scale-95 ${
                          worn ? "border-accent bg-accent/10" : "border-subtle bg-pill/50 hover:border-strong"
                        }`}
                      >
                        <PresetThumb kind={id} />
                        <span className="text-[9px] leading-tight truncate w-full text-center">{PRESETS[id].label}</span>
                      </button>
                    );
                  })}
                </div>

                {outfit.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      {outfit.map((it) => (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => setSelectedId(it.id === selectedId ? null : it.id)}
                          className={`h-6 px-2 rounded-full text-[10px] font-semibold cursor-pointer ${
                            it.id === selectedId ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"
                          }`}
                        >
                          {it.kind === "custom" ? "🎨 Gambar" : `${PRESETS[it.kind].emoji} ${PRESETS[it.kind].label}`}
                        </button>
                      ))}
                      <button type="button" onClick={() => (onOutfitChange([]), setSelectedId(null))} className="h-6 px-2 rounded-full text-[10px] text-rose-400 hover:underline cursor-pointer">
                        Lepas semua
                      </button>
                    </div>

                    {selected && (
                      <div className="rounded-xl border border-subtle p-2 space-y-1.5">
                        {(
                          [
                            ["Geser kiri-kanan", "x", -2.5, 2.5, 0.02],
                            ["Naik-turun", "y", -2.5, 2.5, 0.02],
                            ["Ukuran", "s", 0.2, 3, 0.02],
                            ["Putar", "rot", -180, 180, 1],
                          ] as const
                        ).map(([label, key, lo, hi, step]) => (
                          <label key={key} className="flex items-center gap-2 text-[10px] text-zinc-400">
                            <span className="w-20 flex-shrink-0">{label}</span>
                            <input
                              type="range"
                              min={lo}
                              max={hi}
                              step={step}
                              value={selected[key]}
                              onChange={(e) => patchItem(selected.id, { [key]: Number(e.target.value) } as Partial<OutfitItem>)}
                              className="flex-1 accent-[var(--accent-primary)]"
                              aria-label={label}
                            />
                          </label>
                        ))}
                        <div className="flex items-center gap-2 pt-0.5">
                          {selected.kind !== "custom" && (
                            <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                              Warna
                              <input type="color" value={selected.color} onChange={(e) => patchItem(selected.id, { color: e.target.value })} className="w-6 h-6 rounded cursor-pointer bg-transparent border-0" />
                            </label>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const d = selected.kind === "custom" ? { x: 0, y: -0.95, s: 1.2, rot: 0 } : PRESETS[selected.kind].defaults;
                              patchItem(selected.id, { x: d.x, y: d.y, s: d.s, rot: d.rot });
                            }}
                            className="ml-auto text-[10px] text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" /> Posisi awal
                          </button>
                          <button type="button" onClick={() => takeOff(selected.id)} className="text-[10px] text-rose-400 hover:underline flex items-center gap-1 cursor-pointer">
                            <Trash2 className="w-3 h-3" /> Lepas
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[9.5px] text-zinc-500">Maksimal {MAX_OUTFIT_ITEMS} aksesori. Pilihan tersimpan otomatis dan ikut tampil di Karsa versi besar.</p>
              </div>
            )}

            {tab === "colors" && (
              <div className="space-y-3">
                <div>
                  <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                    Warna Tubuh Maskot:
                  </label>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {PRESET_BODY_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => onColorChange(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full border transition-all cursor-pointer ${
                          currentColor === c
                            ? "ring-2 ring-indigo-400 scale-110"
                            : "hover:scale-105 border-white/20"
                        }`}
                      />
                    ))}
                    <input
                      type="color"
                      value={currentColor}
                      onChange={(e) => onColorChange(e.target.value)}
                      className="w-6 h-6 rounded-full cursor-pointer bg-transparent border-0"
                      title="Warna khusus"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-medium text-zinc-400 block mb-1.5">
                    Warna Mata / Pupil:
                  </label>
                  <div className="flex gap-2 items-center">
                    {PRESET_EYE_COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={() => onEyeColorChange(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full border transition-all cursor-pointer ${
                          currentEyeColor === c
                            ? "ring-2 ring-indigo-400 scale-110"
                            : "hover:scale-105 border-white/20"
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "draw" && (
              <div className="flex flex-col items-center space-y-2">
                <div
                  className={`relative w-44 h-44 rounded-xl border overflow-hidden cursor-crosshair shadow-inner ${
                    isDark ? "bg-black/60 border-white/10" : "bg-slate-50 border-slate-200"
                  }`}
                >
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-20">
                    <div className="w-24 h-24 rounded-2xl border-2 border-indigo-400 flex items-center justify-center">
                      <span className="text-[9px] font-mono text-zinc-400">Kepala</span>
                    </div>
                  </div>
                  <canvas
                    ref={drawCanvasRef}
                    width={200}
                    height={200}
                    className="w-full h-full relative z-10"
                    onMouseDown={startDrawing}
                    onMouseMove={draw}
                    onMouseUp={stopDrawing}
                    onMouseLeave={stopDrawing}
                  />
                </div>

                {/* Toolbar */}
                <div
                  className={`flex items-center gap-2 p-1.5 rounded-lg border text-xs ${
                    isDark ? "bg-white/[0.04] border-white/10" : "bg-slate-100 border-slate-200"
                  }`}
                >
                  <button
                    onClick={() => setTool("pen")}
                    className={`p-1 rounded ${
                      tool === "pen" ? "bg-indigo-500 text-white" : "text-zinc-400"
                    }`}
                  >
                    <Brush className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setTool("eraser")}
                    className={`p-1 rounded ${
                      tool === "eraser" ? "bg-indigo-500 text-white" : "text-zinc-400"
                    }`}
                  >
                    <Eraser className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={handleUndo} className="p-1 text-zinc-400 hover:text-white">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="color"
                    value={brushColor}
                    onChange={(e) => setBrushColor(e.target.value)}
                    className="w-5 h-5 rounded cursor-pointer border-0 bg-transparent"
                  />
                </div>

                <div className="flex gap-1.5 w-full">
                  <input
                    type="text"
                    placeholder="Nama aksesoris..."
                    value={accessoryName}
                    onChange={(e) => setAccessoryName(e.target.value)}
                    className={`flex-1 px-2.5 py-1 text-xs rounded-lg border outline-none ${
                      isDark
                        ? "bg-white/[0.06] border-white/10 text-zinc-100 placeholder:text-zinc-500"
                        : "bg-white border-slate-200 text-slate-900 placeholder:text-slate-400"
                    }`}
                  />
                  <button
                    onClick={handleSaveDrawnAccessory}
                    className="px-3 py-1 text-xs font-semibold btn-warm-sunrise text-white rounded-lg flex items-center gap-1 cursor-pointer"
                  >
                    <Check className="w-3 h-3" /> Pakai
                  </button>
                </div>
              </div>
            )}

            {tab === "closet" && (
              <div className="space-y-2">
                <div className="flex justify-between items-center text-[11px]">
                  <span className="text-zinc-400">Pilih aksesoris tersimpan:</span>
                  {outfit.some((i) => i.kind === "custom") && (
                    <button
                      onClick={() => onOutfitChange(outfit.filter((i) => i.kind !== "custom"))}
                      className="text-rose-400 hover:underline text-[10px] cursor-pointer"
                    >
                      Lepas gambarku
                    </button>
                  )}
                </div>

                {accessories.length === 0 ? (
                  <div className="p-4 text-center text-zinc-400 text-xs font-mono">
                    Belum ada aksesoris. Buka tab <strong>Gambar</strong> untuk membuat baru!
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1.5">
                    {accessories.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          const worn = outfit.find((i) => i.src === item.dataUrl);
                          if (worn) takeOff(worn.id);
                          else wear("custom", item.dataUrl);
                        }}
                        className={`p-1.5 rounded-lg border flex flex-col items-center gap-1 cursor-pointer transition ${
                          outfit.some((i) => i.src === item.dataUrl)
                            ? "border-indigo-400 bg-indigo-500/10 shadow-xs"
                            : isDark
                            ? "border-white/10 bg-white/[0.03] hover:border-white/20"
                            : "border-slate-200 bg-slate-50 hover:border-slate-300"
                        }`}
                      >
                        <div className="w-12 h-12 rounded flex items-center justify-center p-0.5">
                          <img
                            src={item.dataUrl}
                            alt={item.name}
                            className="max-w-full max-h-full object-contain"
                          />
                        </div>
                        <span className="text-[9.5px] truncate w-full text-center">{item.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};
