import React, { useEffect, useRef } from "react";

export interface MascotProps {
  size?: number; // base size in pixels (default 52)
  bodyColor?: string; // hex or hsl (default marshmallow white)
  eyeColor?: string; // default deep obsidian black
  isSleeping?: boolean;
  isDraggingOver?: boolean;
  accessoryImage?: string | null;
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
 * Minimalist Coucou Mochi Mascot Canvas
 * Refactored to match Coucou on Windows aesthetic:
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
  const accessoryImgElement = useRef<HTMLImageElement | null>(null);
  const clickBounceTime = useRef<number>(0);

  // Load accessory image
  useEffect(() => {
    if (!accessoryImage) {
      accessoryImgElement.current = null;
      return;
    }
    const img = new Image();
    img.src = accessoryImage;
    img.onload = () => {
      accessoryImgElement.current = img;
    };
  }, [accessoryImage]);

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

      if (emoteContext === "success") {
        targetLeftY = -r * 0.7 + idleBobL;
        targetRightY = -r * 0.7 - idleBobR;
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
      drawCoucouScene(
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
        accessoryImgElement.current,
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
      className="relative flex items-center justify-center cursor-pointer select-none pointer-events-auto"
      onClick={handleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) {
          onDropFile?.(e.dataTransfer.files);
        }
      }}
      title="Coucou Karsa — Klik untuk menyapa!"
    >
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        className="block drop-shadow-xs"
        style={{
          width: canvasW,
          height: canvasH,
        }}
      />
    </div>
  );
};

/**
 * Render Coucou Mochi Mascot (Reference: Coucou on Windows Screenshot 1)
 */
