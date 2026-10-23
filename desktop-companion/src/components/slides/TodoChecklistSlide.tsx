import React, { useState, useEffect } from "react";
import { CheckSquare, Square, Plus, CheckCircle2, AlertCircle } from "lucide-react";

interface TaskItem {
  id: number;
  title: string;
  eisenhower_quadrant?: string; // Q1, Q2, Q3, Q4
  is_completed?: boolean | number;
  deadline?: string;
}

interface TodoChecklistSlideProps {
  isDark: boolean;
  onAddTaskPrompt: (prompt: string) => void;
}

export const TodoChecklistSlide: React.FC<TodoChecklistSlideProps> = ({
  isDark,
  onAddTaskPrompt,
}) => {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const fetchTasks = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/v1/tasks?limit=10");
      if (res.ok) {
        const data = await res.json();
        // Sort: non-completed first, then by quadrant Q1 -> Q2 -> Q3 -> Q4
        const sorted = (data.tasks || []).sort((a: TaskItem, b: TaskItem) => {
          if (a.is_completed !== b.is_completed) {
            return Number(a.is_completed) - Number(b.is_completed);
          }
          return (a.eisenhower_quadrant || "Q4").localeCompare(b.eisenhower_quadrant || "Q4");
        });
        setTasks(sorted);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleToggleComplete = async (taskId: number, currentCompleted: boolean) => {
    try {
      // Optimistic update
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, is_completed: !currentCompleted } : t))
      );

      await fetch(`/api/v1/tasks/${taskId}/complete`, { method: "POST" });
      fetchTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAddTaskPrompt(`@Todo ${newTitle.trim()}`);
    setNewTitle("");
  };

  const getQuadrantBadge = (quadrant?: string) => {
    switch (quadrant) {
      case "Q1":
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">Q1 Urgent</span>;
      case "Q2":
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">Q2 Focus</span>;
      case "Q3":
        return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">Q3 Deleg</span>;
      default:
        return <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-zinc-400">Q4</span>;
    }
  };

  return (
    <div
      className={`w-full rounded-2xl p-3.5 transition-colors flex flex-col justify-between ${
        isDark ? "bg-[#0c0c0e] border border-white/8" : "bg-white border border-zinc-200 shadow-sm"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between text-xs mb-1.5">
        <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
          <CheckSquare className="w-4 h-4" />
          <span>Eisenhower Checklist</span>
        </div>
        <span className="text-[10px] font-mono text-zinc-400">
          {tasks.filter((t) => !t.is_completed).length} tugas aktif
        </span>
      </div>

      {/* Checklist items list */}
      <div className="max-h-[92px] overflow-y-auto space-y-1 pr-1">
        {tasks.length === 0 ? (
          <div className="py-4 text-center text-zinc-500 text-xs">
            Belum ada tugas kuliah. Ketik di bawah untuk tambah!
          </div>
        ) : (
          tasks.map((task) => {
            const isDone = Boolean(task.is_completed);
            return (
              <div
                key={task.id}
                onClick={() => handleToggleComplete(task.id, isDone)}
                className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-all cursor-pointer ${
                  isDone
                    ? "opacity-50 line-through bg-transparent border-white/5"
                    : isDark
                    ? "bg-white/[0.02] border-white/5 hover:border-white/15"
                    : "bg-zinc-50 border-zinc-200 hover:border-zinc-300"
                }`}
              >
                <div className="flex items-center gap-2 truncate">
                  {isDone ? (
                    <CheckSquare className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                  ) : (
                    <Square className="w-4 h-4 text-zinc-400 flex-shrink-0" />
                  )}
                  <span className="text-xs truncate text-zinc-200">{task.title}</span>
                </div>
                {getQuadrantBadge(task.eisenhower_quadrant)}
              </div>
            );
          })
        )}
      </div>

      {/* Quick Add Bar */}
      <form onSubmit={handleCreateTask} className="mt-2 flex items-center gap-1.5">
        <input
          type="text"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="+ Tambah tugas kuliah (@Todo)..."
          className={`flex-1 text-xs px-2.5 py-1.5 rounded-xl border outline-none bg-transparent ${
            isDark
              ? "border-white/10 text-white placeholder-zinc-500 focus:border-emerald-500/50"
              : "border-zinc-200 text-zinc-900 placeholder-zinc-400 focus:border-emerald-500/50"
          }`}
        />
        <button
          type="submit"
          disabled={!newTitle.trim()}
          className="p-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};

export default TodoChecklistSlide;
