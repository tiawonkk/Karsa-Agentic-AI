export type SourceKind = "document" | "dataset" | "text";

export interface NbSummary {
  id: number;
  title: string;
  source_count: number;
}

export interface NbSource {
  id: number;
  notebook_id: number;
  name: string;
  kind: SourceKind;
  char_count: number;
}

export interface NbDetail {
  id: number;
  title: string;
  sources: NbSource[];
}

export interface Citation {
  n: number;
  source_id: number;
  source: string;
  excerpt: string;
}

export interface AskResult {
  answer: string;
  citations: Citation[];
  mode: "llm" | "extractive" | "no_match";
  note?: string;
}

export interface Paper {
  kind: "paper_draft";
  title: string;
  abstract: string;
  sections: Record<string, string>;
  references: string[];
  markdown: string;
  citations: Citation[];
  mode: "llm" | "extractive";
  note?: string;
}

export interface StudyOutput {
  kind: "briefing" | "study_guide";
  markdown: string;
  citations: Citation[];
  mode: "llm" | "extractive";
  note?: string;
}

export interface CleanStep {
  step: string;
  detail: string;
  count: number;
}

export interface CleanReport {
  before: { rows: number; columns: number };
  after: { rows: number; columns: number };
  steps: CleanStep[];
  outliers: Record<string, number>;
  missing_remaining: Record<string, number>;
  sample?: Array<Record<string, unknown>>;
  columns_after?: string[];
  output_name?: string;
  download_url?: string;
  added_source?: NbSource;
}

export interface CleanOptions {
  normalize_headers: boolean;
  strip_text: boolean;
  missing_tokens: boolean;
  drop_empty: boolean;
  drop_duplicates: boolean;
  coerce_numeric: boolean;
  parse_dates: boolean;
  fill_missing: "none" | "median" | "mode" | "drop";
}

export const DEFAULT_CLEAN_OPTIONS: CleanOptions = {
  normalize_headers: true,
  strip_text: true,
  missing_tokens: true,
  drop_empty: true,
  drop_duplicates: true,
  coerce_numeric: true,
  parse_dates: true,
  fill_missing: "none",
};

export const NOTEBOOK_FILE_ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.csv,.xlsx,.xls";
const ACCEPTED = /\.(pdf|docx|pptx|txt|md|csv|xlsx|xls)$/i;
export const isNotebookFile = (f: File | null | undefined): boolean => !!f && ACCEPTED.test(f.name);

/** Thrown when the backend cannot be reached at all (not for 4xx answers, which carry their own message). */
export class OfflineError extends Error {
  constructor() {
    super("Server Karsa tidak terjangkau. Jalankan backend di port 8765.");
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (_) {
    throw new OfflineError();
  }
  if (!res.ok) {
    let detail = "";
    try {
      const body = await res.json();
      detail = typeof body?.detail === "string" ? body.detail : "";
      if (!detail && body?.status === "backend_offline") throw new OfflineError();
    } catch (e) {
      if (e instanceof OfflineError) throw e;
    }
    throw new Error(detail || `Permintaan gagal (HTTP ${res.status}).`);
  }
  return (await res.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const notebookApi = {
  list: () => call<{ notebooks: NbSummary[] }>("/api/v1/notebooks").then((d) => d.notebooks),
  create: (title: string) => call<NbSummary>("/api/v1/notebooks", json({ title })),
  get: (id: number) => call<NbDetail>(`/api/v1/notebooks/${id}`),
  remove: (id: number) => call<{ status: string }>(`/api/v1/notebooks/${id}`, { method: "DELETE" }),
  addFile: (id: number, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return call<NbSource>(`/api/v1/notebooks/${id}/sources/file`, { method: "POST", body: form });
  },
  addText: (id: number, title: string, text: string) =>
    call<NbSource>(`/api/v1/notebooks/${id}/sources/text`, json({ title, text })),
  removeSource: (sourceId: number) =>
    call<{ status: string }>(`/api/v1/notebooks/sources/${sourceId}`, { method: "DELETE" }),
  ask: (id: number, question: string) => call<AskResult>(`/api/v1/notebooks/${id}/ask`, json({ question })),
  generate: (id: number, kind: "briefing" | "study_guide" | "paper_draft", topic = "") =>
    call<StudyOutput | Paper>(`/api/v1/notebooks/${id}/generate`, json({ kind, topic })),
  exportDocx: (id: number, paper: Paper) =>
    call<{ filename: string; path: string; download_url?: string; saved_in?: string; in_project_folder?: boolean }>(`/api/v1/notebooks/${id}/export/docx`, json({ paper })),
  cleanPreview: (sourceId: number, options: CleanOptions) =>
    call<CleanReport>(`/api/v1/notebooks/sources/${sourceId}/clean/preview`, json({ options })),
  cleanApply: (sourceId: number, options: CleanOptions, addToNotebook: boolean) =>
    call<CleanReport>(`/api/v1/notebooks/sources/${sourceId}/clean/apply`, json({ options, add_to_notebook: addToNotebook })),
};

const ACTIVE_KEY = "karsa_active_notebook";
export const getActiveNotebookId = (): number | null => {
  try {
    const v = Number(localStorage.getItem(ACTIVE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch (_) {
    return null;
  }
};
export const setActiveNotebookId = (id: number | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, String(id));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch (_) {}
};

/** Add a dropped file to the active notebook, creating "Notebook Saya" when none exists yet. */
export async function addFileToActiveNotebook(file: File): Promise<{ notebookId: number; source: NbSource }> {
  let id = getActiveNotebookId();
  if (id !== null) {
    try {
      await notebookApi.get(id);
    } catch (e) {
      if (e instanceof OfflineError) throw e;
      id = null; // the remembered notebook no longer exists
    }
  }
  if (id === null) {
    const existing = await notebookApi.list();
    id = existing[0]?.id ?? (await notebookApi.create("Notebook Saya")).id;
    setActiveNotebookId(id);
  }
  const source = await notebookApi.addFile(id, file);
  return { notebookId: id, source };
}
