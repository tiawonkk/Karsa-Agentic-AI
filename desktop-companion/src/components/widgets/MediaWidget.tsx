import React, { useCallback, useEffect, useRef, useState } from "react";
import { Music2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { WidgetSize } from "../../context/WidgetsContext";

export interface LyricLine {
  time: number;
  text: string;
}

export const parseLrc = (lrc: string): LyricLine[] => {
  const out: LyricLine[] = [];
  const re = /\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?\](.*)/;
  for (const line of lrc.split("\n")) {
    const m = re.exec(line);
    if (!m) continue;
    const text = m[4].trim();
    if (text) out.push({ time: +m[1] * 60 + +m[2] + (m[3] ? +m[3].padEnd(3, "0").slice(0, 3) / 1000 : 0), text });
  }
  return out.sort((a, b) => a.time - b.time);
};

const clock = (s: number) => {
  const v = Math.max(0, Math.floor(s));
  return `${String(Math.floor(v / 60)).padStart(2, "0")}:${String(v % 60).padStart(2, "0")}`;
};

/** Real Windows media session (GSMTC) with real transport controls and a timeline. */
export function useMedia() {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [active, setActive] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  const poll = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/system/media-session");
      if (!res.ok) return;
      const d = await res.json();
      if (d?.title && d.title !== "Tidak ada media yang diputar" && d.title !== "NoActiveSession") {
        setTitle(d.title);
        setArtist(d.artist || "");
        setActive(true);
        setPlaying(String(d.status).toLowerCase() === "playing");
        setDuration(typeof d.duration_s === "number" ? d.duration_s : 0);
        if (typeof d.position_s === "number") setPosition(d.position_s);
      } else {
        setActive(false);
        setPlaying(false);
        setTitle("");
        setArtist("");
        setDuration(0);
      }
    } catch (_) {
      setActive(false);
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, [poll]);

  // Smooth local ticking between polls
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setPosition((p) => p + 0.5), 500);
    return () => clearInterval(id);
  }, [playing]);

  const control = async (action: "play_pause" | "next" | "previous") => {
    if (!active) return;
    if (action === "play_pause") setPlaying((p) => !p);
    await fetch("/api/v1/system/media/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
    setTimeout(poll, 500);
  };

  return { title, artist, active, playing, position, duration, control };
}

