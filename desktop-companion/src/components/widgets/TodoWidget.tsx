import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, Plus, Repeat, Trash2 } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { OfflineNotice } from "./WidgetBits";

export type Recurrence = "daily" | "weekdays" | "weekly";

interface TaskItem {
  id: number;
  title: string;
  quadrant?: string;
  priority?: number;
  is_urgent?: number;
  is_important?: number;
  status?: string;
  completed_at?: string | null;
  recurrence?: Recurrence | null;
  due_at?: string | null;
  course?: string | null;
  task_type?: string;
}

type Priority = 1 | 2 | 3 | 4;

const DONE_WINDOW_HOURS = 24;

const P: Record<Priority, { short: string; label: string; cls: string }> = {
  1: { short: "P1", label: "🔴 P1 · Kritis", cls: "bg-rose-500/15 text-rose-500 border-rose-500/30" },
  2: { short: "P2", label: "🟠 P2 · Penting", cls: "bg-orange-500/15 text-orange-500 border-orange-500/30" },
  3: { short: "P3", label: "🔵 P3 · Normal", cls: "bg-sky-500/15 text-sky-500 border-sky-500/30" },
  4: { short: "P4", label: "🟢 P4 · Santai", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
};

const ROUTINES: Array<{ value: "none" | Recurrence; label: string; letter: string; hint: string }> = [
  { value: "none", label: "Sekali", letter: "", hint: "Tugas sekali jalan" },
  { value: "daily", label: "Harian", letter: "H", hint: "Muncul lagi 24 jam setelah dicentang" },
  { value: "weekdays", label: "Hari kerja", letter: "K", hint: "Muncul lagi besok, melewati Sabtu-Minggu" },
  { value: "weekly", label: "Mingguan", letter: "M", hint: "Muncul lagi 7 hari setelah dicentang" },
];
const routineOf = (r: Recurrence | null | undefined) => ROUTINES.find((x) => x.value === (r ?? "none")) ?? ROUTINES[0];

export const priorityOf = (t: TaskItem): Priority => {
  if (t.priority && t.priority >= 1 && t.priority <= 4) return t.priority as Priority;
  if (t.quadrant === "Q1_DO" || (t.is_important === 1 && t.is_urgent === 1)) return 1;
  if (t.quadrant === "Q2_SCHEDULE" || (t.is_important === 1 && t.is_urgent === 0)) return 2;
  if (t.quadrant === "Q3_DELEGATE" || (t.is_important === 0 && t.is_urgent === 1)) return 3;
  return 4;
};

const nowStamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** "hilang dalam 23 j": time left before a finished task leaves the list (24 h after it was checked). */
const leavesIn = (completedAt: string | null | undefined): string => {
  if (!completedAt) return "";
  const done = new Date(completedAt.replace(" ", "T")).getTime();
  if (Number.isNaN(done)) return "";
  const ms = done + DONE_WINDOW_HOURS * 3600_000 - Date.now();
  if (ms <= 0) return "segera hilang";
  const h = Math.floor(ms / 3600_000);
  return h >= 1 ? `hilang dalam ${h} j` : `hilang dalam ${Math.max(1, Math.ceil(ms / 60_000))} m`;
};

/**
 * Real tasks from SQLite. Checking a task keeps it on the list, checked, for 24 hours (then it leaves the view);
 * checking again undoes it. Routine tasks come back as a fresh task after their interval. Updates are optimistic, so a
 * tap reacts immediately, and the server answer reconciles the list.
 */
export function useTasks() {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/tasks?limit=300&recent_done_hours=${DONE_WINDOW_HOURS}`);
      if (!res.ok) {
        setOffline(true);
        return;
      }
      setOffline(false);
      const d = await res.json();
      setTasks(Array.isArray(d?.tasks) ? d.tasks : []);
    } catch (_) {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 20000);
    return () => clearInterval(id);
  }, [refresh]);

  const send = async (url: string, init?: RequestInit) => {
    try {
      await fetch(url, init);
    } catch (_) {}
    refresh();
  };

  const toggle = (t: TaskItem) => {
    const finishing = t.status !== "done";
    setTasks((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, status: finishing ? "done" : "todo", completed_at: finishing ? nowStamp() : null } : x))
    );
    return send(`/api/v1/tasks/${t.id}/${finishing ? "complete" : "reopen"}`, { method: "POST" });
  };

  const remove = (id: number) => {
    setTasks((prev) => prev.filter((x) => x.id !== id));
    return send(`/api/v1/tasks/${id}`, { method: "DELETE" });
  };

  /** Edit a task. Returns the server's message when it refuses (so the form can show it), or null on success. */
  const edit = async (id: number, fields: { title?: string; priority?: number; due_at?: string }): Promise<string | null> => {
    try {
      const res = await fetch(`/api/v1/tasks/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields) });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return typeof body.detail === "string" ? body.detail : `Gagal menyimpan (${res.status})`;
      }
    } catch (_) {
      return "Server tidak terjangkau";
    }
    await refresh();
    return null;
  };

  const add = (title: string, priority: Priority, recurrence: "none" | Recurrence) =>
    send("/api/v1/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, priority, recurrence }),
    });

  const cycleRoutine = (t: TaskItem) => {
    const order = ROUTINES.map((r) => r.value);
    const next = order[(order.indexOf(t.recurrence ?? "none") + 1) % order.length];
    setTasks((prev) => prev.map((x) => (x.id === t.id ? { ...x, recurrence: next === "none" ? null : next } : x)));
    return send(`/api/v1/tasks/${t.id}/recurrence`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recurrence: next }),
    });
  };

  const dedupe = async (): Promise<number> => {
    try {
      const res = await fetch("/api/v1/tasks/dedupe", { method: "POST" });
      const d = await res.json();
      await refresh();
      return typeof d?.dropped === "number" ? d.dropped : 0;
    } catch (_) {
      return 0;
    }
  };

  return { tasks, toggle, remove, edit, add, cycleRoutine, dedupe, offline, refresh };
}

