import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, Check, Clock, Edit3, RefreshCw, RotateCcw, ShieldCheck, X } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";
import { PendingApprovalData } from "../HitlApprovalPill";
import { OfflineNotice } from "./WidgetBits";

type Decision = "approve" | "edit" | "reject";
type Mode = "prompt" | "allow" | "deny";
type Risk = "low" | "medium" | "high" | "critical";

interface AuditRow {
  action_id: string;
  session_thread_id: string;
  module: string;
  action_name: string;
  risk_level: Risk;
  summary?: string;
  decision: Decision | null;
  reason?: string | null;
  reviewer_id?: string | null;
  auto: boolean;
  requested_at?: string;
  decided_at?: string | null;
  exec_state?: string;
  executed: boolean;
  proposed_args: Record<string, unknown>;
  executed_args?: Record<string, unknown> | null;
}

interface Policy {
  timeout_minutes: number;
  actions: Record<string, Mode>;
  risk_overrides: Record<string, Risk>;
}
interface KnownAction {
  name: string;
  default_risk: Risk;
  module: string;
}

const CHANGED_EVENT = "karsa:approvals-changed";
export const announceApprovalsChanged = () => window.dispatchEvent(new Event(CHANGED_EVENT));

const RISK: Record<string, { label: string; cls: string }> = {
  low: { label: "Rendah", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  medium: { label: "Sedang", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400" },
  high: { label: "Tinggi", cls: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  critical: { label: "Kritis", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
};
const DECISION_LABEL: Record<string, string> = { approve: "Disetujui", edit: "Diubah lalu disetujui", reject: "Ditolak" };
const EXEC_LABEL: Record<string, string> = {
  pending: "belum dijalankan",
  running: "sedang berjalan",
  done: "sudah dijalankan",
  failed: "gagal, bisa diulang",
  stale: "kedaluwarsa",
};

/** Real approval requests from the backend (all threads), refreshed every few seconds and after any decision. */
export function useApprovals(pollMs = 5000) {
  const [pending, setPending] = useState<PendingApprovalData[]>([]);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/approvals/pending");
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setPending(data.pending_approvals || []);
      setOffline(false);
    } catch (_) {
      setOffline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => {
      clearInterval(t);
      window.removeEventListener(CHANGED_EVENT, refresh);
    };
  }, [refresh, pollMs]);

  const decide = useCallback(
    async (a: PendingApprovalData, decision: Decision, editedArgs?: Record<string, unknown>, reason?: string): Promise<string | null> => {
      try {
        const res = await fetch(`/api/v1/threads/${encodeURIComponent(a.session_thread_id)}/resume`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action_id: a.action_id, decision, edited_args: editedArgs ?? null, reason: reason ?? null, reviewer_id: "pengguna" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          return body.detail || `Gagal (${res.status})`;
        }
        announceApprovalsChanged();
        return null;
      } catch (_) {
        return "Server tidak terjangkau";
      }
    },
    []
  );

  return { pending, offline, refresh, decide };
}

const useNow = (ms = 1000) => {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
};

const left = (expiresAt: string | null | undefined, now: number): string => {
  if (!expiresAt) return "";
  const ms = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(ms)) return "";
  if (ms <= 0) return "habis";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, "0")}`;
};

const RiskBadge: React.FC<{ risk: string }> = ({ risk }) => (
  <span className={`px-2 py-0.5 rounded-full text-[9.5px] font-bold uppercase tracking-wide ${RISK[risk]?.cls ?? RISK.high.cls}`}>
    {RISK[risk]?.label ?? risk}
  </span>
);

const Row: React.FC<{ k: string; v?: React.ReactNode }> = ({ k, v }) =>
  v ? (
    <div className="flex gap-2 text-[10.5px] leading-snug">
      <span className="w-14 flex-shrink-0 text-ink-muted">{k}</span>
      <span className="min-w-0 break-words text-ink">{v}</span>
    </div>
  ) : null;

/** The approval card: operation, target, environment, impact, reason, the exact parameters, and Edit / Reject / Approve. */
export const ApprovalCard: React.FC<{
  approval: PendingApprovalData;
  now: number;
  onDecide: (d: Decision, edited?: Record<string, unknown>) => Promise<string | null>;
}> = ({ approval, now, onDecide }) => {
  const ev = approval.evidence;
  const args = ev?.args ?? approval.request.proposed_args ?? {};
  const editableKeys = ev?.editable_args ?? Object.keys(args);
  const editable = useMemo(() => Object.fromEntries(Object.entries(args).filter(([k]) => editableKeys.includes(k))), [args, editableKeys]);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(() => JSON.stringify(editable, null, 2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (d: Decision, edited?: Record<string, unknown>) => {
    setBusy(true);
    setError(await onDecide(d, edited));
    setBusy(false);
  };
  const sendEdit = () => {
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("harus objek JSON");
      const bad = Object.keys(parsed).filter((k) => !editableKeys.includes(k));
      if (bad.length) throw new Error(`parameter tidak boleh diubah: ${bad.join(", ")}`);
      run("edit", parsed);
    } catch (e) {
      setError(`Format salah: ${(e as Error).message}`);
    }
  };

  const remaining = left(approval.expires_at, now);
  return (
    <div className="rounded-2xl border border-subtle bg-pill/60 p-3 space-y-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        <AlertTriangle className="w-3.5 h-3.5 text-orange-500 flex-shrink-0" />
        <span className="text-[12px] font-semibold text-ink truncate">{approval.action_name}</span>
        <RiskBadge risk={approval.risk_level} />
        {remaining && (
          <span className={`ml-auto flex items-center gap-1 text-[10px] font-mono ${remaining === "habis" ? "text-rose-500" : "text-ink-muted"}`} title="Sisa waktu sebelum otomatis ditolak">
            <Clock className="w-3 h-3" /> {remaining}
          </span>
        )}
      </div>

      <div className="space-y-0.5">
        <Row k="Operasi" v={approval.request.summary} />
        <Row k="Modul" v={approval.module} />
        <Row k="Target" v={ev?.target} />
        <Row k="Lingkungan" v={ev?.environment} />
        <Row k="Dampak" v={ev?.impact} />
        <Row k="Alasan" v={ev?.reason} />
      </div>

      {Object.keys(args).length > 0 && (
        <pre className="p-2 rounded-xl bg-black/5 dark:bg-black/30 border border-subtle font-mono text-[10.5px] text-ink max-h-24 overflow-auto whitespace-pre-wrap">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}

      {editing && (
        <div className="space-y-1.5">
          <div className="text-[10px] text-ink-muted">Ubah parameter ({editableKeys.join(", ") || "tidak ada"}), lalu kirim.</div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            rows={Math.min(8, text.split("\n").length + 1)}
            className="w-full rounded-xl bg-black/5 dark:bg-black/30 border border-subtle p-2 font-mono text-[11px] text-ink resize-none outline-none focus:border-[var(--accent,#6366f1)]"
          />
        </div>
      )}

      {error && <div className="text-[10.5px] text-rose-500">{error}</div>}

      <div className="flex items-center gap-1.5">
        {editing ? (
          <>
            <button type="button" disabled={busy} onClick={sendEdit} className="flex-1 h-8 rounded-xl bg-accent text-white text-[11.5px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95">
              <Check className="w-3.5 h-3.5" /> Kirim perubahan
            </button>
            <button type="button" onClick={() => setEditing(false)} className="h-8 px-3 rounded-xl bg-pill text-ink-2 text-[11.5px] cursor-pointer">
              Batal
            </button>
          </>
        ) : (
          <>
            <button type="button" disabled={busy} onClick={() => run("approve")} className="flex-1 h-8 rounded-xl bg-emerald-500 text-white text-[11.5px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95">
              <Check className="w-3.5 h-3.5" /> Setujui
            </button>
            {editableKeys.length > 0 && (
              <button type="button" disabled={busy} onClick={() => setEditing(true)} className="h-8 px-3 rounded-xl bg-pill text-ink text-[11.5px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95">
                <Edit3 className="w-3.5 h-3.5" /> Ubah
              </button>
            )}
            <button type="button" disabled={busy} onClick={() => run("reject")} className="h-8 px-3 rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11.5px] font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95">
              <X className="w-3.5 h-3.5" /> Tolak
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const fmtTime = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("id-ID", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const HistoryTab: React.FC = () => {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [incomplete, setIncomplete] = useState<AuditRow[]>([]);
  const [offline, setOffline] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, i] = await Promise.all([fetch("/api/v1/approvals/audit?limit=60"), fetch("/api/v1/approvals/incomplete")]);
      if (!a.ok || !i.ok) throw new Error("bad");
      setRows((await a.json()).audit);
      setIncomplete((await i.json()).incomplete);
      setOffline(false);
    } catch (_) {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(CHANGED_EVENT, load);
    return () => window.removeEventListener(CHANGED_EVENT, load);
  }, [load]);

  const retry = async (id: string) => {
    const res = await fetch(`/api/v1/approvals/${encodeURIComponent(id)}/retry`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setNote(res.ok ? (body.exec_state === "done" ? "Berhasil dijalankan." : "Dicoba ulang, belum selesai.") : body.detail || "Gagal mengulang");
    load();
  };

  if (offline) return <OfflineNotice onRetry={load} />;
  if (rows === null) return <div className="text-[11px] text-ink-muted p-2">Memuat…</div>;
  return (
    <div className="space-y-2">
      {incomplete.length > 0 && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-2 space-y-1.5">
          <div className="text-[11px] font-semibold text-orange-600 dark:text-orange-400">Belum selesai ({incomplete.length})</div>
          {incomplete.map((r) => (
            <div key={r.action_id} className="flex items-center gap-2 text-[10.5px] text-ink">
              <span className="flex-1 min-w-0 truncate">{r.action_name}</span>
              <button type="button" onClick={() => retry(r.action_id)} className="h-6 px-2 rounded-full bg-orange-500 text-white font-semibold flex items-center gap-1 cursor-pointer active:scale-95">
                <RotateCcw className="w-3 h-3" /> Ulangi
              </button>
            </div>
          ))}
        </div>
      )}
      {note && <div className="text-[10.5px] text-ink-2">{note}</div>}
      {rows.length === 0 ? (
        <div className="text-[11px] text-ink-muted text-center py-6">Belum ada riwayat persetujuan.</div>
      ) : (
        rows.map((r) => (
          <div key={r.action_id} className="rounded-xl border border-subtle p-2 space-y-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11.5px] font-semibold text-ink truncate">{r.action_name}</span>
              <RiskBadge risk={r.risk_level} />
              <span className="ml-auto text-[9.5px] text-ink-muted">{fmtTime(r.decided_at || r.requested_at)}</span>
            </div>
            <div className="text-[10.5px] text-ink-2">
              {r.decision ? DECISION_LABEL[r.decision] : "Menunggu"}
              {r.auto && r.reason === "timeout" ? " (waktu habis)" : r.auto ? " (otomatis, kebijakan)" : r.reviewer_id ? ` oleh ${r.reviewer_id}` : ""}
              {r.exec_state && r.decision && r.decision !== "reject" ? ` · ${EXEC_LABEL[r.exec_state] ?? r.exec_state}` : ""}
            </div>
            {r.decision === "edit" && r.executed_args && (
              <div className="text-[10px] font-mono text-ink-muted break-words">
                {JSON.stringify(r.proposed_args)} → {JSON.stringify(r.executed_args)}
              </div>
            )}
            {r.reason && r.reason !== "timeout" && r.reason !== "policy" && <div className="text-[10px] text-ink-muted">“{r.reason}”</div>}
          </div>
        ))
      )}
    </div>
  );
};

const POLICY_LABEL: Record<Mode, string> = { prompt: "Tanya saya", allow: "Izinkan otomatis", deny: "Selalu tolak" };

const PolicyTab: React.FC = () => {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [known, setKnown] = useState<KnownAction[]>([]);
  const [offline, setOffline] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/approvals/policy");
      if (!res.ok) throw new Error("bad");
      const data = await res.json();
      setPolicy(data.policy);
      setKnown(data.actions);
      setOffline(false);
    } catch (_) {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const save = async (next: Policy) => {
    setPolicy(next);
    const res = await fetch("/api/v1/approvals/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setPolicy(body.policy);
      setMsg("Kebijakan disimpan.");
    } else {
      setMsg(body.detail || "Gagal menyimpan");
      load();
    }
  };

  if (offline) return <OfflineNotice onRetry={load} />;
  if (!policy) return <div className="text-[11px] text-ink-muted p-2">Memuat…</div>;
  return (
    <div className="space-y-2.5">
      <div className="text-[10.5px] text-ink-muted leading-snug">
        Atur apa yang boleh jalan sendiri. Aksi <b>kritis</b> (mis. perintah shell) tetap selalu meminta izin, apa pun pilihannya.
      </div>
      <label className="flex items-center gap-2 text-[11px] text-ink">
        <Clock className="w-3.5 h-3.5 text-ink-muted" />
        Batas waktu jawaban
        <input
          type="number"
          min={1}
          max={1440}
          value={policy.timeout_minutes}
          onChange={(e) => setPolicy({ ...policy, timeout_minutes: Number(e.target.value) })}
          onBlur={() => save(policy)}
          className="w-16 h-6 rounded-lg bg-pill border border-subtle px-2 text-[11px] text-ink outline-none"
        />
        menit
      </label>
      <div className="space-y-1.5">
        {known.map((k) => {
          const mode = policy.actions[k.name] ?? "prompt";
          return (
            <div key={k.name} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-medium text-ink truncate">{k.name}</div>
                <div className="text-[9.5px] text-ink-muted">{k.module}</div>
              </div>
              <RiskBadge risk={policy.risk_overrides[k.name] ?? k.default_risk} />
              <select
                value={mode}
                onChange={(e) => {
                  const actions = { ...policy.actions };
                  if (e.target.value === "prompt") delete actions[k.name];
                  else actions[k.name] = e.target.value as Mode;
                  save({ ...policy, actions });
                }}
                className="h-7 rounded-lg bg-pill border border-subtle text-[10.5px] text-ink px-1 outline-none cursor-pointer"
              >
                {(Object.keys(POLICY_LABEL) as Mode[]).map((m) => (
                  <option key={m} value={m} disabled={m === "allow" && (policy.risk_overrides[k.name] ?? k.default_risk) === "critical"}>
                    {POLICY_LABEL[m]}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      {msg && <div className="text-[10.5px] text-ink-2">{msg}</div>}
    </div>
  );
};

type Tab = "pending" | "history" | "policy";

export const ApprovalsBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const { pending, offline, refresh, decide } = useApprovals();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("pending");
  const first = pending[0];

  if (size === "S") {
    return (
      <div className="h-full flex items-center gap-2 px-1 text-[11.5px] font-medium">
        {pending.length > 0 ? (
          <>
            <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
            <span className="text-ink">{pending.length} menunggu izin</span>
          </>
        ) : (
          <>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-ink-2">{offline ? "Server offline" : "Aman"}</span>
          </>
        )}
      </div>
    );
  }

  if (size === "M") {
    if (offline) return <OfflineNotice onRetry={refresh} />;
    if (!first)
      return (
        <div className="h-full flex flex-col items-center justify-center gap-1 text-center">
          <ShieldCheck className="w-5 h-5 text-emerald-500" />
          <div className="text-[11.5px] font-medium text-ink">Tidak ada yang menunggu</div>
          <div className="text-[10px] text-ink-muted">Aksi berisiko akan muncul di sini.</div>
        </div>
      );
    return (
      <div className="h-full flex flex-col gap-1.5 justify-between">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11.5px] font-semibold text-ink truncate">{first.action_name}</span>
            <RiskBadge risk={first.risk_level} />
          </div>
          <div className="text-[10.5px] text-ink-2 line-clamp-2 mt-0.5">{first.request.summary}</div>
          {first.evidence?.impact && <div className="text-[10px] text-ink-muted line-clamp-2 mt-0.5">{first.evidence.impact}</div>}
        </div>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => decide(first, "approve")} className="flex-1 h-7 rounded-lg bg-emerald-500 text-white text-[11px] font-semibold cursor-pointer active:scale-95">
            Setujui
          </button>
          <button type="button" onClick={() => decide(first, "reject")} className="flex-1 h-7 rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold cursor-pointer active:scale-95">
            Tolak
          </button>
        </div>
        <div className="text-[9.5px] text-ink-muted">{pending.length > 1 ? `+${pending.length - 1} lainnya · ` : ""}Perbesar (L) untuk bukti & ubah</div>
      </div>
    );
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "pending", label: `Menunggu${pending.length ? ` (${pending.length})` : ""}` },
    { id: "history", label: "Riwayat" },
    { id: "policy", label: "Kebijakan" },
  ];
  return (
    <div className="h-full flex flex-col gap-2 min-h-0">
      <div className="flex items-center gap-1 flex-shrink-0">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`h-6 px-2.5 rounded-full text-[10.5px] font-semibold cursor-pointer ${tab === t.id ? "bg-accent text-white" : "bg-pill text-ink-2 hover:text-ink"}`}
          >
            {t.label}
          </button>
        ))}
        <button type="button" onClick={refresh} className="ml-auto w-6 h-6 rounded-full bg-pill text-ink-2 hover:text-ink flex items-center justify-center cursor-pointer" title="Segarkan" aria-label="Segarkan">
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
        {tab === "pending" &&
          (offline ? (
            <OfflineNotice onRetry={refresh} />
          ) : pending.length === 0 ? (
            <div className="h-full min-h-[140px] flex flex-col items-center justify-center gap-1.5 text-center">
              <Bot className="w-6 h-6 text-emerald-500" />
              <div className="text-[12px] font-medium text-ink">Tidak ada yang menunggu izinmu</div>
              <div className="text-[10.5px] text-ink-muted max-w-[220px]">Aksi berisiko tinggi (ubah pagu, timpa dokumen, jalankan perintah) berhenti di sini sampai kamu memutuskan.</div>
            </div>
          ) : (
            <div className="space-y-2">
              {pending.map((a) => (
                <ApprovalCard key={a.action_id} approval={a} now={now} onDecide={(d, edited) => decide(a, d, edited)} />
              ))}
            </div>
          ))}
        {tab === "history" && <HistoryTab />}
        {tab === "policy" && <PolicyTab />}
      </div>
    </div>
  );
};