export const MediaBody: React.FC<{ size: WidgetSize }> = ({ size }) => {
  const m = useMedia();
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [plain, setPlain] = useState<string[]>([]);
  const [lyricsState, setLyricsState] = useState<"idle" | "loading" | "none">("idle");
  const activeRef = useRef<HTMLDivElement | null>(null);

  // Lyrics (LRCLIB) only for the L layout
  useEffect(() => {
    if (size !== "L" || !m.active || !m.title) {
      setLyrics([]);
      setPlain([]);
      return;
    }
    let cancelled = false;
    setLyricsState("loading");
    const cleanTitle = m.title.replace(/\s*[(\[].*?[)\]]/g, "").trim();
    const cleanArtist = m.artist.split("•")[0].trim();
    fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanArtist} ${cleanTitle}`)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((res) => {
        if (cancelled) return;
        const first = Array.isArray(res) ? res[0] : null;
        if (first?.syncedLyrics) {
          setLyrics(parseLrc(first.syncedLyrics));
          setPlain([]);
          setLyricsState("idle");
        } else if (first?.plainLyrics) {
          setLyrics([]);
          setPlain(String(first.plainLyrics).split("\n"));
          setLyricsState("idle");
        } else {
          setLyrics([]);
          setPlain([]);
          setLyricsState("none");
        }
      })
      .catch(() => {
        if (!cancelled) setLyricsState("none");
      });
    return () => {
      cancelled = true;
    };
  }, [size, m.active, m.title, m.artist]);

  const currentIdx = lyrics.findIndex((l, i) => m.position >= l.time && (!lyrics[i + 1] || m.position < lyrics[i + 1].time));
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [currentIdx]);

  const playBtn = (cls: string) => (
    <button
      type="button"
      onClick={() => m.control("play_pause")}
      disabled={!m.active}
      className={`rounded-full bg-accent text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer active:scale-95 transition-transform ${cls}`}
      title={m.playing ? "Pause" : "Play"}
      aria-label={m.playing ? "Pause" : "Play"}
    >
      {m.playing ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
    </button>
  );

  if (size === "S") {
    return (
      <div className="w-full flex items-center justify-between gap-2 pr-1 overflow-hidden">
        <span className="flex items-center gap-1.5 min-w-0 text-[12px] font-semibold text-ink">
          <span aria-hidden="true">🎵</span>
          <span className="truncate">{m.active ? m.title : "Tidak ada musik"}</span>
        </span>
        {playBtn("w-7 h-7 flex-shrink-0")}
      </div>
    );
  }

  const info = (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-orange-500 via-amber-400 to-rose-500 flex items-center justify-center flex-shrink-0">
        <Music2 className="w-5 h-5 text-white" />
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink truncate leading-tight">
          {m.active ? m.title : "Tidak ada musik diputar"}
        </div>
        <div className="text-[11px] text-ink-2 truncate">{m.active ? m.artist || "—" : "Putar lagu di Spotify atau YouTube"}</div>
      </div>
    </div>
  );

  const pct = m.duration > 0 ? Math.min(100, (m.position / m.duration) * 100) : 0;
  const progress = (
    <div className="flex items-center gap-2 font-mono text-[10px] text-ink-2">
      <span className="w-8 text-right">{m.active && m.duration > 0 ? clock(m.position) : "--:--"}</span>
      <div className="flex-1 h-1 rounded-full bg-pill overflow-hidden">
        <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-9">{m.active && m.duration > 0 ? `-${clock(m.duration - m.position)}` : "--:--"}</span>
    </div>
  );

  const controls = (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() => m.control("previous")}
        disabled={!m.active}
        className="w-7 h-7 rounded-full text-ink flex items-center justify-center hover:bg-pill disabled:opacity-40 cursor-pointer"
        title="Sebelumnya"
        aria-label="Sebelumnya"
      >
        <SkipBack className="w-4 h-4 fill-current" />
      </button>
      {playBtn("w-9 h-9")}
      <button
        type="button"
        onClick={() => m.control("next")}
        disabled={!m.active}
        className="w-7 h-7 rounded-full text-ink flex items-center justify-center hover:bg-pill disabled:opacity-40 cursor-pointer"
        title="Berikutnya"
        aria-label="Berikutnya"
      >
        <SkipForward className="w-4 h-4 fill-current" />
      </button>
    </div>
  );

  if (size === "M") {
    return (
      <div className="h-full flex flex-col justify-between">
        {info}
        {progress}
        {controls}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-2.5 min-h-0">
      {info}
      {progress}
      {controls}
      <div className="flex-1 min-h-0 overflow-y-auto rounded-xl bg-card border border-subtle px-3 py-2 text-center space-y-1.5">
        {!m.active ? (
          <div className="text-[11px] text-ink-muted pt-4">Putar lagu untuk melihat lirik langsung.</div>
        ) : lyricsState === "loading" ? (
          <div className="text-[11px] text-ink-muted pt-4">Memuat lirik dari LRCLIB…</div>
        ) : lyrics.length > 0 ? (
          lyrics.map((l, i) => (
            <div
              key={i}
              ref={i === currentIdx ? activeRef : null}
              className={`text-[12px] transition-all duration-300 ${
                i === currentIdx ? "font-semibold text-ink scale-105" : "text-ink-muted opacity-70"
              }`}
            >
              {l.text}
            </div>
          ))
        ) : plain.length > 0 ? (
          plain.map((l, i) => (
            <div key={i} className="text-[12px] text-ink-2">
              {l}
            </div>
          ))
        ) : (
          <div className="text-[11px] text-ink-muted pt-4">Lirik tidak ditemukan untuk lagu ini.</div>
        )}
      </div>
    </div>
  );
};
