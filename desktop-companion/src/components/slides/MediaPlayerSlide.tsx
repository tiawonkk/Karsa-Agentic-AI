import React, { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Mic2,
  Volume2,
  Disc3,
  ListMusic,
} from "lucide-react";

interface LyricLine {
  timeSec: number;
  text: string;
}

const DEMO_LYRICS: LyricLine[] = [
  { timeSec: 0, text: "♪ (Lofi ambient acoustic intro)" },
  { timeSec: 12, text: "Walking through the quiet halls at dawn" },
  { timeSec: 28, text: "Golden sun across the lecture lawn" },
  { timeSec: 46, text: "Equations fading into paper skies" },
  { timeSec: 64, text: "A gentle breeze before the city sighs" },
  { timeSec: 88, text: "We trace the lines of what we used to know" },
  { timeSec: 112, text: "And watch the quiet embers start to glow" },
  { timeSec: 140, text: "Stay right here, in the rhythm of the light" },
  { timeSec: 168, text: "Until the study notes dissolve into the night" },
  { timeSec: 193, text: "Lumen coast, where the shadows softly sway" },
  { timeSec: 220, text: "♪ (Subtle synth outro)" },
];

interface MediaPlayerSlideProps {
  isDark: boolean;
  onToggleLyricsState?: (open: boolean) => void;
}

