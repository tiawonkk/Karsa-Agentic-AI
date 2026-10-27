import { useSyncExternalStore } from "react";

/* ------------------------------------------------------------------------------------------------------------------
 * Mood: how Karsa feels right now. Set by the app (thinking while the AI works, speaking while it answers, worried when
 * it needs an approval...). One shared store so the notch, the Wardrobe preview and the big stage all agree.
 * ---------------------------------------------------------------------------------------------------------------- */
export type Mood = "idle" | "thinking" | "speaking" | "happy" | "worried" | "listening";

let mood: Mood = "idle";
let moodTimer: ReturnType<typeof setTimeout> | null = null;
const moodListeners = new Set<() => void>();

/** `holdMs` makes it a short-lived mood that falls back to idle (e.g. a 2.5 s celebration). */
export const setMood = (next: Mood, holdMs?: number) => {
  if (moodTimer) clearTimeout(moodTimer);
  moodTimer = null;
  if (mood !== next) {
    mood = next;
    moodListeners.forEach((l) => l());
  }
  if (holdMs && next !== "idle") moodTimer = setTimeout(() => setMood("idle"), holdMs);
};

export function useJellyMood(): Mood {
  return useSyncExternalStore(
    (cb) => {
      moodListeners.add(cb);
      return () => moodListeners.delete(cb);
    },
    () => mood
  );
}

/* ------------------------------------------------------------------------------------------------------------------
 * Accessories: vector presets that attach to Karsa (so they scale with it, work on light and dark, and can be moved,
 * resized, rotated and recoloured), plus the user's own drawings ("custom", an embedded PNG).
 * Units: 1 = Karsa's body radius. Position is relative to the body centre.
 * ---------------------------------------------------------------------------------------------------------------- */
export interface OutfitItem {
  id: string;
  /** preset key, or "custom" for a drawn image in `src` */
  kind: string;
  src?: string;
  x: number;
  y: number;
  /** scale */
  s: number;
  /** rotation in degrees */
  rot: number;
  color: string;
}

type DrawFn = (ctx: CanvasRenderingContext2D, color: string) => void;
interface Preset {
  label: string;
  emoji: string;
  defaults: { x: number; y: number; s: number; rot: number; color: string };
  draw: DrawFn;
}

const star = (ctx: CanvasRenderingContext2D, r: number) => {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.45;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
};

const shade = (hex: string, amt: number): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f((n >> 16) & 255)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};

