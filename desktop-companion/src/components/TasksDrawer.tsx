import React, { useEffect, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { X, CheckSquare, Clock, Check, AlertCircle, Plus } from "lucide-react";

interface TasksDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  isDark?: boolean;
}

interface TaskItem {
  id: number;
  title: string;
  description: string | null;
  course: string | null;
  task_type: string;
  due_at: string | null;
  is_urgent: number;
  is_important: number;
  quadrant: string;
  status: string;
  created_at: string;
}

const QUADRANT_META: Record<
  string,
  { label: string; color: string; badge: string; desc: string }
> = {
  Q1_DO: {
    label: "Q1 • Segera Kerjakan",
    color: "border-rose-500/30 bg-rose-500/10 text-rose-400",
    badge: "Mendesak & Penting",
    desc: "Deadline mepet <= 48 jam",
  },
  Q2_SCHEDULE: {
    label: "Q2 • Jadwalkan Fokus",
    color: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    badge: "Penting, Belum Mendesak",
    desc: "Tugas strategis & skripsi",
  },
  Q3_DELEGATE: {
    label: "Q3 • Delegasikan / Cepat",
    color: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    badge: "Mendesak, Kurang Penting",
    desc: "Rutinitas harian",
  },
  Q4_ELIMINATE: {
    label: "Q4 • Tinjau Kembali",
    color: "border-zinc-500/30 bg-zinc-500/10 text-zinc-400",
    badge: "Rendah Prioritas",
    desc: "Bisa ditunda",
  },
};

export const TasksDrawer: React.FC<TasksDrawerProps> = ({
  isOpen,
  onClose,
  isDark = true,
}) => {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterQuad, setFilterQuad] = useState<string>("ALL");

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/tasks?status=todo");
      if (res.ok) {
        const data = await res.json();
        setTasks(data.tasks || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchTasks();
    }
  }, [isOpen, fetchTasks]);

  // Handle ESC key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleCompleteTask = async (id: number) => {
    try {
      const res = await fetch(`/api/v1/tasks/${id}/complete`, { method: "POST" });
      if (res.ok) {
        setTasks((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (e) {
      console.error(e);
    }
  };

  if (!isOpen) return null;

  const filteredTasks =
    filterQuad === "ALL"
      ? tasks
      : tasks.filter((t) => (t.quadrant || "Q2_SCHEDULE") === filterQuad);

  return createPortal(
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 pt-12 pb-6 bg-black/65 backdrop-blur-md overflow-hidden"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ type: "spring", stiffness: 360, damping: 28 }}
        className={`w-full max-w-[440px] h-[80vh] max-h-[620px] rounded-3xl overflow-hidden flex flex-col border shadow-2xl ${
          isDark
            ? "bg-[#18181B] border-white/10 text-zinc-100"
            : "bg-[#FAF9F6] border-zinc-200 text-zinc-900"
        }`}
        style={{
          boxShadow: isDark
            ? "0 24px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06)"
            : "0 24px 60px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05)",
        }}
      >
        {/* Header */}
        <div
          className={`px-5 py-4 flex items-center justify-between border-b ${
            isDark ? "border-white/5 bg-white/[0.02]" : "border-zinc-200/80 bg-black/[0.01]"
          }`}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <CheckSquare className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-semibold tracking-tight">Eisenhower Matrix @Todo</h2>
              <p className="text-[10px] text-zinc-400">
                {tasks.length} tugas aktif • Prioritas otomatis
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
              isDark ? "hover:bg-white/10 text-zinc-400" : "hover:bg-zinc-200 text-zinc-600"
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filter Pills */}
        <div
          className={`px-4 py-2 border-b flex items-center gap-1.5 overflow-x-auto text-[10px] font-medium ${
            isDark ? "border-white/5 bg-black/20" : "border-zinc-200/60 bg-zinc-100/50"
          }`}
        >
          {["ALL", "Q1_DO", "Q2_SCHEDULE", "Q3_DELEGATE", "Q4_ELIMINATE"].map((q) => {
            const isSelected = filterQuad === q;
            return (
              <button
                key={q}
                onClick={() => setFilterQuad(q)}
                className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer whitespace-nowrap ${
                  isSelected
                    ? isDark
                      ? "bg-white/15 text-white font-semibold"
                      : "bg-white text-zinc-900 font-semibold shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {q === "ALL" ? "Semua Kuadran" : q.replace("_", " ")}
              </button>
            );
          })}
        </div>

        {/* Task List */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5 text-xs">
          {loading && tasks.length === 0 ? (
            <div className="text-center py-10 text-zinc-400">Memuat tugas SQLite...</div>
          ) : filteredTasks.length === 0 ? (
            <div
              className={`p-8 rounded-2xl border text-center space-y-2 ${
                isDark ? "bg-white/[0.02] border-white/5" : "bg-white border-zinc-200/80"
              }`}
            >
              <CheckSquare className="w-7 h-7 text-zinc-400 mx-auto opacity-40" />
              <p className="text-xs font-medium text-zinc-400">
                {filterQuad === "ALL"
                  ? "Belum ada tugas kuliah tercatat"
                  : `Tidak ada tugas di ${filterQuad.replace("_", " ")}`}
              </p>
              <p className="text-[10px] text-zinc-500">
                Ketik misal <code className="text-amber-400">@Todo kumpul laprak jumat 17:00</code> di input Notch!
              </p>
            </div>
          ) : (
            filteredTasks.map((t) => {
              const qMeta = QUADRANT_META[t.quadrant || "Q2_SCHEDULE"] || QUADRANT_META["Q2_SCHEDULE"];
              return (
                <div
                  key={t.id}
                  className={`p-3 rounded-2xl border transition-all flex items-start gap-3 group ${
                    isDark ? "bg-white/[0.02] border-white/5 hover:border-white/10" : "bg-white border-zinc-200/80"
                  }`}
                >
                  <button
                    onClick={() => handleCompleteTask(t.id)}
                    title="Tandai selesai"
                    className={`w-5 h-5 mt-0.5 rounded-lg border flex items-center justify-center transition-all cursor-pointer flex-shrink-0 ${
                      isDark
                        ? "border-white/20 hover:border-emerald-400 hover:bg-emerald-500/15"
                        : "border-zinc-300 hover:border-emerald-500 hover:bg-emerald-50"
                    }`}
                  >
                    <Check className="w-3 h-3 text-transparent group-hover:text-emerald-500 transition-colors" />
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-xs tracking-tight">{t.title}</div>
                    {t.course && (
                      <div className="text-[10px] text-zinc-400 mt-0.5 font-medium">
                        Mata Kuliah: {t.course}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span
                        className={`text-[9px] px-1.5 py-0.2 rounded-md border font-medium ${qMeta.color}`}
                      >
                        {qMeta.badge}
                      </span>
                      {t.due_at && (
                        <span className="text-[10px] text-zinc-400 flex items-center gap-1 font-mono">
                          <Clock className="w-3 h-3" />
                          <span>{t.due_at}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  );
};