export const MediaPlayerSlide: React.FC<MediaPlayerSlideProps> = ({
  isDark,
  onToggleLyricsState,
}) => {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(193); // 03:13
  const [showLyrics, setShowLyrics] = useState(false);
  const [trackTitle, setTrackTitle] = useState("Paper Sky");
  const [trackArtist, setTrackArtist] = useState("Lumen Coast • Lofi Focus");
  const totalDuration = 256; // 04:16
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (onToggleLyricsState) {
      onToggleLyricsState(showLyrics);
    }
  }, [showLyrics, onToggleLyricsState]);

  // Fetch real Windows media session (GSMTC)
  useEffect(() => {
    const fetchMedia = async () => {
      try {
        const res = await fetch("/api/v1/system/media-session");
        if (res.ok) {
          const data = await res.json();
          if (data.title && data.title !== "NoActiveSession") {
            setTrackTitle(data.title);
            setTrackArtist(
              `${data.artist || "Unknown Artist"}${data.album ? ` • ${data.album}` : ""}`
            );
            if (data.status === "Playing") {
              setIsPlaying(true);
            } else if (data.status === "Paused") {
              setIsPlaying(false);
            }
          }
        }
      } catch (_) {}
    };
    fetchMedia();
    const interval = setInterval(fetchMedia, 3000);
    return () => clearInterval(interval);
  }, []);

  // Playback timer ticker
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setCurrentTime((prev) => (prev >= totalDuration ? 0 : prev + 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying, totalDuration]);

  // Find active lyric index
  const activeLyricIdx = DEMO_LYRICS.reduce((acc, curr, idx) => {
    if (currentTime >= curr.timeSec) return idx;
    return acc;
  }, 0);

  // Auto-scroll lyrics container to active line
  useEffect(() => {
    if (lyricsContainerRef.current) {
      const activeEl = lyricsContainerRef.current.children[activeLyricIdx] as HTMLElement;
      if (activeEl) {
        lyricsContainerRef.current.scrollTo({
          top: activeEl.offsetTop - lyricsContainerRef.current.offsetTop - 40,
          behavior: "smooth",
        });
      }
    }
  }, [activeLyricIdx]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const remainingTime = totalDuration - currentTime;

  return (
    <div className="w-full flex items-stretch gap-3 select-none">
      {/* Left Column: Player Controls & Vinyl Art */}
      <div
        className={`flex-1 rounded-2xl p-3 flex flex-col justify-between transition-colors ${
          isDark
            ? "bg-[#0c0c0e] border border-white/8"
            : "bg-white border border-zinc-200/80 shadow-sm"
        }`}
      >
        {/* Track Header & Animated Equalizer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 truncate">
            {/* Spinning Vinyl Disc Cover */}
            <div
              className={`w-9 h-9 rounded-full bg-gradient-to-tr from-orange-600 via-amber-500 to-rose-500 flex items-center justify-center shadow-md relative overflow-hidden flex-shrink-0 ${
                isPlaying ? "animate-spin" : ""
              }`}
              style={{ animationDuration: "6s" }}
            >
              <div className="w-3.5 h-3.5 rounded-full bg-black/90 border border-white/20 flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-orange-400" />
              </div>
            </div>

            <div className="truncate">
              <h4 className="text-xs font-semibold tracking-tight truncate leading-tight">
                {trackTitle}
              </h4>
              <p className="text-[10px] text-zinc-400 truncate">{trackArtist}</p>
            </div>
          </div>

          {/* Equalizer Bars Animated */}
          <div className="flex items-end gap-0.5 h-3.5 flex-shrink-0">
            <span
              className={`w-0.5 rounded-full bg-orange-500 ${
                isPlaying ? "animate-pulse h-3.5" : "h-1"
              }`}
            />
            <span
              className={`w-0.5 rounded-full bg-orange-500 ${
                isPlaying ? "animate-pulse h-2 delay-100" : "h-1"
              }`}
            />
            <span
              className={`w-0.5 rounded-full bg-orange-500 ${
                isPlaying ? "animate-pulse h-3 delay-200" : "h-1"
              }`}
            />
            <span
              className={`w-0.5 rounded-full bg-orange-500 ${
                isPlaying ? "animate-pulse h-2.5 delay-75" : "h-1"
              }`}
            />
          </div>
        </div>

        {/* Progress Bar Scrubber */}
        <div className="space-y-1 my-1.5">
          <div
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              setCurrentTime(Math.floor(pct * totalDuration));
            }}
            className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden cursor-pointer relative"
          >
            <div
              className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full"
              style={{ width: `${(currentTime / totalDuration) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-[9px] font-mono text-zinc-400">
            <span>{formatTime(currentTime)}</span>
            <span>-{formatTime(remainingTime)}</span>
          </div>
        </div>

        {/* Media Buttons */}
        <div className="flex items-center justify-between pt-0.5">
          <button
            type="button"
            onClick={() => setShowLyrics((prev) => !prev)}
            className={`p-1.5 rounded-lg text-xs transition-colors cursor-pointer flex items-center gap-1 ${
              showLyrics
                ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
            title="Toggle Live Lyrics Split View"
          >
            <Mic2 className="w-3.5 h-3.5" />
            <span className="text-[10px] font-medium hidden sm:inline">Lirik</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentTime((prev) => Math.max(0, prev - 15))}
              className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
              title="Prev 15s"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              className="w-7 h-7 rounded-full bg-orange-600 hover:bg-orange-500 text-white flex items-center justify-center shadow-md transition-all cursor-pointer"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => setCurrentTime((prev) => Math.min(totalDuration, prev + 15))}
              className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
              title="Next 15s"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex items-center text-zinc-400 text-[10px] font-mono gap-1">
            <Volume2 className="w-3 h-3 opacity-60" />
            <span>80%</span>
          </div>
        </div>
      </div>

      {/* Right Column: Live Synced Lyrics (Split View) */}
      {showLyrics && (
        <div
          ref={lyricsContainerRef}
          className={`flex-1 max-h-[142px] overflow-y-auto rounded-2xl p-2.5 transition-colors relative space-y-1.5 scroll-smooth ${
            isDark
              ? "bg-[#0c0c0e]/90 border border-white/8 text-zinc-300"
              : "bg-white border border-zinc-200 text-zinc-700 shadow-sm"
          }`}
        >
          <div className="text-[9px] font-mono uppercase tracking-wider text-orange-400/80 sticky top-0 bg-transparent flex items-center gap-1 mb-1">
            <ListMusic className="w-2.5 h-2.5" />
            <span>Synced Lyrics</span>
          </div>

          {DEMO_LYRICS.map((line, idx) => {
            const isActive = idx === activeLyricIdx;
            return (
              <div
                key={line.timeSec}
                onClick={() => setCurrentTime(line.timeSec)}
                className={`text-xs py-1 px-2 rounded-lg transition-all duration-200 cursor-pointer ${
                  isActive
                    ? isDark
                      ? "text-white font-bold bg-white/10 scale-[1.02] shadow-sm"
                      : "text-zinc-950 font-bold bg-orange-50 scale-[1.02]"
                    : "opacity-40 hover:opacity-80"
                }`}
              >
                {line.text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MediaPlayerSlide;