export const PRESETS: Record<string, Preset> = {
  party_hat: {
    label: "Topi Pesta",
    emoji: "🎉",
    defaults: { x: 0, y: -0.86, s: 1, rot: 0, color: "#FF5CA8" },
    draw: (ctx, c) => {
      ctx.beginPath();
      ctx.moveTo(-0.4, 0.02);
      ctx.lineTo(0, -0.95);
      ctx.lineTo(0.4, 0.02);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.lineWidth = 0.09;
      for (const y of [-0.62, -0.32, -0.02]) {
        ctx.beginPath();
        ctx.moveTo(-0.5, y + 0.14);
        ctx.lineTo(0.5, y - 0.14);
        ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath();
      ctx.arc(0, -0.97, 0.1, 0, Math.PI * 2);
      ctx.fillStyle = "#FFF5B8";
      ctx.fill();
    },
  },
  crown: {
    label: "Mahkota",
    emoji: "👑",
    defaults: { x: 0, y: -0.9, s: 0.9, rot: 0, color: "#FFC93C" },
    draw: (ctx, c) => {
      const g = ctx.createLinearGradient(0, -0.4, 0, 0.3);
      g.addColorStop(0, "#FFF1A8");
      g.addColorStop(0.4, c);
      g.addColorStop(1, shade(c, -0.15));
      ctx.beginPath();
      ctx.moveTo(-0.52, 0.28);
      ctx.lineTo(-0.52, -0.2);
      ctx.lineTo(-0.26, 0.02);
      ctx.lineTo(0, -0.38);
      ctx.lineTo(0.26, 0.02);
      ctx.lineTo(0.52, -0.2);
      ctx.lineTo(0.52, 0.28);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 0.035;
      ctx.stroke();
      for (const [x, y, col] of [[-0.52, -0.2, "#FF6B9D"], [0, -0.38, "#6BD6FF"], [0.52, -0.2, "#FF6B9D"]] as const) {
        ctx.beginPath();
        ctx.arc(x, y, 0.07, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();
      }
    },
  },
  bow: {
    label: "Pita",
    emoji: "🎀",
    defaults: { x: 0.6, y: -0.84, s: 0.75, rot: 20, color: "#FF6B9D" },
    draw: (ctx, c) => {
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(side * 0.35, -0.42, side * 0.62, -0.28);
        ctx.quadraticCurveTo(side * 0.7, 0, side * 0.62, 0.28);
        ctx.quadraticCurveTo(side * 0.35, 0.42, 0, 0);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.strokeStyle = shade(c, -0.12);
        ctx.lineWidth = 0.03;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 0.13, 0, Math.PI * 2);
      ctx.fillStyle = shade(c, -0.1);
      ctx.fill();
    },
  },
  glasses: {
    label: "Kacamata",
    emoji: "👓",
    defaults: { x: 0, y: -0.02, s: 1, rot: 0, color: "#2A1B3D" },
    draw: (ctx, c) => {
      ctx.lineWidth = 0.07;
      ctx.strokeStyle = c;
      for (const x of [-0.36, 0.36]) {
        ctx.beginPath();
        ctx.arc(x, 0, 0.26, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fill();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(0, -0.04, 0.1, 1.1 * Math.PI, 1.9 * Math.PI);
      ctx.stroke();
    },
  },
  shades: {
    label: "Kacamata Hitam",
    emoji: "🕶️",
    defaults: { x: 0, y: -0.02, s: 1.02, rot: 0, color: "#1B1B2A" },
    draw: (ctx, c) => {
      ctx.fillStyle = c;
      for (const x of [-0.36, 0.36]) {
        ctx.beginPath();
        ctx.roundRect(x - 0.28, -0.2, 0.56, 0.4, 0.14);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(x - 0.1, -0.08, 0.1, 0.045, -0.5, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fill();
        ctx.fillStyle = c;
      }
      ctx.fillRect(-0.1, -0.1, 0.2, 0.06);
    },
  },
  headphones: {
    label: "Headphone",
    emoji: "🎧",
    defaults: { x: 0, y: 0.04, s: 1, rot: 0, color: "#7C5CFF" },
    draw: (ctx, c) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = 0.11;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(0, 0, 1.02, 1.06 * Math.PI, 1.94 * Math.PI);
      ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.roundRect(side * 1.02 - 0.12, -0.2, 0.24, 0.46, 0.1);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.beginPath();
        ctx.roundRect(side * 1.02 - 0.06, -0.1, 0.12, 0.26, 0.06);
        ctx.fillStyle = shade(c, 0.28);
        ctx.fill();
      }
    },
  },
  flower: {
    label: "Bunga",
    emoji: "🌸",
    defaults: { x: -0.62, y: -0.84, s: 0.6, rot: -10, color: "#FF8FB8" },
    draw: (ctx, c) => {
      for (let i = 0; i < 5; i++) {
        ctx.save();
        ctx.rotate((i * Math.PI * 2) / 5);
        ctx.beginPath();
        ctx.ellipse(0, -0.28, 0.2, 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = c;
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 0.17, 0, Math.PI * 2);
      ctx.fillStyle = "#FFD84D";
      ctx.fill();
    },
  },
  halo: {
    label: "Halo",
    emoji: "😇",
    defaults: { x: 0, y: -1.32, s: 1, rot: 0, color: "#FFD84D" },
    draw: (ctx, c) => {
      ctx.save();
      ctx.shadowColor = c;
      ctx.shadowBlur = 0.25;
      ctx.beginPath();
      ctx.ellipse(0, 0, 0.5, 0.14, 0, 0, Math.PI * 2);
      ctx.strokeStyle = c;
      ctx.lineWidth = 0.08;
      ctx.stroke();
      ctx.restore();
    },
  },
  wizard_hat: {
    label: "Topi Penyihir",
    emoji: "🧙",
    defaults: { x: 0, y: -0.86, s: 1.05, rot: 0, color: "#5B3FD0" },
    draw: (ctx, c) => {
      ctx.beginPath();
      ctx.moveTo(-0.5, 0.04);
      ctx.quadraticCurveTo(-0.1, -0.5, 0.18, -1.0);
      ctx.quadraticCurveTo(0.4, -1.12, 0.52, -0.95);
      ctx.quadraticCurveTo(0.34, -0.5, 0.5, 0.04);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 0.06, 0.82, 0.14, 0, 0, Math.PI * 2);
      ctx.fillStyle = shade(c, -0.1);
      ctx.fill();
      ctx.fillStyle = "#FFD84D";
      ctx.save();
      ctx.translate(0.02, -0.38);
      star(ctx, 0.13);
      ctx.fill();
      ctx.restore();
    },
  },
  scarf: {
    label: "Syal",
    emoji: "🧣",
    defaults: { x: 0, y: 0.66, s: 1, rot: 0, color: "#FF7A45" },
    draw: (ctx, c) => {
      ctx.strokeStyle = c;
      ctx.lineWidth = 0.22;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-0.82, -0.04);
      ctx.quadraticCurveTo(0, 0.3, 0.82, -0.04);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = 0.04;
      ctx.beginPath();
      ctx.moveTo(-0.7, 0.0);
      ctx.quadraticCurveTo(0, 0.28, 0.7, 0.0);
      ctx.stroke();
      ctx.save();
      ctx.translate(0.42, 0.12);
      ctx.rotate(-0.15);
      ctx.beginPath();
      ctx.roundRect(-0.12, 0, 0.24, 0.5, 0.08);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.restore();
    },
  },
  mustache: {
    label: "Kumis",
    emoji: "🥸",
    defaults: { x: 0, y: 0.17, s: 0.7, rot: 0, color: "#3B2A20" },
    draw: (ctx, c) => {
      ctx.fillStyle = c;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, -0.04);
        ctx.bezierCurveTo(side * 0.22, -0.2, side * 0.5, -0.12, side * 0.55, 0.1);
        ctx.bezierCurveTo(side * 0.35, 0.02, side * 0.2, 0.08, 0, 0.06);
        ctx.closePath();
        ctx.fill();
      }
    },
  },
  star: {
    label: "Bintang",
    emoji: "⭐",
    defaults: { x: 0.62, y: -0.8, s: 0.6, rot: 12, color: "#FFD84D" },
    draw: (ctx, c) => {
      star(ctx, 0.5);
      ctx.fillStyle = c;
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 0.05;
      ctx.stroke();
    },
  },
};

