import React, { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Brush, Eraser, RotateCcw, Check, Palette, Sparkles, X } from "lucide-react";

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
  activeAccessory: string | null;
  onSelectAccessory: (dataUrl: string | null) => void;
}

const PRESET_BODY_COLORS = [
  "#FAF9F6", // Warm Paper
  "#D95D39", // Terracotta Solid
  "#3B7A57", // Sage Green
  "#E09F3E", // Honey Amber
  "#1A1917", // Obsidian Charcoal
  "#C47A74", // Dusty Rose
  "#6B7A82", // Mineral Slate
];

const PRESET_EYE_COLORS = [
  "#121212", // Obsidian Jet
  "#1E293B", // Deep Slate
  "#2E5F44", // Forest Sage
  "#782E1E", // Roasted Terracotta
];

export const WardrobeStudio: React.FC<WardrobeStudioProps> = ({
  isOpen,
  onClose,
  currentColor,
  onColorChange,
  currentEyeColor,
  onEyeColorChange,
  activeAccessory,
  onSelectAccessory,
}) => {
  const [tab, setTab] = useState<"colors" | "draw" | "closet">("colors");

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

  // Save accessories to local storage
  const saveAccessories = (newItems: AccessoryItem[]) => {
    setAccessories(newItems);
    localStorage.setItem("karsa_wardrobe_items", JSON.stringify(newItems));
  };

  // Initialize or clear the drawing canvas
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

  // Drawing mouse handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Save history frame before drawing
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
      name: accessoryName.trim() || `Aksesoris #${accessories.length + 1}`,
      dataUrl,
      createdAt: Date.now(),
    };

    const updated = [newItem, ...accessories];
    saveAccessories(updated);
    onSelectAccessory(dataUrl);
    setAccessoryName("");
    setTab("closet");
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
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-12 pb-6 bg-black/75 backdrop-blur-md"
    >
      <div className="w-full max-w-md p-5 bg-[#121212] border border-white/8 rounded-2xl shadow-tactile-lifted text-[#FAF9F6] flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-white/8">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-[#D95D39]" />
            <h2 className="font-editorial text-xl tracking-tight text-[#FAF9F6]">Wardrobe & Studio</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-1 p-1 mt-3 bg-[#1A1917] rounded-xl border border-white/5">
          <button
            onClick={() => setTab("colors")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${
              tab === "colors" ? "bg-[#D95D39] text-white shadow-tactile-rest" : "text-neutral-400 hover:text-white"
            }`}
          >
            Warna Maskot
          </button>
          <button
            onClick={() => setTab("draw")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${
              tab === "draw" ? "bg-[#D95D39] text-white shadow-tactile-rest" : "text-neutral-400 hover:text-white"
            }`}
          >
            ✏️ Kanvas Gambar
          </button>
          <button
            onClick={() => setTab("closet")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition ${
              tab === "closet" ? "bg-[#D95D39] text-white shadow-tactile-rest" : "text-neutral-400 hover:text-white"
            }`}
          >
            Koleksi ({accessories.length})
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto py-3">
          {tab === "colors" && (
            <div className="space-y-4">
              <div>
                <label className="text-xs text-neutral-400 block mb-2 font-medium">Warna Tubuh Maskot:</label>
                <div className="flex flex-wrap gap-2 items-center">
                  {PRESET_BODY_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => onColorChange(c)}
                      style={{ backgroundColor: c }}
                      className={`w-8 h-8 rounded-full border-2 transition-transform ${
                        currentColor === c ? "border-white scale-110 shadow-lg" : "border-transparent hover:scale-105"
                      }`}
                    />
                  ))}
                  <input
                    type="color"
                    value={currentColor}
                    onChange={(e) => onColorChange(e.target.value)}
                    className="w-8 h-8 rounded-full cursor-pointer bg-transparent border-0"
                    title="Pilih warna custom"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-neutral-400 block mb-2 font-medium">Warna Mata / Pupil:</label>
                <div className="flex gap-2 items-center">
                  {PRESET_EYE_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => onEyeColorChange(c)}
                      style={{ backgroundColor: c }}
                      className={`w-7 h-7 rounded-full border-2 transition-transform ${
                        currentEyeColor === c ? "border-white scale-110" : "border-transparent hover:scale-105"
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {tab === "draw" && (
            <div className="flex flex-col items-center">
              <p className="text-[11px] text-neutral-400 mb-2 text-center">
                Gambar topi, kacamata, atau pita impianmu! Aksesoris akan menempel di kepala maskot secara dinamis.
              </p>

              {/* Drawing Canvas Container with Ghost Mascot Guide */}
              <div className="relative w-56 h-56 rounded-xl border border-neutral-700 bg-neutral-950/80 shadow-inner overflow-hidden cursor-crosshair">
                {/* Ghost Template Silhouette */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-15">
                  <div className="w-28 h-28 rounded-[24px] border-2 border-white flex flex-col items-center justify-center">
                    <span className="text-[10px] text-white">Area Kepala</span>
                  </div>
                </div>

                <canvas
                  ref={drawCanvasRef}
                  width={256}
                  height={256}
                  className="w-full h-full relative z-10"
                  onMouseDown={startDrawing}
                  onMouseMove={draw}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                />
              </div>

              {/* Drawing Toolbar */}
              <div className="flex items-center gap-3 mt-3 p-2 bg-neutral-800/80 rounded-xl border border-neutral-700 text-xs">
                <button
                  onClick={() => setTool("pen")}
                  className={`p-1.5 rounded-lg ${tool === "pen" ? "bg-sky-500 text-white" : "text-neutral-400 hover:text-white"}`}
                  title="Kuas / Pen"
                >
                  <Brush className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setTool("eraser")}
                  className={`p-1.5 rounded-lg ${tool === "eraser" ? "bg-sky-500 text-white" : "text-neutral-400 hover:text-white"}`}
                  title="Penghapus"
                >
                  <Eraser className="w-4 h-4" />
                </button>
                <button
                  onClick={handleUndo}
                  className="p-1.5 text-neutral-400 hover:text-white rounded-lg"
                  title="Undo"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <div className="h-4 w-px bg-neutral-700" />

                <input
                  type="color"
                  value={brushColor}
                  onChange={(e) => setBrushColor(e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border-0 bg-transparent"
                />

                <input
                  type="range"
                  min={1}
                  max={16}
                  value={brushSize}
                  onChange={(e) => setBrushSize(parseInt(e.target.value))}
                  className="w-16 h-1 accent-sky-400"
                  title={`Ukuran Kuas: ${brushSize}px`}
                />
              </div>

              {/* Name & Save */}
              <div className="flex gap-2 w-full mt-3">
                <input
                  type="text"
                  placeholder="Beri nama aksesoris..."
                  value={accessoryName}
                  onChange={(e) => setAccessoryName(e.target.value)}
                  className="flex-1 px-3 py-1.5 text-xs bg-neutral-800 border border-neutral-700 rounded-lg text-white outline-none focus:border-sky-500"
                />
                <button
                  onClick={handleSaveDrawnAccessory}
                  className="px-4 py-1.5 text-xs font-medium bg-sky-500 hover:bg-sky-400 rounded-lg text-white flex items-center gap-1 transition"
                >
                  <Check className="w-3.5 h-3.5" /> Pakai
                </button>
              </div>
            </div>
          )}

          {tab === "closet" && (
            <div className="space-y-3">
              <div className="flex justify-between items-center text-xs">
                <span className="text-neutral-400">Pilih aksesoris untuk dikenakan:</span>
                {activeAccessory && (
                  <button
                    onClick={() => onSelectAccessory(null)}
                    className="text-red-400 hover:underline text-[11px]"
                  >
                    Lepas Aksesoris
                  </button>
                )}
              </div>

              {accessories.length === 0 ? (
                <div className="p-6 text-center text-neutral-500 text-xs">
                  Belum ada aksesoris buatanmu. Buka tab <strong>Draw Accessory Pad</strong> untuk menggambar!
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {accessories.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => onSelectAccessory(item.dataUrl)}
                      className={`p-2 rounded-xl border flex flex-col items-center gap-1 cursor-pointer transition ${
                        activeAccessory === item.dataUrl
                          ? "border-sky-400 bg-sky-500/10 shadow"
                          : "border-neutral-800 bg-neutral-800/40 hover:border-neutral-700"
                      }`}
                    >
                      <div className="w-14 h-14 bg-neutral-900 rounded-lg flex items-center justify-center p-1">
                        <img src={item.dataUrl} alt={item.name} className="max-w-full max-h-full object-contain" />
                      </div>
                      <span className="text-[10px] text-neutral-300 truncate w-full text-center">
                        {item.name}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-neutral-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs bg-neutral-800 hover:bg-neutral-700 rounded-lg text-neutral-300 transition"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
