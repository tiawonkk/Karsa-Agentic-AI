import React, { useState, useEffect } from "react";
import { Check, Plus, Edit2, ChevronLeft } from "lucide-react";

interface TaskItem {
  id: number;
  title: string;
  eisenhower_quadrant?: string;
  is_completed?: boolean | number;
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
  const [isEditing, setIsEditing] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const fetchTasks = async () => {
    try {
      const res = await fetch("/api/v1/tasks?limit=15");
      if (res.ok) {
        const data = await res.json();
        const rawTasks: TaskItem[] = data.tasks || [];
        // If DB has fewer than 3 tasks, ensure student has friendly default tasks
        if (rawTasks.length === 0) {
          setTasks([
            { id: 101, title: "Revise the report", is_completed: true },
            { id: 102, title: "Reply to Dina", is_completed: true },
            { id: 103, title: "Post weekly update", is_completed: true },
            { id: 104, title: "Submit calculus assignment", is_completed: false },
            { id: 105, title: "Read paper on transformer architectures", is_completed: true },
          ]);
        } else {
          setTasks(rawTasks);
        }
      }
    } catch (_) {
      // Fallback
      setTasks([
        { id: 101, title: "Revise the report", is_completed: true },
        { id: 102, title: "Reply to Dina", is_completed: true },
        { id: 103, title: "Post weekly update", is_completed: true },
      ]);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleToggle = async (task: TaskItem) => {
    const nextCompleted = !Boolean(task.is_completed);
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, is_completed: nextCompleted } : t))
    );
    try {
      await fetch(`/api/v1/tasks/${task.id}/complete`, { method: "POST" });
    } catch (_) {}
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    onAddTaskPrompt(`@Todo ${newTitle.trim()}`);
    setNewTitle("");
    setIsEditing(false);
  };

  const completedCount = tasks.filter((t) => Boolean(t.is_completed)).length;
  const totalCount = Math.max(tasks.length, 1);

  return (
    <div className="w-full flex items-center justify-between gap-4 select-none px-1 py-0.5">
      {/* Left Column: Metric & Quick Action Buttons (Reference Image 3) */}
      <div className="flex flex-col justify-between flex-1 max-w-[190px]">
        {/* Metric Counter & Chevron Back */}
        <div className="flex items-center gap-2 mb-1">
          <div className="w-6 h-6 rounded-full bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white cursor-pointer transition-colors flex-shrink-0">
            <ChevronLeft className="w-3.5 h-3.5" />
          </div>

          <div>
            <div className="text-3xl font-bold text-white tracking-tight leading-none font-sans">
              {completedCount}/{totalCount}
            </div>
            <div className="text-[10px] text-zinc-400 mt-0.5 font-medium">
              Task Done Today
            </div>
          </div>
        </div>

        {/* Buttons: + Add Task & ✎ Edit Task */}
        {isEditing ? (
          <form onSubmit={handleCreate} className="flex items-center gap-1 mt-2">
            <input
              type="text"
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Nama tugas..."
              className="w-full text-xs px-2 py-1 rounded-lg bg-black/60 border border-emerald-500/50 text-white outline-none"
            />
            <button
              type="submit"
              className="px-2 py-1 bg-emerald-600 text-white text-[10px] rounded-lg font-bold"
            >
              OK
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-1.5 mt-2">
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 text-zinc-200 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Add Task</span>
            </button>

            <button
              type="button"
              onClick={() => setIsEditing((prev) => !prev)}
              className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/15 text-zinc-300 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer"
            >
              <Edit2 className="w-2.5 h-2.5" />
              <span>Edit Task</span>
            </button>
          </div>
        )}
      </div>

      {/* Right Column: Rounded Green Task Cards (Reference Image 3) */}
      <div className="flex-1 max-h-[110px] overflow-y-auto space-y-1.5 pr-1.5">
        {tasks.map((task) => {
          const isDone = Boolean(task.is_completed);
          return (
            <div
              key={task.id}
              onClick={() => handleToggle(task)}
              className={`px-3 py-1.5 rounded-xl flex items-center gap-2.5 transition-all cursor-pointer ${
                isDone
                  ? "bg-[#102a18]/90 border border-emerald-600/40 text-zinc-100 shadow-sm"
                  : "bg-white/[0.04] border border-white/10 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                  isDone ? "bg-emerald-500 text-black font-bold" : "border border-zinc-500"
                }`}
              >
                {isDone && <Check className="w-2.5 h-2.5 stroke-[3]" />}
              </div>
              <span
                className={`text-xs font-medium truncate ${
                  isDone ? "text-zinc-100" : "text-zinc-300"
                }`}
              >
                {task.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TodoChecklistSlide;
