import React, { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Check, Eye, EyeOff, X } from "lucide-react";

interface ProviderStatus {
  keys: Record<string, boolean>;
  ollama: { online: boolean; models: string[] };
  council: Record<string, { name: string; provider: string; model: string }>;
}

interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

const KEY_FIELDS: Array<{ id: string; label: string; hint: string }> = [
  { id: "gemini_api_key", label: "Gemini API Key", hint: "aistudio.google.com/apikey" },
  { id: "anthropic_api_key", label: "Anthropic / Claude API Key", hint: "console.anthropic.com — Claude 3.5 Sonnet untuk Skripsi & Data Science" },
  { id: "deepseek_api_key", label: "DeepSeek API Key (opsional)", hint: "platform.deepseek.com — kosongkan jika pakai DeepSeek lokal" },
];

const ROLE_COPY: Record<string, string> = {
  worker: "Bikin draf pertama, cepat & lokal",
  reasoner: "Periksa logika dan hitungan",
  synth: "Tulis jawaban akhir",
};

const springModal = { type: "spring" as const, stiffness: 350, damping: 28 };

export const SettingsPanel: React.FC<SettingsPanelProps> = ({ isOpen, onClose }) => {
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/settings/providers");
      if (!res.ok) throw new Error("bad status");
      setStatus(await res.json());
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setMessage(null);
      load();
    }
  }, [isOpen, load]);

  if (!isOpen) return null;

  const save = async () => {
    // Only send fields the user actually typed; untouched fields keep their saved key.
    const body = Object.fromEntries(
      Object.entries(values).filter(([, v]) => v.trim().length > 0)
    );
    if (Object.keys(body).length === 0) {
      setMessage("Belum ada key yang diisi.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/v1/settings/api-keys", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("save failed");
      setValues({});
      setMessage("Tersimpan di file .env dan langsung aktif.");
      await load();
    } catch {
      setMessage("Gagal menyimpan. Pastikan backend menyala.");
    } finally {
      setSaving(false);
    }
  };

  const pulled = (model: string) => {
    const base = model.split(":")[0];
    return !!status?.ollama.models.some((m) => m.startsWith(base));
  };

  const memberReady = (key: string): boolean => {
    const member = status?.council[key];
    if (!member || !status) return false;
    if (member.provider === "gemini") return !!status.keys.gemini_api_key;
    if (member.provider === "deepseek") return !!status.keys.deepseek_api_key;
    return status.ollama.online && pulled(member.model);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-10 bg-black/75 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, y: -16, rotate: -0.4 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        transition={springModal}
        className="w-full max-w-md p-5 bg-[#121212] border border-white/8 rounded-2xl shadow-tactile-lifted text-[#FAF9F6]"
      >
        <div className="flex items-center justify-between pb-3 border-b border-white/8">
          <h2 className="font-editorial text-2xl tracking-tight">Otak Karsa</h2>
          <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white rounded-lg hover:bg-white/5 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loadError && (
          <p className="mt-3 text-xs text-[#D95D39]">Backend belum menyala di port 8765, status tidak bisa dibaca.</p>
        )}

        {/* API keys */}
        <section className="mt-4 space-y-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#D95D39]">01 · API Key</p>
          {KEY_FIELDS.map((f) => {
            const configured = !!status?.keys[f.id];
            return (
              <label key={f.id} className="block">
                <span className="flex items-center justify-between text-xs text-neutral-300">
                  {f.label}
                  <span className={`font-mono text-[10px] ${configured ? "text-[#3B7A57]" : "text-neutral-500"}`}>
                    {configured ? "● tersimpan" : "○ belum diisi"}
                  </span>
                </span>
                <div className="mt-1 flex items-center gap-1.5 bg-[#1A1917] border border-white/8 rounded-xl px-3 py-2 focus-within:border-[#D95D39]/80 transition">
                  <input
                    type={reveal[f.id] ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={configured ? "•••••••• (ketik untuk mengganti)" : "Tempel key di sini"}
                    value={values[f.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
                    className="flex-1 bg-transparent text-xs font-mono outline-none placeholder-neutral-600"
                  />
                  <button
                    type="button"
                    onClick={() => setReveal((r) => ({ ...r, [f.id]: !r[f.id] }))}
                    className="text-neutral-500 hover:text-neutral-200 transition"
                    title="Tampilkan / sembunyikan"
                  >
                    {reveal[f.id] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <span className="block mt-0.5 text-[10px] text-neutral-500">{f.hint}</span>
              </label>
            );
          })}
          <div className="flex items-center gap-3">
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-[#D95D39] hover:bg-[#B84827] text-white shadow-tactile-rest transition active:scale-[0.98] disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" /> {saving ? "Menyimpan…" : "Simpan"}
            </button>
            {message && <span className="text-[11px] text-neutral-400">{message}</span>}
          </div>
        </section>

        {/* Council roster */}
        <section className="mt-5 pt-4 border-t border-white/8">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[#D95D39]">02 · Tim Model (saling bantu)</p>
          <ol className="mt-2 space-y-2">
            {(["worker", "reasoner", "synth"] as const).map((key, i) => {
              const m = status?.council[key];
              const ready = memberReady(key);
              return (
                <li key={key} className="flex items-start gap-3">
                  <span className="font-editorial text-2xl leading-none text-neutral-600 w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{m?.name ?? "…"}</span>
                      <span className="font-mono text-[10px] text-neutral-500 truncate">{m?.model}</span>
                      <span className={`ml-auto font-mono text-[10px] ${ready ? "text-[#3B7A57]" : "text-neutral-500"}`}>
                        {ready ? "siap" : "belum siap"}
                      </span>
                    </div>
                    <p className="text-[11px] text-neutral-400">{ROLE_COPY[key]}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[11px] leading-relaxed text-neutral-500">
            Pertanyaan ringan dijawab Gemini saja (hemat token). Pertanyaan yang butuh penalaran jalan berantai:
            Hermes → DeepSeek → Gemini. Kalau satu model mati, sisanya tetap lanjut.
            {status && !status.ollama.online && " Ollama belum menyala, jadi Hermes & DeepSeek lokal dilewati."}
          </p>
        </section>
      </motion.div>
    </div>
  );
};
