import { useCallback, useEffect, useRef, useState } from "react";

export interface DashboardTask {
  id: number;
  title: string;
  due_at: string | null;
  hours_left: number | null;
  quadrant: string | null;
  is_urgent: boolean;
}

export interface DashboardSummary {
  finance: {
    period: string;
    daily_safe_spend_idr: number;
    total_remaining_idr: number;
    total_spent_idr: number;
    total_capital_idr: number;
    remaining_days: number;
  };
  tasks: {
    todo_count: number;
    urgent_count: number;
    upcoming: DashboardTask[];
  };
}

/**
 * Polls live finance + task data from the backend.
 * Backs off to a slow interval while the backend is offline, and pauses entirely while
 * `paused` is true (Zero-Heat sleep) so no background polling happens.
 */
export function useDashboard(paused: boolean) {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [online, setOnline] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onlineRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/dashboard/summary");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      onlineRef.current = true;
      setOnline(true);
    } catch {
      onlineRef.current = false;
      setOnline(false);
    }
  }, []);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;

    const loop = async () => {
      await refresh();
      if (!cancelled) {
        timer.current = setTimeout(loop, onlineRef.current ? 8000 : 15000);
      }
    };
    loop();

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [paused, refresh]);

  return { data, online, refresh };
}

export const formatRupiah = (n: number) => `Rp ${new Intl.NumberFormat("id-ID").format(Math.round(n))}`;

export function formatTimeLeft(hours: number | null): string {
  if (hours === null) return "tanpa deadline";
  if (hours < 0) return "telat";
  if (hours < 1) return "<1 jam";
  if (hours < 24) return `${Math.round(hours)} jam lagi`;
  return `${Math.round(hours / 24)} hari lagi`;
}
