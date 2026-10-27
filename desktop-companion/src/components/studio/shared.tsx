import React, { useCallback, useState } from "react";
import { Loader2 } from "lucide-react";

/** JSON call with the backend's own error text (the API answers `detail` in Indonesian). */
export async function api<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api/v1${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x: any) => x.msg).join("; ") : `Gagal (HTTP ${res.status}).`);
  }
  return data as T;
}

/** Runs an async action with busy + error state, so every button shows what happened. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(
    async (...a: A): Promise<R | undefined> => {
      setBusy(true);
      setError(null);
      try {
        return await fn(...a);
      } catch (e: any) {
        setError(e?.message ?? "Terjadi kesalahan.");
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  return { run, busy, error, setError };
}

export const idr = (n: number | null | undefined) => (n === null || n === undefined ? "-" : `Rp ${Math.round(n).toLocaleString("id-ID")}`);

export const field =
  "w-full h-8 px-2.5 rounded-lg bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent";
export const area = "w-full px-2.5 py-2 rounded-lg bg-pill text-ink placeholder:text-ink-muted text-[11.5px] outline-none border border-transparent focus:border-accent resize-none";

export const Btn: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean; tone?: "accent" | "plain" | "danger" }> = ({ busy, tone = "accent", children, className = "", disabled, ...rest }) => (
  <button
    type="button"
    disabled={disabled || busy}
    className={`h-8 px-3 rounded-full text-[11.5px] font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${
      tone === "accent" ? "bg-accent text-white" : tone === "danger" ? "bg-rose-500/90 text-white" : "bg-pill text-ink hover:brightness-110"
    } ${className}`}
    {...rest}
  >
    {busy && <Loader2 className="w-3 h-3 animate-spin" />}
    {children}
  </button>
);

export const ErrorLine: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div role="alert" className="text-[11px] text-rose-500 whitespace-pre-wrap">
      {message}
    </div>
  ) : null;

export const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">{children}</div>;

export const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = "" }) => (
  <div className={`rounded-xl bg-card border border-subtle p-2.5 ${className}`}>{children}</div>
);

export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="text-[10.5px] text-ink-muted leading-snug">{children}</div>;