function drawCoucouScene(
  ctx: CanvasRenderingContext2D,
  size: number,
  bodyColor: string,
  eyeColor: string,
  scaleX: number,
  scaleY: number,
  mouse: { x: number; y: number },
  leftNub: NubState,
  rightNub: NubState,
  isBlinking: boolean,
  isSleeping: boolean,
  isDraggingOver: boolean,
  accessoryImg: HTMLImageElement | null,
  time: number,
  showStarOrbit: boolean,
  isDark: boolean
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cx = w / 2;
  const cy = h / 2 + 1;
  const r = size * 0.46;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, cy);

  // 1. Cosmic Dark Luminous Halo Ring behind Coucou (Reference: Coucou dark space glow)
  ctx.save();
  if (showStarOrbit) {
    // Outer soft dark cosmic aura
    const haloGrad = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 2.3);
    if (isDark) {
      haloGrad.addColorStop(0, "rgba(255, 255, 255, 0.12)");
      haloGrad.addColorStop(0.45, "rgba(147, 197, 253, 0.08)");
      haloGrad.addColorStop(0.75, "rgba(59, 130, 246, 0.03)");
      haloGrad.addColorStop(1, "transparent");
    } else {
      haloGrad.addColorStop(0, "rgba(255, 255, 255, 0.8)");
      haloGrad.addColorStop(0.5, "rgba(224, 231, 255, 0.4)");
      haloGrad.addColorStop(1, "transparent");
    }
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.3, 0, Math.PI * 2);
    ctx.fillStyle = haloGrad;
    ctx.fill();

    // Subtle fine starlight ring (sparse, clean, no dirty red dust)
    const numStars = 28;
    const rx = r * 2.1;
    const ry = r * 0.75;
    for (let i = 0; i < numStars; i++) {
      const angle = (i * Math.PI * 2) / numStars + time * 0.0002;
      const offset = Math.sin(i * 9.2 + time * 0.001) * (r * 0.15);
      const px = Math.cos(angle) * (rx + offset);
      const py = Math.sin(angle) * (ry + offset * 0.4);
      const alpha = 0.12 + 0.45 * Math.abs(Math.sin(i * 5.3 + time * 0.0015));

      ctx.beginPath();
      ctx.arc(px, py, i % 4 === 0 ? 1.2 : 0.8, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? `rgba(255, 255, 255, ${alpha})` : `rgba(100, 116, 139, ${alpha * 0.5})`;
      ctx.fill();
    }
  } else {
    // Minimal soft aura
    const aura = ctx.createRadialGradient(0, 0, r * 0.3, 0, 0, r * 1.45);
    aura.addColorStop(0, isDark ? "rgba(255, 255, 255, 0.14)" : "rgba(255, 255, 255, 0.7)");
    aura.addColorStop(1, "transparent");
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.45, 0, Math.PI * 2);
    ctx.fillStyle = aura;
    ctx.fill();
  }
  ctx.restore();

  // 2. Draw Floating Nubs (Two pure white mini spheres on sides)
  const nubRadius = r * 0.28;
  const drawNub = (nx: number, ny: number) => {
    ctx.save();
    ctx.translate(nx, ny);

    // Soft nub shadow
    ctx.beginPath();
    ctx.ellipse(0, nubRadius * 0.4, nubRadius * 0.85, nubRadius * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.06)";
    ctx.fill();

    // Nub sphere
    ctx.beginPath();
    ctx.arc(0, 0, nubRadius, 0, Math.PI * 2);
    const nubGrad = ctx.createRadialGradient(
      -nubRadius * 0.25,
      -nubRadius * 0.3,
      nubRadius * 0.1,
      0,
      0,
      nubRadius * 1.15
    );
    nubGrad.addColorStop(0, "#ffffff");
    nubGrad.addColorStop(0.65, "#f4f4f5");
    nubGrad.addColorStop(1, "#d4d4d8");
    ctx.fillStyle = nubGrad;
    ctx.shadowColor = isDark ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.08)";
    ctx.shadowBlur = 4;
    ctx.fill();
    ctx.shadowColor = "transparent";

    // Tiny specular reflection
    ctx.beginPath();
    ctx.arc(-nubRadius * 0.3, -nubRadius * 0.32, nubRadius * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
    ctx.fill();

    ctx.restore();
  };

  drawNub(leftNub.x, leftNub.y);
  drawNub(rightNub.x, rightNub.y);

  // 3. Draw Coucou Body (Marshmallow Pillowy Squircle)
  ctx.save();
  ctx.scale(scaleX, scaleY);

  // Soft bottom shadow under body
  ctx.beginPath();
  ctx.ellipse(0, r * 0.88, r * 0.95, r * 0.28, 0, 0, Math.PI * 2);
  ctx.fillStyle = isDark ? "rgba(0, 0, 0, 0.35)" : "rgba(0, 0, 0, 0.08)";
  ctx.fill();

  // Pillowy Squircle Body
  const bodyW = r * 1.95;
  const bodyH = r * 1.65;
  const cornerR = r * 0.65;

  ctx.beginPath();
  ctx.roundRect(-bodyW / 2, -bodyH / 2, bodyW, bodyH, cornerR);

  // Radial marshmallow shading: pure white core radiating to soft warm zinc
  const bodyGrad = ctx.createRadialGradient(0, -bodyH * 0.2, r * 0.2, 0, bodyH * 0.1, r * 1.35);
  bodyGrad.addColorStop(0, "#ffffff");
  bodyGrad.addColorStop(0.55, bodyColor === "#FAF9F6" ? "#fbfbfa" : bodyColor);
  bodyGrad.addColorStop(0.9, "#e4e4e7");
  bodyGrad.addColorStop(1, "#d4d4d8");

  ctx.fillStyle = bodyGrad;
  ctx.shadowColor = isDark ? "rgba(0, 0, 0, 0.55)" : "rgba(0, 0, 0, 0.12)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fill();
  ctx.shadowColor = "transparent";

  // Top Rim Light (Soft highlight along top curve)
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(-bodyW / 2 + 2, -bodyH / 2 + 1, bodyW - 4, bodyH * 0.5, cornerR * 0.9);
  const rimGrad = ctx.createLinearGradient(0, -bodyH / 2, 0, 0);
  rimGrad.addColorStop(0, "rgba(255, 255, 255, 0.85)");
  rimGrad.addColorStop(0.7, "rgba(255, 255, 255, 0.15)");
  rimGrad.addColorStop(1, "transparent");
  ctx.fillStyle = rimGrad;
  ctx.fill();
  ctx.restore();

  // 4. Eyes & Facial Expression
  const eyeDistance = r * 0.46;
  const eyeY = -r * 0.05;
  const eyeRadius = r * 0.26;

  // Determine if looking around or showing joyful closed smile
  const isTracking = Math.hypot(mouse.x, mouse.y) > 0.18 && !isSleeping && !isBlinking;

  const drawCoucouEye = (ex: number) => {
    ctx.save();
    ctx.translate(ex, eyeY);

    if (isSleeping || isBlinking || !isTracking) {
      // Default: Pure joyful thick curved arches ⌒  ⌒ (Reference: Coucou Screenshot 1)
      ctx.beginPath();
      // Draw bold clean upward arc: ⌒
      ctx.arc(0, eyeRadius * 0.35, eyeRadius * 0.8, 1.15 * Math.PI, 1.85 * Math.PI, false);
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 3.6;
      ctx.lineCap = "round";
      ctx.stroke();
    } else {
      // Smooth black oval beads looking in cursor direction
      const gazeX = Math.max(-1, Math.min(1, mouse.x)) * (eyeRadius * 0.4);
      const gazeY = Math.max(-1, Math.min(1, mouse.y)) * (eyeRadius * 0.35);

      ctx.beginPath();
      ctx.ellipse(gazeX, gazeY, eyeRadius * 0.52, eyeRadius * 0.65, 0, 0, Math.PI * 2);
      ctx.fillStyle = eyeColor;
      ctx.fill();

      // Clean white specular reflection
      ctx.beginPath();
      ctx.arc(gazeX - eyeRadius * 0.18, gazeY - eyeRadius * 0.22, eyeRadius * 0.18, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }

    ctx.restore();
  };

  drawCoucouEye(-eyeDistance);
  drawCoucouEye(eyeDistance);

  // 5. Subtle Transparent Pink Blush (Opacity 15%, No dirty stripes or harsh dots)
  const blushRadius = r * 0.18;
  const blushY = eyeY + eyeRadius * 0.75;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(-eyeDistance - r * 0.15, blushY, blushRadius * 1.15, blushRadius * 0.7, 0, 0, Math.PI * 2);
  ctx.ellipse(eyeDistance + r * 0.15, blushY, blushRadius * 1.15, blushRadius * 0.7, 0, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(251, 113, 133, 0.15)";
  ctx.fill();
  ctx.restore();

  // 6. Dragging Over Swallow Indicator (Optional drag-and-drop feedback)
  if (isDraggingOver) {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.32, r * 0.35, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#18181b";
    ctx.fill();
  }

  // 7. Wardrobe Accessory Image (if worn)
  if (accessoryImg) {
    ctx.save();
    const accSize = r * 1.6;
    ctx.drawImage(accessoryImg, -accSize / 2, -r * 1.15, accSize, accSize);
    ctx.restore();
  }

  ctx.restore(); // end body squish scale
  ctx.restore(); // end canvas center translate
}
