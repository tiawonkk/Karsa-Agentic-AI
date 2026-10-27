import React, { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldOff, Smartphone } from "lucide-react";

interface Addr {
  interface: string;
  ip: string;
  kind: "lan" | "tailscale";
  url: string;
  plain: string;
  reachable: boolean;
  qr_svg: string;
}
interface Info {
  enabled: boolean;
  port: number;
  lan_reachable: boolean;
  addresses: Addr[];
  qr_svg: string | null;
}

/** Settings > HP: scan the QR with the phone camera to pair. The token lives only inside the QR (never shown as text). */
export const MobileConnectPanel: React.FC = () => {
  const [info, setInfo] = useState<Info | null>(null);
  const [idx, setIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/v1/mobile/connection");
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? `HTTP ${r.status}`);
      const d: Info = await r.json();
      setInfo(d);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Tidak bisa memuat info koneksi.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (path: string, body?: unknown) => {
    setBusy(true);
    try {
      await fetch(`/api/v1/mobile/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (error) return <div className="text-rose-500 text-[11px]">{error}</div>;
  if (!info) return <div className="text-zinc-400 text-[11px]">Memuat…</div>;
  const addr = info.addresses[idx] ?? info.addresses[0];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone className="w-4 h-4 text-sky-400" />
        <div className="font-semibold">Koneksi HP</div>
        <label className="ml-auto flex items-center gap-1.5 cursor-pointer text-[11px]">
          <input type="checkbox" checked={info.enabled} onChange={(e) => post("enabled", { enabled: e.target.checked })} disabled={busy} />
          Izinkan HP
        </label>
      </div>

      {!info.enabled && (
        <div className="rounded-lg bg-amber-500/10 text-amber-500 p-2 flex gap-2 items-start">
          <ShieldOff className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          Akses dari HP dimatikan. HP yang sudah dipasangkan tidak bisa membuka Karsa sampai kamu menyalakannya lagi.
        </div>
      )}

      {info.addresses.length === 0 ? (
        <div className="text-zinc-400">Tidak ditemukan jaringan Wi-Fi/LAN aktif. Sambungkan laptop ke Wi-Fi yang sama dengan HP.</div>
      ) : (
        <>
          {info.addresses.length > 1 && (
            <select value={idx} onChange={(e) => setIdx(Number(e.target.value))} className="w-full h-8 px-2 rounded-lg bg-white/10 outline-none" aria-label="Pilih jaringan">
              {info.addresses.map((a, i) => (
                <option key={a.ip} value={i} className="text-black">{a.kind === "tailscale" ? "Tailscale" : "Wi-Fi/LAN"} · {a.ip} ({a.interface})</option>
              ))}
            </select>
          )}
          <div className="flex gap-3 items-start">
            <div className="bg-white p-1.5 rounded-lg w-[132px] h-[132px] flex-shrink-0 [&>svg]:w-full [&>svg]:h-full" aria-label="Kode QR pairing">
              <div dangerouslySetInnerHTML={{ __html: addr.qr_svg }} />
            </div>
            <div className="space-y-1.5 min-w-0">
              <div>Pindai dengan kamera HP, lalu pilih <b>Tambahkan ke layar utama</b> agar Karsa jadi aplikasi.</div>
              <div className="font-mono text-[10.5px] break-all text-zinc-400">{addr.plain}</div>
              <div className={addr.reachable ? "text-emerald-400" : "text-amber-400"}>
                {addr.reachable
                  ? "Server Karsa terjangkau di alamat ini."
                  : "Server belum terjangkau dari jaringan. Jalankan dengan run_karsa_phone.bat (host 0.0.0.0) dan izinkan Python di firewall Windows."}
              </div>
            </div>
          </div>
        </>
      )}

      <div className="rounded-lg bg-white/5 p-2 space-y-1.5">
        <div className="text-zinc-400 leading-snug">
          Hanya perangkat yang memindai kode ini yang bisa masuk. Kode berlaku sampai kamu menekan tombol di bawah, yang langsung memutus semua HP.
        </div>
        <button type="button" onClick={() => post("token/regenerate")} disabled={busy} className="h-8 px-3 rounded-full bg-rose-500/90 text-white text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
          <RefreshCw className="w-3 h-3" /> Buat kode baru &amp; putuskan semua HP
        </button>
      </div>
    </div>
  );
};
