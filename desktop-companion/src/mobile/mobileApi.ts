import { useEffect, useRef, useState } from "react";

const TOKEN_KEY = "karsa_mobile_token";

/** The pairing token comes from the QR link (?token=…): keep it, then remove it from the address bar. */
export function initToken(): string | null {
  try {
    const url = new URL(window.location.href);
    const t = url.searchParams.get("token");
    if (t) {
      localStorage.setItem(TOKEN_KEY, t);
      url.searchParams.delete("token");
      window.history.replaceState({}, "", url.pathname + (url.search || "") + url.hash);
    }
    return localStorage.getItem(TOKEN_KEY);
  } catch (_) {
    return null;
  }
}

export const getToken = (): string => {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch (_) {
    return "";
  }
};

export const forgetToken = () => {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
};

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function call<T = any>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const headers: Record<string, string> = { "X-Karsa-Token": getToken() };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { ...rest, headers: { ...headers, ...(rest.headers as Record<string, string> | undefined) }, body: json !== undefined ? JSON.stringify(json) : rest.body });
  } catch (_) {
    throw new ApiError("Laptop tidak terjangkau. Pastikan satu Wi-Fi dan Karsa menyala.", 0);
  }
  let data: any = null;
  try {
    data = await res.json();
  } catch (_) {}
  if (!res.ok) {
    const d = data?.detail;
    throw new ApiError(typeof d === "string" ? d : `Gagal (HTTP ${res.status}).`, res.status);
  }
  return data as T;
}

export type Area = "tasks" | "hydration" | "expenses" | "income" | "approvals" | "shelf";

/** Live sync: the laptop pushes which areas changed; screens refetch only those. Falls back to slow polling. */
export function useSync(onUnauthorized: () => void): { online: boolean; versions: Record<Area, number> } {
  const [online, setOnline] = useState(false);
  const [versions, setVersions] = useState<Record<Area, number>>({ tasks: 0, hydration: 0, expenses: 0, income: 0, approvals: 0, shelf: 0 });
  const unauth = useRef(onUnauthorized);
  unauth.current = onUnauthorized;

  useEffect(() => {
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    const bump = (areas: Area[]) =>
      setVersions((v) => {
        const n = { ...v };
        for (const a of areas) n[a] = (n[a] ?? 0) + 1;
        return n;
      });

    const connect = async () => {
      try {
        await call("/mobile/ping"); // tells 401 (not paired) apart from "laptop offline" before opening the stream
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
          unauth.current();
          return;
        }
        setOnline(false);
        if (!stopped) timer = setTimeout(connect, 4000);
        return;
      }
      es = new EventSource(`/api/v1/sync/stream?token=${encodeURIComponent(getToken())}`);
      es.onopen = () => setOnline(true);
      es.addEventListener("sync", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data);
          bump(d.areas as Area[]);
        } catch (_) {}
      });
      es.onerror = () => {
        setOnline(false);
        es?.close();
        es = null;
        if (!stopped) timer = setTimeout(connect, 4000);
      };
    };
    connect();
    poll = setInterval(() => bump(["tasks", "hydration", "expenses", "income", "approvals", "shelf"]), 60000); // safety net

    return () => {
      stopped = true;
      es?.close();
      if (timer) clearTimeout(timer);
      if (poll) clearInterval(poll);
    };
  }, []);

  return { online, versions };
}

export const idr = (n: number | null | undefined) => `Rp ${Math.round(n ?? 0).toLocaleString("id-ID")}`;
