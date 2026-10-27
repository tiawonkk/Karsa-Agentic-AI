import React, { useEffect, useRef } from "react";
import { Mood, OutfitItem, drawOutfit, useJellyMood } from "../lib/jelly";

export interface MascotProps {
  size?: number; // base size in pixels (default 52)
  bodyColor?: string; // hex or hsl (default marshmallow white)
  eyeColor?: string; // default deep obsidian black
  isSleeping?: boolean;
  isDraggingOver?: boolean;
  /** Legacy single drawn accessory (kept so old callers compile); use `outfit` */
  accessoryImage?: string | null;
  /** Everything Karsa wears (presets and drawings), editable in the Wardrobe */
  outfit?: OutfitItem[];
  /** Force a mood; by default Karsa follows the shared mood set by the app (the AI agent's state) */
  mood?: Mood;
  /** The canvas and its wrapper let clicks through (the big stage supplies its own round hit area) */
  passThrough?: boolean;
  /** Scale the canvas with CSS only (the drawing resolution stays the same) */
  displayScale?: number;
  /** Change this number to make the jelly do a squish bounce from outside (a poke) */
  pokeKey?: number;
  showStarOrbit?: boolean;
  hoverTarget?: "settings" | "add" | "chat" | null;
  emoteContext?: "money" | "search" | "screen" | "code" | "success" | null;
  onMascotClick?: () => void;
  onDropFile?: (files: FileList) => void;
  isDark?: boolean;
}

interface NubState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
}

/**
 * Karsa: Karsa's glowing-orb mascot (canvas)
 * Karsa's own look:
 * 1. Pillowy marshmallow squircle with soft radial gradient, top rim light, and subtle bottom drop shadow.
 * 2. Expressive clean closed smiling arches (⌒   ⌒) or smooth bead eyes tracking mouse.
 * 3. Soft floating nubs (two pure white mini spheres bobbing gently beside the body).
 * 4. Faint cosmic dark halo ring with subtle luminous glow behind the mascot.
 * 5. Zero dirty red particles, zero harsh stripes, zero robotic clutter.
 */
