import React, { useCallback, useEffect, useState } from "react";
import { Check, ExternalLink, Loader2, RotateCcw, Zap } from "lucide-react";

interface PurposeRow {
  purpose: string;
  label: string;
  provider: string;
  model: string;
  source: "default" | "auto" | "custom";
  ready: boolean;
}
interface ProviderRow {
  id: string;
  label: string;
  free: string;
  key_url: string;
  models: string[];
  has_key: boolean;
}
interface Plan {
  purposes: PurposeRow[];
  providers: ProviderRow[];
}
interface TestResult {
  ok: boolean;
  latency_ms?: number;
  error?: string;
}

const SOURCE_LABEL: Record<PurposeRow["source"], string> = { default: "otomatis", auto: "otomatis (ganti penyedia)", custom: "pilihanmu" };

/**
 * "AI per Tugas": every part of Karsa (chat, research, writing, code...) can use a different provider/model. Free
 * providers are listed first; if one runs out or is slow, Karsa fails over to the next one that has a key.
 */
export const ModelPlanPanel: React.FC = () => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [offline, setOffline] = useState(false);
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestResult | "loading">>({});
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/settings/plan");
      if (!res.ok) throw new Error(String(res.status));
      setPlan(await res.json());
      setOffline(false);
    } catch (_) {
      setOffline(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const choose = async (purpose: string, provider: string | null, model?: string) => {
    const res = await fetch(`/api/v1/settings/plan/${purpose}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, model: model ?? null }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) setPlan(body);
    else setMsg(body.detail || "Gagal menyimpan");
    setTests((t) => ({ ...t, [purpose]: undefined as never }));
  };

  const saveKey = async (provider: string) => {
    const res = await fetch("/api/v1/settings/provider-key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, api_key: keyDraft[provider] ?? "" }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      setPlan(body.plan);
      setKeyDraft((d) => ({ ...d, [provider]: "" }));
      setOpenKey(null);
      setMsg(body.has_key ? "Kunci disimpan." : "Kunci dihapus.");
    } else setMsg(body.detail || "Gagal menyimpan kunci");
  };

  const test = async (purpose: string) => {
    setTests((t) => ({ ...t, [purpose]: "loading" }));
    try {
      const res = await fetch(`/api/v1/settings/plan/${purpose}/test`, { method: "POST" });
      const result: TestResult = res.ok ? await res.json() : { ok: false, error: `Server ${res.status}` };
      setTests((t) => ({ ...t, [purpose]: result }));
    } catch (_) {
      setTests((t) => ({ ...t, [purpose]: { ok: false, error: "Server tidak terjangkau" } }));
    }
  };

  if (offline) return <div className="text-rose-400 text-[11px]">Server Karsa tidak terjangkau. Jalankan backend lalu buka lagi.</div>;
  if (!plan) return <div className="text-zinc-400 text-[11px]">Memuat…</div>;

  const provider = (id: string) => plan.providers.find((p) => p.id === id);
  return (
    <div className="space-y-3">
      <p className="text-[10.5px] text-zinc-400 leading-snug">
        Pilih AI yang paling cocok untuk tiap tugas. Kunci gratis cukup: kalau satu penyedia habis atau lambat, Karsa otomatis pindah ke penyedia lain yang punya kunci.
      </p>

      <div className="space-y-2">
        {plan.purposes.map((row) => {
          const p = provider(row.provider);
          const t = tests[row.purpose];
          return (
            <div key={row.purpose} className="rounded-xl border border-subtle p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-semibold flex-1 min-w-0 truncate">{row.label}</span>
                <span className="text-[9.5px] text-zinc-400">{SOURCE_LABEL[row.source]}</span>
                {row.source === "custom" && (
                  <button type="button" onClick={() => choose(row.purpose, null)} title="Kembali ke otomatis" aria-label="Kembali ke otomatis" className="text-zinc-400 hover:text-zinc-100 cursor-pointer">
                    <RotateCcw className="w-3 h-3" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  value={row.provider}
                  onChange={(e) => choose(row.purpose, e.target.value, provider(e.target.value)?.models[0])}
                  className="h-7 rounded-lg bg-pill border border-subtle text-[10.5px] px-1 outline-none cursor-pointer min-w-0 flex-1"
                  aria-label={`Penyedia untuk ${row.label}`}
                >
                  {plan.providers.map((pr) => (
                    <option key={pr.id} value={pr.id}>
                      {pr.label} {pr.has_key ? "✓" : "(belum ada kunci)"}
                    </option>
                  ))}
                </select>
                <input
                  key={`${row.purpose}:${row.provider}:${row.model}`}
                  defaultValue={row.model}
                  list={`models-${row.purpose}`}
                  onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== row.model && choose(row.purpose, row.provider, e.target.value.trim())}
                  spellCheck={false}
                  className="h-7 rounded-lg bg-pill border border-subtle text-[10.5px] font-mono px-2 outline-none min-w-0 flex-1"
                  aria-label={`Nama model untuk ${row.label}`}
                />
                <datalist id={`models-${row.purpose}`}>{p?.models.map((m) => <option key={m} value={m} />)}</datalist>
                <button type="button" onClick={() => test(row.purpose)} disabled={!row.ready || t === "loading"} className="h-7 w-7 rounded-lg bg-pill text-zinc-300 hover:text-white flex items-center justify-center disabled:opacity-40 cursor-pointer flex-shrink-0" title="Tes kecepatan" aria-label={`Tes ${row.label}`}>
                  {t === "loading" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Zap className="w-3.5 h-3.5" />}
                </button>
              </div>
              {!row.ready && <div className="text-[10px] text-amber-400">Belum ada kunci untuk {p?.label}. Tempel kunci di bawah.</div>}
              {t && t !== "loading" && (
                <div className={`text-[10px] ${t.ok ? "text-emerald-400" : "text-rose-400"}`}>
                  {t.ok ? `Siap · ${t.latency_ms} ms` : `Gagal: ${t.error}`}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400 mb-1">Kunci penyedia</div>
        <div className="space-y-1.5">
          {plan.providers
            .filter((p) => p.id !== "ollama")
            .map((p) => (
              <div key={p.id} className="rounded-xl border border-subtle px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold">{p.label}</span>
                  {p.has_key && <Check className="w-3 h-3 text-emerald-400" />}
                  <span className="text-[9.5px] text-zinc-400 flex-1 min-w-0 truncate">{p.free}</span>
                  <a href={p.key_url} target="_blank" rel="noreferrer" className="text-zinc-400 hover:text-zinc-100" title="Ambil kunci" aria-label={`Ambil kunci ${p.label}`}>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button type="button" onClick={() => setOpenKey(openKey === p.id ? null : p.id)} className="text-[10px] font-medium text-zinc-300 hover:text-white underline-offset-2 hover:underline cursor-pointer">
                    {p.has_key ? "Ganti" : "Pasang"}
                  </button>
                </div>
                {openKey === p.id && (
                  <form
                    className="flex items-center gap-1.5 mt-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      saveKey(p.id);
                    }}
                  >
                    <input
                      type="password"
                      autoComplete="off"
                      value={keyDraft[p.id] ?? ""}
                      onChange={(e) => setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      placeholder={`Tempel kunci ${p.label}`}
                      className="flex-1 min-w-0 h-7 rounded-lg bg-pill border border-subtle text-[10.5px] font-mono px-2 outline-none"
                    />
                    <button type="submit" className="h-7 px-2.5 rounded-lg bg-accent text-white text-[10.5px] font-semibold cursor-pointer">
                      Simpan
                    </button>
                    {p.has_key && (
                      <button type="button" onClick={() => (setKeyDraft((d) => ({ ...d, [p.id]: "" })), saveKey(p.id))} className="h-7 px-2 rounded-lg bg-pill text-rose-400 text-[10.5px] cursor-pointer">
                        Hapus
                      </button>
                    )}
                  </form>
                )}
              </div>
            ))}
        </div>
      </div>
      {msg && <div className="text-[10.5px] text-zinc-300">{msg}</div>}
      <p className="text-[9.5px] text-zinc-500 leading-snug">
        Batas gratis dan nama model berubah sewaktu-waktu; cek dashboard penyedia bila ada yang gagal. Nama model boleh diketik bebas.
      </p>
    </div>
  );
};