export const PRESET_IDS = Object.keys(PRESETS);
export const MAX_OUTFIT_ITEMS = 8;
const HEX = /^#[0-9a-fA-F]{6}$/;

const clamp = (v: number, lo: number, hi: number, fallback: number) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);

/** Make any stored/typed item safe to draw (unknown presets and out-of-range numbers are corrected or dropped). */
export function sanitizeItem(raw: Partial<OutfitItem>): OutfitItem | null {
  const kind = raw.kind === "custom" ? "custom" : raw.kind && PRESETS[raw.kind] ? raw.kind : null;
  if (!kind) return null;
  if (kind === "custom" && !(typeof raw.src === "string" && raw.src.startsWith("data:image/png;base64,") && raw.src.length < 200_000)) return null;
  const d = kind === "custom" ? { x: 0, y: -0.95, s: 1.2, rot: 0, color: "#FFFFFF" } : PRESETS[kind].defaults;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id.slice(0, 40) : `${kind}_${Date.now().toString(36)}`,
    kind,
    src: kind === "custom" ? raw.src : undefined,
    x: clamp(Number(raw.x), -2.5, 2.5, d.x),
    y: clamp(Number(raw.y), -2.5, 2.5, d.y),
    s: clamp(Number(raw.s), 0.2, 3, d.s),
    rot: clamp(Number(raw.rot), -180, 180, d.rot),
    color: typeof raw.color === "string" && HEX.test(raw.color) ? raw.color : d.color,
  };
}

export const sanitizeOutfit = (raw: unknown): OutfitItem[] =>
  (Array.isArray(raw) ? raw : [])
    .map((r) => sanitizeItem(r as Partial<OutfitItem>))
    .filter((i): i is OutfitItem => i !== null)
    .slice(0, MAX_OUTFIT_ITEMS);

export const newItem = (kind: string, src?: string): OutfitItem | null => sanitizeItem({ kind, src, id: `${kind}_${Date.now().toString(36)}${Math.floor(Math.random() * 100)}` });

/**
 * Draw the outfit in the body's coordinate frame (origin = body centre, unit = body radius R in pixels).
 * Call it inside the body squish transform so accessories squish with Karsa.
 */
export function drawOutfit(ctx: CanvasRenderingContext2D, R: number, outfit: OutfitItem[], getImg: (src: string) => HTMLImageElement | null) {
  for (const it of outfit) {
    ctx.save();
    ctx.translate(it.x * R, it.y * R);
    ctx.rotate((it.rot * Math.PI) / 180);
    ctx.scale(it.s * R, it.s * R);
    if (it.kind === "custom" && it.src) {
      const img = getImg(it.src);
      if (img) ctx.drawImage(img, -0.75, -0.75, 1.5, 1.5);
    } else if (PRESETS[it.kind]) {
      PRESETS[it.kind].draw(ctx, it.color);
    }
    ctx.restore();
  }
}