export const MascotCanvas: React.FC<MascotProps> = ({
  size = 52,
  bodyColor = "#FAF9F6",
  eyeColor = "#18181B",
  isSleeping = false,
  isDraggingOver = false,
  accessoryImage = null,
  outfit,
  mood: moodProp,
  passThrough = false,
  displayScale = 1,
  pokeKey,
  showStarOrbit = true,
  hoverTarget = null,
  emoteContext = null,
  onMascotClick,
  onDropFile,
  isDark = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Mouse tracking
  const mousePos = useRef({ x: 0, y: 0 });

  // Spring physics for mochi squish/bounce
  const spring = useRef({
    scaleX: 1.0,
    scaleY: 1.0,
    targetScaleX: 1.0,
    targetScaleY: 1.0,
    vx: 0,
    vy: 0,
  });

  // Floating Nubs physics (left & right)
  const leftNub = useRef<NubState>({
    x: -size * 0.72,
    y: size * 0.1,
    vx: 0,
    vy: 0,
    targetX: -size * 0.72,
    targetY: size * 0.1,
  });

  const rightNub = useRef<NubState>({
    x: size * 0.72,
    y: size * 0.1,
    vx: 0,
    vy: 0,
    targetX: size * 0.72,
    targetY: size * 0.1,
  });

  const blinkState = useRef({ isBlinking: false, timer: 0, duration: 130 });
  const animFrameId = useRef<number | null>(null);
  const storeMood = useJellyMood();
  const moodRef = useRef<Mood>("idle");
  moodRef.current = moodProp ?? storeMood;
  const outfitRef = useRef<OutfitItem[]>([]);
  outfitRef.current = outfit ?? (accessoryImage ? [{ id: "legacy", kind: "custom", src: accessoryImage, x: 0, y: -0.95, s: 1.2, rot: 0, color: "#FFFFFF" }] : []);
  const imgCache = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const getImg = (src: string): HTMLImageElement | null => {
    const cached = imgCache.current.get(src);
    if (cached !== undefined) return cached;
    imgCache.current.set(src, null);
    const img = new Image();
    img.onload = () => imgCache.current.set(src, img);
    img.src = src;
    return null;
  };
  const clickBounceTime = useRef<number>(0);

  useEffect(() => {
    if (pokeKey) handleClick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pokeKey]);

  // Mouse move listener
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current || isSleeping) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      mousePos.current = {
        x: (e.clientX - centerX) / Math.max(window.innerWidth / 2, 250),
        y: (e.clientY - centerY) / Math.max(window.innerHeight / 2, 250),
      };
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isSleeping]);

  // Click handler: triggers marshmallow squish bounce
  const handleClick = () => {
    clickBounceTime.current = performance.now();
    spring.current.scaleX = 1.22;
    spring.current.scaleY = 0.82;
    spring.current.vx = 0;
    spring.current.vy = 0;
    onMascotClick?.();
  };

  // Main Animation Loop
  useEffect(() => {
    let lastTime = performance.now();
    let nextBlinkTime = lastTime + 2800 + Math.random() * 2500;

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.05);
      lastTime = time;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // 1. Spring Physics for Body Squish
      const kBody = 160;
      const dBody = 14;
      const fx = -kBody * (spring.current.scaleX - spring.current.targetScaleX) - dBody * spring.current.vx;
      const fy = -kBody * (spring.current.scaleY - spring.current.targetScaleY) - dBody * spring.current.vy;
      spring.current.vx += fx * dt;
      spring.current.vy += fy * dt;
      spring.current.scaleX += spring.current.vx * dt;
      spring.current.scaleY += spring.current.vy * dt;

      // 2. Blink Cycle
      if (time >= nextBlinkTime && !blinkState.current.isBlinking && !isSleeping) {
        blinkState.current.isBlinking = true;
        blinkState.current.timer = time;
      }
      if (blinkState.current.isBlinking && time - blinkState.current.timer >= blinkState.current.duration) {
        blinkState.current.isBlinking = false;
        nextBlinkTime = time + 3000 + Math.random() * 3000;
      }

      // 3. Compute Targets for Floating Nubs (Idle Bobbing)
      const r = size * 0.44;
      const baseNubX = r * 1.34;
      const baseNubY = r * 0.12;

      // Gentle floating idle bobbing
      const idleBobL = Math.sin(time * 0.0028) * 3.5;
      const idleBobR = Math.cos(time * 0.0031) * 3.5;

      const mx = mousePos.current.x;
      const my = mousePos.current.y;

      let targetLeftX = -baseNubX + mx * (r * 0.2);
      let targetLeftY = baseNubY + idleBobL + my * (r * 0.15);
      let targetRightX = baseNubX + mx * (r * 0.2);
      let targetRightY = baseNubY + idleBobR + my * (r * 0.15);

      const md = moodRef.current;
      if (emoteContext === "success" || md === "happy") {
        targetLeftY = -r * 0.7 + idleBobL;
        targetRightY = -r * 0.7 - idleBobR;
        if (md === "happy") spring.current.targetScaleY = 1 + 0.07 * Math.sin(time * 0.012);
      } else if (md === "thinking") {
        // one hand goes to the chin
        targetRightX = r * 0.42;
        targetRightY = r * 0.62;
        spring.current.targetScaleY = 1;
      } else if (md === "speaking") {
        spring.current.targetScaleY = 1 + 0.045 * Math.sin(time * 0.02);
        targetLeftY = baseNubY - Math.abs(Math.sin(time * 0.01)) * r * 0.3;
        targetRightY = baseNubY - Math.abs(Math.cos(time * 0.01)) * r * 0.3;
      } else if (md === "worried") {
        targetLeftX = -r * 0.5;
        targetRightX = r * 0.5;
        targetLeftY = targetRightY = r * 0.35;
        spring.current.targetScaleY = 1;
      } else {
        spring.current.targetScaleY = 1;
      }

      // 4. Update Nubs Spring Physics
      const kNub = 110;
      const dNub = 11;
      const flx = -kNub * (leftNub.current.x - targetLeftX) - dNub * leftNub.current.vx;
      const fly = -kNub * (leftNub.current.y - targetLeftY) - dNub * leftNub.current.vy;
      leftNub.current.vx += flx * dt;
      leftNub.current.vy += fly * dt;
      leftNub.current.x += leftNub.current.vx * dt;
      leftNub.current.y += leftNub.current.vy * dt;

      const frx = -kNub * (rightNub.current.x - targetRightX) - dNub * rightNub.current.vx;
      const fry = -kNub * (rightNub.current.y - targetRightY) - dNub * rightNub.current.vy;
      rightNub.current.vx += frx * dt;
      rightNub.current.vy += fry * dt;
      rightNub.current.x += rightNub.current.vx * dt;
      rightNub.current.y += rightNub.current.vy * dt;

      // 5. Render Scene
      drawJellyScene(
        ctx,
        size,
        bodyColor,
        eyeColor,
        spring.current.scaleX,
        spring.current.scaleY,
        mousePos.current,
        leftNub.current,
        rightNub.current,
        blinkState.current.isBlinking,
        isSleeping,
        isDraggingOver,
        outfitRef.current,
        getImg,
        moodRef.current,
        time,
        showStarOrbit,
        isDark
      );

      // Zero-Heat: a sleeping mascot is drawn once and the loop stops (0 FPS)
      if (!isSleeping) animFrameId.current = requestAnimationFrame(render);
    };

    animFrameId.current = requestAnimationFrame(render);
    return () => {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
    };
  }, [size, bodyColor, eyeColor, isSleeping, isDraggingOver, showStarOrbit, isDark]);

  const canvasW = showStarOrbit ? 280 : Math.max(120, Math.round(size * 2.4));
  const canvasH = showStarOrbit ? 110 : Math.max(76, Math.round(size * 1.6));

  return (
    <div
      className={`relative flex items-center justify-center select-none ${passThrough ? "pointer-events-none" : "cursor-pointer pointer-events-auto"}`}
      onClick={handleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) {
          onDropFile?.(e.dataTransfer.files);
        }
      }}
      title="Karsa — Klik untuk menyapa!"
    >
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        className="block drop-shadow-xs"
        style={{
          width: canvasW * displayScale,
          height: canvasH * displayScale,
        }}
      />
    </div>
  );
};

