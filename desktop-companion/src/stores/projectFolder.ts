import { useEffect, useSyncExternalStore } from "react";

/** The active project folder (a real absolute path). The backend owns it; this store mirrors it for the UI. */
interface State {
  path: string | null;
  loaded: boolean;
  busy: boolean;
  error: string | null;
}

let state: State = { path: null, loaded: false, busy: false, error: null };
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

async function call(path: string, init?: RequestInit & { json?: unknown }): Promise<any> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/v1${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) throw new Error(typeof data?.detail === "string" ? data.detail : `Gagal (HTTP ${res.status}).`);
  return data;
}

const run = async (fn: () => Promise<void>) => {
  set({ busy: true, error: null });
  try {
    await fn();
  } catch (e: any) {
    set({ error: e?.message ?? "Terjadi kesalahan." });
  } finally {
    set({ busy: false });
  }
};

export const projectFolder = {
  load: () => run(async () => set({ path: (await call("/project/folder")).path ?? null, loaded: true })),
  /** Type or paste a path. */
  setPath: (path: string) => run(async () => set({ path: (await call("/project/folder", { method: "PUT", json: { path } })).path })),
  /** Native Windows folder dialog on this computer. */
  pick: () =>
    run(async () => {
      const r = await call("/system/pick-folder", { method: "POST" });
      if (!r.cancelled) set({ path: r.path });
    }),
  /** Create `<active folder>/<name>` and switch to it. */
  create: (name: string) => run(async () => set({ path: (await call("/project/folder/create", { method: "POST", json: { name } })).path })),
  open: (app: "explorer" | "vscode") => run(async () => void (await call("/system/open-folder", { method: "POST", json: { app } }))),
  clearError: () => set({ error: null }),
};

export const currentProjectFolder = (): string | null => state.path;

export function useProjectFolder(): State {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state
  );
  useEffect(() => {
    if (!state.loaded && !state.busy) projectFolder.load();
  }, []);
  return s;
}