const Row: React.FC<{
  t: TaskItem;
  onToggle: () => void;
  onRemove?: () => void;
  onRoutine?: () => void;
  onEdit?: (fields: { title?: string; priority?: number; due_at?: string }) => Promise<string | null>;
}> = ({ t, onToggle, onRemove, onRoutine, onEdit }) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [prio, setPrio] = useState<number>(priorityOf(t));
  const [due, setDue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const done = t.status === "done";
  const p = P[priorityOf(t)];
  const routine = routineOf(t.recurrence);

  const save = async () => {
    const fields: { title?: string; priority?: number; due_at?: string } = {};
    if (title.trim() !== t.title) fields.title = title;
    if (prio !== priorityOf(t)) fields.priority = prio;
    if (due.trim()) fields.due_at = due.trim();
    if (!Object.keys(fields).length) {
      setEditing(false);
      return;
    }
    const problem = await onEdit?.(fields);
    if (problem) setError(problem);
    else {
      setError(null);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        onKeyDown={(e) => e.key === "Escape" && setEditing(false)}
        className="rounded-xl border border-accent bg-card p-2 space-y-1.5 text-[11.5px]"
      >
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Judul tugas" className="w-full h-7 px-2 rounded-lg bg-pill text-ink outline-none" />
        <div className="flex items-center gap-1.5">
          <select value={prio} onChange={(e) => setPrio(Number(e.target.value))} aria-label="Prioritas" className="h-7 rounded-lg bg-pill text-ink px-1 outline-none cursor-pointer">
            {([1, 2, 3, 4] as Priority[]).map((n) => (
              <option key={n} value={n}>
                {P[n].label}
              </option>
            ))}
          </select>
          <input value={due} onChange={(e) => setDue(e.target.value)} placeholder="Tenggat baru: besok, 2026-12-31" aria-label="Tenggat" className="flex-1 min-w-0 h-7 px-2 rounded-lg bg-pill text-ink placeholder:text-ink-muted outline-none" />
        </div>
        {error && <div className="text-[10.5px] text-rose-500">{error}</div>}
        <div className="flex items-center gap-1.5">
          <button type="submit" className="h-6 px-3 rounded-full bg-accent text-white text-[10.5px] font-semibold cursor-pointer">Simpan</button>
          <button type="button" onClick={() => (setEditing(false), setError(null), setTitle(t.title))} className="h-6 px-3 rounded-full bg-pill text-ink-2 text-[10.5px] cursor-pointer">Batal</button>
        </div>
      </form>
    );
  }

  return (
    <div
      onClick={onToggle}
      className={`group flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-[11.5px] cursor-pointer border transition-colors ${
        done ? "bg-emerald-500/10 border-emerald-500/25 text-ink-2" : "bg-card border-subtle text-ink hover:brightness-105"
      }`}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Batalkan selesai: ${t.title}` : `Tandai selesai: ${t.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 cursor-pointer transition-colors ${
          done ? "bg-emerald-500 border-emerald-500 text-white" : "border-ink-muted hover:border-emerald-500"
        }`}
      >
        {done && <Check className="w-3 h-3" strokeWidth={3} />}
      </button>
      <span className={`text-[9px] font-mono font-bold px-1.5 rounded border flex-shrink-0 ${p.cls}`}>{p.short}</span>
      <span className="flex-1 min-w-0">
        <span className={`block truncate font-medium ${done ? "line-through" : ""}`}>{t.title}</span>
        {done && <span className="block text-[9.5px] font-mono text-emerald-600 dark:text-emerald-400">{leavesIn(t.completed_at)}</span>}
      </span>
      {onRoutine && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRoutine();
          }}
          title={`Rutinitas: ${routine.label}. ${routine.hint}. Klik untuk mengganti.`}
          aria-label={`Rutinitas ${routine.label}`}
          className={`flex items-center gap-0.5 px-1 h-5 rounded-md text-[9.5px] font-mono font-bold flex-shrink-0 cursor-pointer ${
            t.recurrence ? "bg-accent/15 text-accent" : "text-ink-muted opacity-0 group-hover:opacity-100 hover:text-ink"
          }`}
        >
          <Repeat className="w-3 h-3" />
          {routine.letter}
        </button>
      )}
      {!onRoutine && t.recurrence && (
        <span title={`Rutinitas ${routine.label}`} className="flex-shrink-0 text-accent">
          <Repeat className="w-3 h-3" />
        </span>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setTitle(t.title);
            setPrio(priorityOf(t));
            setDue("");
            setEditing(true);
          }}
          className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-ink transition-opacity flex-shrink-0"
          title="Ubah tugas"
          aria-label="Ubah tugas"
        >
          <Pencil className="w-3 h-3" />
        </button>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="opacity-0 group-hover:opacity-100 text-ink-muted hover:text-rose-500 transition-opacity flex-shrink-0"
          title="Hapus tugas"
          aria-label="Hapus tugas"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

export const TodoBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const { tasks, toggle, remove, edit, add, cycleRoutine, dedupe, offline, refresh } = useTasks();
  const [title, setTitle] = useState("");
  const [prio, setPrio] = useState<Priority>(3);
  const [routine, setRoutine] = useState<"none" | Recurrence>("none");
  const [confirmDedupe, setConfirmDedupe] = useState(false);
  const [dedupeNote, setDedupeNote] = useState<string | null>(null);

  const done = useMemo(
    () => tasks.filter((t) => t.status === "done").sort((a, b) => String(b.completed_at).localeCompare(String(a.completed_at))),
    [tasks]
  );
  const pending = useMemo(
    () => tasks.filter((t) => t.status !== "done").sort((a, b) => priorityOf(a) - priorityOf(b)),
    [tasks]
  );
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    pending.forEach((t) => {
      // same key as the backend: title, course, type, priority, routine and due DATE (time of day ignored)
      const k = [t.title.trim().toLowerCase(), t.course ?? "", t.task_type ?? "", priorityOf(t), t.recurrence ?? "", (t.due_at ?? "").slice(0, 10)].join("|");
      seen.set(k, (seen.get(k) ?? 0) + 1);
    });
    return [...seen.values()].reduce((sum, n) => sum + (n > 1 ? n - 1 : 0), 0);
  }, [pending]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = title.trim();
    if (!v) return;
    setTitle("");
    add(v, prio, routine);
  };

  if (offline && tasks.length === 0) return <OfflineNotice onRetry={refresh} compact={size === "S"} />;

  if (size === "S") {
    const top = pending[0];
    return (
      <div className="w-full flex items-center gap-2 pr-1 text-[12.5px] font-semibold text-ink whitespace-nowrap overflow-hidden">
        <span aria-hidden="true">✅</span>
        <span className="font-mono">
          {done.length}/{tasks.length}
        </span>
        <span className="text-ink-2 font-medium">Tugas</span>
        {top && (
          <span className={`text-[9px] font-mono font-bold px-1.5 rounded border ${P[priorityOf(top)].cls}`}>
            {P[priorityOf(top)].short} Aktif
          </span>
        )}
      </div>
    );
  }

  const routineSelect = (
    <select
      value={routine}
      onChange={(e) => setRoutine(e.target.value as "none" | Recurrence)}
      title="Rutinitas: tugas ini akan muncul lagi setelah dicentang"
      aria-label="Rutinitas"
      className="h-7 rounded-full bg-pill text-ink-2 text-[10.5px] font-semibold px-1.5 outline-none cursor-pointer max-w-[78px]"
    >
      {ROUTINES.map((r) => (
        <option key={r.value} value={r.value}>
          {r.value === "none" ? "↻ Sekali" : `↻ ${r.label}`}
        </option>
      ))}
    </select>
  );

  const input = (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Tugas baru…"
        className="flex-1 min-w-0 h-7 px-2.5 rounded-full bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent"
      />
      {routineSelect}
      <button
        type="submit"
        disabled={!title.trim()}
        className="w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 cursor-pointer flex-shrink-0"
        title="Tambah tugas"
        aria-label="Tambah tugas"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </form>
  );

  const summary = (
    <div className="flex items-baseline gap-2">
      <span className="font-mono font-bold text-[22px] leading-none text-ink">
        {done.length}/{tasks.length}
      </span>
      <span className="text-[11px] text-ink-2 font-medium">selesai (24 jam)</span>
    </div>
  );

  if (size === "M") {
    // compact: the counter and the next task share one row, the input sits below (fits the 148px island)
    const visible = [...pending, ...done].slice(0, 1);
    return (
      <div className="h-full flex flex-col justify-center gap-2 min-h-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex-shrink-0">{summary}</div>
          <div className="flex-1 min-w-0">
            {visible.length === 0 ? (
              <div className="text-[11px] text-ink-muted truncate">Belum ada tugas.</div>
            ) : (
              <>
                {visible.map((t) => (
                  <Row key={t.id} t={t} onToggle={() => toggle(t)} />
                ))}
                {tasks.length > 1 && <div className="text-[10px] text-ink-muted">+{tasks.length - 1} lainnya (perbesar ke L)</div>}
              </>
            )}
          </div>
        </div>
        {input}
      </div>
    );
  }

  // L: pending first (by priority), then what you finished in the last 24 h
  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      {summary}

      {duplicates > 0 && (
        <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[10.5px] text-ink">
          <span>{dedupeNote ?? `${duplicates} tugas kembar (judul, prioritas & tanggal sama).`}</span>
          {!dedupeNote &&
            (confirmDedupe ? (
              <span className="flex items-center gap-1 flex-shrink-0">
                <button
                  type="button"
                  onClick={async () => {
                    const n = await dedupe();
                    setConfirmDedupe(false);
                    setDedupeNote(`${n} tugas kembar dirapikan (yang terlama dipertahankan).`);
                    setTimeout(() => setDedupeNote(null), 4000);
                  }}
                  className="px-2 h-5 rounded-full bg-amber-500 text-white font-semibold cursor-pointer"
                >
                  Ya, rapikan
                </button>
                <button type="button" onClick={() => setConfirmDedupe(false)} className="px-1.5 h-5 text-ink-muted hover:text-ink cursor-pointer">
                  Batal
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmDedupe(true)} className="px-2 h-5 rounded-full bg-pill text-ink font-semibold cursor-pointer flex-shrink-0">
                Rapikan
              </button>
            ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-0.5">
        {tasks.length === 0 ? (
          <div className="text-[11px] text-ink-muted pt-1">Belum ada tugas. Tambahkan di bawah.</div>
        ) : (
          <>
            {pending.map((t) => (
              <Row key={t.id} t={t} onToggle={() => toggle(t)} onRemove={() => remove(t.id)} onRoutine={() => cycleRoutine(t)} onEdit={(f) => edit(t.id, f)} />
            ))}
            {done.length > 0 && (
              <div className="pt-1.5 text-[9.5px] font-semibold uppercase tracking-wide text-ink-muted">Selesai · hilang setelah 24 jam</div>
            )}
            {done.map((t) => (
              <Row key={t.id} t={t} onToggle={() => toggle(t)} onRemove={() => remove(t.id)} onRoutine={() => cycleRoutine(t)} onEdit={(f) => edit(t.id, f)} />
            ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        {([1, 2, 3, 4] as Priority[]).map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setPrio(n)}
            title={P[n].label}
            className={`px-2 py-0.5 rounded-full text-[9.5px] font-mono font-bold border cursor-pointer ${
              prio === n ? P[n].cls + " ring-1 ring-accent" : "bg-pill text-ink-muted border-transparent"
            }`}
          >
            {P[n].short}
          </button>
        ))}
      </div>
      {input}
    </div>
  );
};