const hexToHsl = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [200, 85, 70];
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [200, 85, 70]; // greys/whites mean "use the rainbow jelly"
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, Math.round(s * 100), Math.round(l * 100)];
};

/**
 * Karsa: Karsa's mascot. A soft glowing orb of colour with two white pill eyes and nothing else: no ears, no cheeks, no
 * mouth. The glow drifts through the rainbow (or locks to the Wardrobe colour), breathes, and squishes when poked.
 * Moods live in the eyes: thinking looks up, talking pulses, happy closes into arcs, worried tilts, listening widens.
 * Light: a warm luminous glow fading to white. Dark: the same glow floating on the dark glass. Accessories sit on top.
 */
function drawJellyScene(
  ctx: CanvasRenderingContext2D,
  size: number,
  bodyColor: string,
  eyeColor: string,
  scaleX: number,
  scaleY: number,
  mouse: { x: number; y: number },
  _leftNub: NubState,
  _rightNub: NubState,
  isBlinking: boolean,
  isSleeping: boolean,
  isDraggingOver: boolean,
  outfit: OutfitItem[],
  getImg: (src: string) => HTMLImageElement | null,
  mood: Mood,
  time: number,
  showStarOrbit: boolean,
  isDark: boolean
) {
  void _leftNub;
  void _rightNub;
  void eyeColor; // the eyes are always white pills, as in the reference
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cx = w / 2;
  const cy = h / 2 + 2;
  const R = size * 0.52;

  const isDefault = bodyColor === "#FAF9F6" || !bodyColor;
  // the rainbow skips the sickly yellow-green band (hues 60-160): warm -> teal -> blue -> violet -> pink -> warm
  const rainbow = (t: number) => {
    const h = (t * 0.007) % 260;
    return h > 60 ? h + 100 : h;
  };
  const hue = isDefault ? rainbow(time) % 360 : hexToHsl(bodyColor)[0];
  const breathe = isSleeping ? 0.35 : 0.8 + 0.2 * Math.sin(time * 0.0025);
  const hsl = (dh: number, s: number, l: number, a: number) => `hsla(${(hue + dh) % 360}, ${s}%, ${l}%, ${a})`;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, cy);

  // 1. soft halo (never larger than the canvas, so it cannot show a square edge)
  const auraR = Math.min(R * 1.9, Math.min(w, h) / 2 - 1);
  const aura = ctx.createRadialGradient(0, R * 0.15, R * 0.3, 0, R * 0.15, auraR);
  aura.addColorStop(0, hsl(10, 95, isDark ? 62 : 70, (isDark ? 0.32 : 0.28) * breathe));
  aura.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(0, R * 0.15, auraR, 0, Math.PI * 2);
  ctx.fillStyle = aura;
  ctx.fill();

  if (showStarOrbit && !isSleeping) {
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI * 2) / 8 + time * 0.0003;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * R * 1.85, Math.sin(a) * R * 0.65, i % 3 === 0 ? 1.8 : 1.2, 0, Math.PI * 2);
      ctx.fillStyle = hsl(i * 40, 95, isDark ? 78 : 62, 0.35 + 0.5 * Math.abs(Math.sin(i * 3.1 + time * 0.002)));
      ctx.fill();
    }
  }

  ctx.save();
  ctx.scale(scaleX, scaleY);

  // 2. the orb: a soft squircle with a slowly wobbling edge, bright warm core fading outward
  const N = 80;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const wob = isSleeping ? 0 : 0.016 * Math.sin(3 * t + time * 0.0028) + 0.01 * Math.sin(5 * t - time * 0.0036);
    // squircle radius: superellipse so the shape is a rounded square, not a circle
    const c = Math.cos(t);
    const s = Math.sin(t);
    const k = 1 / Math.pow(Math.pow(Math.abs(c), 3.2) + Math.pow(Math.abs(s), 3.2), 1 / 3.2);
    pts.push([c * k * R * 0.98 * (1 + wob), s * k * R * 0.9 * (1 + wob)]);
  }
  const body = new Path2D();
  body.moveTo((pts[0][0] + pts[N - 1][0]) / 2, (pts[0][1] + pts[N - 1][1]) / 2);
  for (let i = 0; i < N; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % N];
    body.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
  }
  body.closePath();

  const fill = ctx.createRadialGradient(0, R * 0.5, R * 0.05, 0, R * 0.25, R * 1.25);
  fill.addColorStop(0, hsl(0, 100, 60, 0.98 * breathe + 0.02));
  fill.addColorStop(0.38, hsl(12, 96, 68, 0.95));
  fill.addColorStop(0.72, hsl(24, 92, isDark ? 62 : 78, isDark ? 0.78 : 0.95));
  fill.addColorStop(1, hsl(36, 88, isDark ? 42 : 86, isDark ? 0.5 : 0.92));
  ctx.shadowColor = hsl(10, 95, 60, isDark ? 0.55 : 0.4);
  ctx.shadowBlur = isDark ? 22 : 18;
  ctx.fillStyle = fill;
  ctx.filter = `blur(${Math.max(0.6, R * 0.028)}px)`; // a slightly fuzzy edge, like the reference glow
  ctx.fill(body);
  ctx.filter = "none";
  ctx.shadowColor = "transparent";

  // a faint top sheen, the only gloss
  ctx.save();
  ctx.clip(body);
  const sheen = ctx.createLinearGradient(0, -R, 0, -R * 0.1);
  sheen.addColorStop(0, `rgba(255, 255, 255, ${isDark ? 0.22 : 0.5})`);
  sheen.addColorStop(1, "transparent");
  ctx.fillStyle = sheen;
  ctx.fillRect(-R * 1.2, -R * 1.2, R * 2.4, R * 1.2);
  ctx.restore();

  // 3. eyes: two white pills, mood in their shape
  const eyeDist = R * 0.34;
  const eyeY = R * 0.04;
  const ew = R * 0.2;
  const eh = R * 0.4;
  const talk = mood === "speaking" ? 0.5 + 0.5 * Math.sin(time * 0.022) : 0;
  const closed = isSleeping || isBlinking || mood === "happy";
  const eye = (ex: number, side: number) => {
    ctx.save();
    ctx.translate(ex, eyeY);
    ctx.shadowColor = "rgba(255, 255, 255, 0.9)";
    ctx.shadowBlur = R * 0.16;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#ffffff";
    if (closed) {
      ctx.lineWidth = Math.max(3, R * 0.09);
      ctx.lineCap = "round";
      ctx.beginPath();
      if (isSleeping || isBlinking) {
        ctx.moveTo(-ew * 0.55, 0);
        ctx.lineTo(ew * 0.55, 0);
      } else {
        ctx.arc(0, ew * 0.45, ew * 0.62, 1.12 * Math.PI, 1.88 * Math.PI);
      }
      ctx.stroke();
    } else {
      let gx = Math.max(-1, Math.min(1, mouse.x)) * R * 0.1;
      let gy = Math.max(-1, Math.min(1, mouse.y)) * R * 0.07;
      let sx = 1;
      let sy = 1;
      let rot = 0;
      if (mood === "thinking") {
        gx = R * 0.1;
        gy = -R * 0.12;
        sy = 0.9;
      } else if (mood === "speaking") {
        sy = 1 - 0.22 * talk;
        sx = 1 + 0.08 * talk;
      } else if (mood === "worried") {
        rot = side * -0.26;
        gy = R * 0.05;
      } else if (mood === "listening") {
        sx = 1.15;
        sy = 1.18;
      }
      ctx.translate(gx, gy);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.roundRect(-ew / 2 * sx, -eh / 2 * sy, ew * sx, eh * sy, ew / 2);
      ctx.fill();
    }
    ctx.restore();
  };
  eye(-eyeDist, -1);
  eye(eyeDist, 1);

  if (isDraggingOver) {
    // dropping a file: the orb opens a small dark mouth to "eat" it
    ctx.beginPath();
    ctx.ellipse(0, R * 0.42, R * 0.13, R * 0.1, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(60, 20, 60, 0.75)";
    ctx.fill();
  }

  // 4. Outfit: drawn inside the squish transform so accessories squish with the orb
  drawOutfit(ctx, R, outfit, getImg);

  ctx.restore(); // end squish scale

  if (mood === "thinking") {
    for (let i = 0; i < 3; i++) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 0.006 - i * 0.9);
      ctx.beginPath();
      ctx.arc(R * (0.85 + i * 0.26), -R * (0.95 + i * 0.12), R * (0.06 + 0.04 * pulse), 0, Math.PI * 2);
      ctx.fillStyle = isDark ? "rgba(255, 255, 255, 0.85)" : "rgba(80, 70, 120, 0.7)";
      ctx.fill();
    }
  }

  ctx.restore(); // end canvas center translate
}
