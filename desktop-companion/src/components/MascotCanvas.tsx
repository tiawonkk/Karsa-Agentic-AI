import React, { useEffect, useRef } from "react";

export interface MascotProps {
  size?: number; // base size in pixels (default 52)
  bodyColor?: string; // hex or hsl
  eyeColor?: string;
  isSleeping?: boolean;
  isDraggingOver?: boolean;
  accessoryImage?: string | null; // Data URL or transparent PNG
  showStarOrbit?: boolean;
  hoverTarget?: "settings" | "add" | "chat" | null;
  emoteContext?: "money" | "search" | "screen" | "code" | "success" | null;
  onMascotClick?: () => void;
  onDropFile?: (files: FileList) => void;
  isDark?: boolean;
}

interface PawState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  targetX: number;
  targetY: number;
}

interface TapParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  rotation: number;
  type: "heart" | "sparkle";
}

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

  // Interaction & Physics state refs
  const mousePos = useRef({ x: 0, y: 0 });
  const spring = useRef({
    scaleX: 1.0,
    scaleY: 1.0,
    targetScaleX: 1.0,
    targetScaleY: 1.0,
    vx: 0,
    vy: 0,
  });

  // Dual Floating Paws Spring Physics
  const leftPaw = useRef<PawState>({
    x: -size * 0.72,
    y: size * 0.18,
    vx: 0,
    vy: 0,
    targetX: -size * 0.72,
    targetY: size * 0.18,
  });

  const rightPaw = useRef<PawState>({
    x: size * 0.72,
    y: size * 0.18,
    vx: 0,
    vy: 0,
    targetX: size * 0.72,
    targetY: size * 0.18,
  });

  // Tap-Tap & Giggle Reactions (NO ugly spirals!)
  const clickTimestamps = useRef<number[]>([]);
  const tapReactionUntil = useRef<{ time: number; type: "wink" | "giggle" }>({
    time: 0,
    type: "wink",
  });
  const tapParticles = useRef<TapParticle[]>([]);

  const blinkState = useRef({ isBlinking: false, timer: 0, duration: 120 });
  const animFrameId = useRef<number | null>(null);
  const accessoryImgElement = useRef<HTMLImageElement | null>(null);

  // Load accessory image if provided
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

  // Global Mouse tracking listener
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current || isSleeping) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      mousePos.current = {
        x: (e.clientX - centerX) / Math.max(window.innerWidth / 2, 200),
        y: (e.clientY - centerY) / Math.max(window.innerHeight / 2, 200),
      };
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isSleeping]);

  // Spawns cute floating hearts / golden sparkles on tap
  const spawnParticle = (type: "heart" | "sparkle") => {
    const r = size * 0.44;
    tapParticles.current.push({
      x: (Math.random() - 0.5) * (r * 1.4),
      y: -r * 0.75 - Math.random() * (r * 0.3),
      vx: (Math.random() - 0.5) * 0.8,
      vy: -1.2 - Math.random() * 0.8,
      size: type === "heart" ? 5 + Math.random() * 2 : 4 + Math.random() * 2,
      alpha: 1.0,
      rotation: (Math.random() - 0.5) * 0.5,
      type,
    });
  };

  // Click & Tap-Tap reaction handler (Jelly bounce & Happy Giggle)
  const handleClick = () => {
    if (isSleeping) return;

    const now = performance.now();

    // 1. Rubbery Mochi Squish deformation
    spring.current.scaleX = 1.28;
    spring.current.scaleY = 0.75;
    spring.current.vx = 0;
    spring.current.vy = 0;

    // 2. Track click cadence
    clickTimestamps.current.push(now);
    clickTimestamps.current = clickTimestamps.current.filter((t) => now - t <= 900);
    const tapCount = clickTimestamps.current.length;

    if (tapCount >= 3) {
      // Rapid tap-tap: Happy Giggle / Tickle Mode (> < eyes + blush + giggle mouth)
      tapReactionUntil.current = { time: now + 1200, type: "giggle" };
      spawnParticle("heart");
      spawnParticle("sparkle");
      spawnParticle("heart");
    } else {
      // Single tap: Playful cute wink (^ ‿ •)
      tapReactionUntil.current = { time: now + 650, type: "wink" };
      spawnParticle(Math.random() > 0.5 ? "heart" : "sparkle");
    }

    onMascotClick?.();
  };

  // Main Canvas Render Loop (Zero-Heat: 0 FPS when isSleeping)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Zero-Heat Sleep Mode: cancel loop, render 1 static frame with paws under cheek, and exit
    if (isSleeping) {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
      renderSleepFrame(ctx, size, bodyColor, eyeColor, isDark);
      return;
    }

    let lastTime = performance.now();
    let nextBlinkTime = performance.now() + 2500 + Math.random() * 3000;

    const render = (time: number) => {
      const dt = Math.min((time - lastTime) / 1000, 0.1);
      lastTime = time;

      // 1. Update squircle body spring physics (juicy bouncy mochi)
      const kBody = 160;
      const dBody = 11;
      const fx = -kBody * (spring.current.scaleX - spring.current.targetScaleX) - dBody * spring.current.vx;
      const fy = -kBody * (spring.current.scaleY - spring.current.targetScaleY) - dBody * spring.current.vy;
      spring.current.vx += fx * dt;
      spring.current.vy += fy * dt;
      spring.current.scaleX += spring.current.vx * dt;
      spring.current.scaleY += spring.current.vy * dt;

      // 2. Update Blink cycle
      if (time >= nextBlinkTime && !blinkState.current.isBlinking) {
        blinkState.current.isBlinking = true;
        blinkState.current.timer = time;
      }
      if (blinkState.current.isBlinking && time - blinkState.current.timer >= blinkState.current.duration) {
        blinkState.current.isBlinking = false;
        nextBlinkTime = time + 2500 + Math.random() * 3500;
      }

      // 3. Determine Tap Reaction status
      const isTapActive = time < tapReactionUntil.current.time;
      const tapType = isTapActive ? tapReactionUntil.current.type : null;

      // 4. Update Tap Particles
      for (let i = tapParticles.current.length - 1; i >= 0; i--) {
        const p = tapParticles.current[i];
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= dt * 1.5;
        p.rotation += dt * 1.5;
        if (p.alpha <= 0) {
          tapParticles.current.splice(i, 1);
        }
      }

      // 5. Compute Targets for Floating Paws
      const r = size * 0.44;
      const basePawX = r * 1.35;
      const basePawY = r * 0.28;

      let targetLeftX = -basePawX;
      let targetLeftY = basePawY;
      let targetRightX = basePawX;
      let targetRightY = basePawY;

      // Contextual & Tap behaviors for paws
      if (tapType === "giggle") {
        // Both paws raise up and flutter happily in giggle
        const giggleWave = Math.sin(time * 0.02) * 5;
        targetLeftX = -basePawX * 0.85;
        targetLeftY = -r * 0.35 + giggleWave;
        targetRightX = basePawX * 0.85;
        targetRightY = -r * 0.35 - giggleWave;
      } else if (tapType === "wink") {
        // Left paw gives a quick cute wave
        targetLeftX = -basePawX * 0.95;
        targetLeftY = -r * 0.2;
      } else if (hoverTarget === "settings") {
        // Point right paw towards top-right settings gear
        targetRightX = basePawX * 1.15;
        targetRightY = -r * 0.75;
        targetLeftX = -basePawX * 0.9;
        targetLeftY = basePawY * 0.9;
      } else if (hoverTarget === "add") {
        // Point left paw towards top-left add button
        targetLeftX = -basePawX * 1.15;
        targetLeftY = -r * 0.75;
      } else if (emoteContext === "success") {
        // Both hands raised high in joy 🙌
        const wave = Math.sin(time * 0.008) * 4;
        targetLeftX = -basePawX * 0.95;
        targetLeftY = -r * 0.95 + wave;
        targetRightX = basePawX * 0.95;
        targetRightY = -r * 0.95 - wave;
      } else if (emoteContext === "code") {
        // Typing paws up and down quickly
        const tapL = Math.sin(time * 0.015) * 6;
        const tapR = Math.cos(time * 0.015) * 6;
        targetLeftX = -basePawX * 0.75;
        targetLeftY = basePawY * 0.9 + tapL;
        targetRightX = basePawX * 0.75;
        targetRightY = basePawY * 0.9 + tapR;
      } else if (emoteContext === "money") {
        // Right hand holds coin slightly raised
        targetRightX = basePawX * 0.95;
        targetRightY = -r * 0.15;
        targetLeftX = -basePawX;
        targetLeftY = basePawY;
      } else if (emoteContext === "search" || emoteContext === "screen") {
        // Right hand holds magnifying glass examining
        targetRightX = basePawX * 0.85;
        targetRightY = -r * 0.35 + Math.sin(time * 0.003) * 3;
        targetLeftX = -basePawX;
        targetLeftY = basePawY;
      } else {
        // Tracking cursor with paws
        const mx = mousePos.current.x;
        const my = mousePos.current.y;

        if (mx > 0.25) {
          const wave = Math.sin(time * 0.008) * 6;
          targetRightX = basePawX + mx * (r * 0.4);
          targetRightY = basePawY + my * (r * 0.3) + wave;
          targetLeftX = -basePawX + mx * (r * 0.15);
        } else if (mx < -0.25) {
          const wave = Math.sin(time * 0.008) * 6;
          targetLeftX = -basePawX + mx * (r * 0.4);
          targetLeftY = basePawY + my * (r * 0.3) + wave;
          targetRightX = basePawX + mx * (r * 0.15);
        } else {
          const floatL = Math.sin(time * 0.002) * 3;
          const floatR = Math.cos(time * 0.0025) * 3;
          targetLeftY = basePawY + floatL;
          targetRightY = basePawY + floatR;
        }
      }

      // 6. Update Paw Spring Physics
      const kPaw = 95;
      const dPaw = 10;

      const flx = -kPaw * (leftPaw.current.x - targetLeftX) - dPaw * leftPaw.current.vx;
      const fly = -kPaw * (leftPaw.current.y - targetLeftY) - dPaw * leftPaw.current.vy;
      leftPaw.current.vx += flx * dt;
      leftPaw.current.vy += fly * dt;
      leftPaw.current.x += leftPaw.current.vx * dt;
      leftPaw.current.y += leftPaw.current.vy * dt;

      const frx = -kPaw * (rightPaw.current.x - targetRightX) - dPaw * rightPaw.current.vx;
      const fry = -kPaw * (rightPaw.current.y - targetRightY) - dPaw * rightPaw.current.vy;
      rightPaw.current.vx += frx * dt;
      rightPaw.current.vy += fry * dt;
      rightPaw.current.x += rightPaw.current.vx * dt;
      rightPaw.current.y += rightPaw.current.vy * dt;

      // 7. Draw Mascot Scene
      drawMascot(
        ctx,
        size,
        bodyColor,
        eyeColor,
        spring.current.scaleX,
        spring.current.scaleY,
        mousePos.current,
        leftPaw.current,
        rightPaw.current,
        blinkState.current.isBlinking,
        tapType,
        tapParticles.current,
        isDraggingOver,
        accessoryImgElement.current,
        hoverTarget,
        emoteContext,
        time,
        showStarOrbit,
        isDark
      );

      animFrameId.current = requestAnimationFrame(render);
    };

    animFrameId.current = requestAnimationFrame(render);

    return () => {
      if (animFrameId.current) {
        cancelAnimationFrame(animFrameId.current);
        animFrameId.current = null;
      }
    };
  }, [size, bodyColor, eyeColor, isSleeping, isDraggingOver, hoverTarget, emoteContext, isDark]);

  return (
    <div
      className="relative flex items-center justify-center cursor-pointer select-none"
      onClick={handleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        if (e.dataTransfer.files.length > 0) {
          onDropFile?.(e.dataTransfer.files);
        }
      }}
    >
      <canvas
        ref={canvasRef}
        width={320}
        height={108}
        style={{
          width: "320px",
          height: "108px",
        }}
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Canvas Drawing Routines (Squircle, Floating Paws, Star Orbit & 3D Eyes)
// ---------------------------------------------------------------------------

function drawMascot(
  ctx: CanvasRenderingContext2D,
  size: number,
  bodyColor: string,
  eyeColor: string,
  scaleX: number,
  scaleY: number,
  mouse: { x: number; y: number },
  lp: PawState,
  rp: PawState,
  isBlinking: boolean,
  tapReaction: "wink" | "giggle" | null,
  particles: TapParticle[],
  isSwallow: boolean,
  accessoryImg: HTMLImageElement | null,
  hoverTarget: string | null,
  emoteContext: string | null,
  time: number,
  showStarOrbit: boolean = true,
  isDark: boolean = true
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cx = w / 2;
  const cy = h / 2 + 2;
  const r = size * 0.44;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, cy);

  // 0. Celestial Orbit Particles
  if (showStarOrbit) {
    const numParticles = 38;
    const baseRx = r * 2.7;
    const baseRy = r * 0.85;
    const tilt = -0.05;

    ctx.save();
    ctx.rotate(tilt);
    for (let i = 0; i < numParticles; i++) {
      const pAngle = time * 0.0003 + (i * (Math.PI * 2)) / numParticles;
      const radOffset = Math.sin(i * 12.3 + time * 0.001) * (r * 0.3);
      const px = Math.cos(pAngle) * (baseRx + radOffset);
      const py = Math.sin(pAngle) * (baseRy + radOffset * 0.35);
      const pAlpha = 0.15 + 0.65 * Math.abs(Math.sin(i * 7.1 + time * 0.002));
      const pSize = i % 5 === 0 ? 1.6 : i % 3 === 0 ? 1.2 : 0.8;

      ctx.beginPath();
      ctx.arc(px, py, pSize, 0, Math.PI * 2);
      ctx.fillStyle = isDark
        ? `rgba(255, 255, 255, ${pAlpha})`
        : `rgba(217, 93, 57, ${pAlpha * 0.5})`;
      if (isDark) {
        ctx.shadowColor = "rgba(186, 230, 253, 0.7)";
        ctx.shadowBlur = 3;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  // Draw Floating Tap Particles (Hearts & Sparkles popping out!)
  for (const p of particles) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.globalAlpha = Math.max(0, p.alpha);

    if (p.type === "heart") {
      ctx.fillStyle = "#fb7185";
      ctx.beginPath();
      const s = p.size;
      ctx.moveTo(0, s * 0.35);
      ctx.bezierCurveTo(-s * 0.8, -s * 0.4, -s * 0.5, -s * 0.9, 0, -s * 0.45);
      ctx.bezierCurveTo(s * 0.5, -s * 0.9, s * 0.8, -s * 0.4, 0, s * 0.35);
      ctx.fill();
    } else {
      ctx.fillStyle = "#fbbf24";
      ctx.shadowColor = "rgba(251, 191, 36, 0.7)";
      ctx.shadowBlur = 4;
      ctx.beginPath();
      const s = p.size;
      ctx.moveTo(0, -s);
      ctx.quadraticCurveTo(0, 0, s, 0);
      ctx.quadraticCurveTo(0, 0, 0, s);
      ctx.quadraticCurveTo(0, 0, -s, 0);
      ctx.quadraticCurveTo(0, 0, 0, -s);
      ctx.fill();
    }
    ctx.restore();
  }

  // Draw Floating Paws
  const pawRadius = r * 0.32;
  const drawPaw = (
    px: number,
    py: number,
    isLeft: boolean,
    heldItem?: "coin" | "magnifier"
  ) => {
    ctx.save();
    ctx.translate(px, py);

    const rot = (isLeft ? -0.15 : 0.15) + (isLeft ? lp.vy : rp.vy) * 0.002;
    ctx.rotate(rot);

    // Paw Shadow
    ctx.beginPath();
    ctx.ellipse(0, pawRadius * 0.3, pawRadius * 0.9, pawRadius * 0.65, 0, 0, Math.PI * 2);
    ctx.fillStyle = isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)";
    ctx.fill();

    // Paw Body
    ctx.beginPath();
    ctx.roundRect(
      -pawRadius,
      -pawRadius * 0.85,
      pawRadius * 2,
      pawRadius * 1.7,
      pawRadius * 0.65
    );
    const pawGrad = ctx.createRadialGradient(
      -pawRadius * 0.2,
      -pawRadius * 0.2,
      pawRadius * 0.1,
      0,
      0,
      pawRadius * 1.3
    );
    pawGrad.addColorStop(0, "#ffffff");
    pawGrad.addColorStop(0.4, bodyColor);
    pawGrad.addColorStop(1, adjustColor(bodyColor, isDark ? -25 : -15));
    ctx.fillStyle = pawGrad;
    ctx.shadowColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.08)";
    ctx.shadowBlur = 6;
    ctx.fill();
    ctx.shadowColor = "transparent";

    // Cute Paw Pad Details
    ctx.beginPath();
    ctx.arc(0, pawRadius * 0.1, pawRadius * 0.32, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(251, 113, 133, 0.4)";
    ctx.fill();

    // Held Items
    if (heldItem === "coin") {
      ctx.save();
      ctx.translate(pawRadius * 0.5, -pawRadius * 0.5);
      ctx.beginPath();
      ctx.arc(0, 0, pawRadius * 0.55, 0, Math.PI * 2);
      const coinGrad = ctx.createLinearGradient(
        -pawRadius * 0.5,
        -pawRadius * 0.5,
        pawRadius * 0.5,
        pawRadius * 0.5
      );
      coinGrad.addColorStop(0, "#fde047");
      coinGrad.addColorStop(0.6, "#eab308");
      coinGrad.addColorStop(1, "#ca8a04");
      ctx.fillStyle = coinGrad;
      ctx.shadowColor = "rgba(234, 179, 8, 0.6)";
      ctx.shadowBlur = 6;
      ctx.fill();
      ctx.strokeStyle = "#a16207";
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.font = "bold 7px sans-serif";
      ctx.fillStyle = "#78350f";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Rp", 0, 0);
      ctx.restore();
    } else if (heldItem === "magnifier") {
      ctx.save();
      ctx.translate(pawRadius * 0.6, -pawRadius * 0.6);
      ctx.beginPath();
      ctx.moveTo(0, pawRadius * 0.3);
      ctx.lineTo(pawRadius * 0.5, pawRadius * 0.8);
      ctx.strokeStyle = "#71717a";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, pawRadius * 0.45, 0, Math.PI * 2);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(56, 189, 248, 0.25)";
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  };

  drawPaw(lp.x, lp.y, true);
  drawPaw(
    rp.x,
    rp.y,
    false,
    emoteContext === "money"
      ? "coin"
      : emoteContext === "search" || emoteContext === "screen"
      ? "magnifier"
      : undefined
  );

  // Apply spring scale to body (Mochi squish bounce)
  ctx.scale(scaleX, scaleY);

  // 1. Draw Body: The Soft Squircle with Ambient 3D Depth
  ctx.beginPath();
  const squircleRadius = r * 0.55;
  ctx.roundRect(-r, -r, r * 2, r * 2, squircleRadius);

  const bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.4);
  bodyGrad.addColorStop(0, "#ffffff");
  bodyGrad.addColorStop(0.32, bodyColor);
  bodyGrad.addColorStop(1, adjustColor(bodyColor, isDark ? -28 : -14));

  ctx.fillStyle = bodyGrad;
  ctx.shadowColor = isDark ? "rgba(255, 255, 255, 0.25)" : "rgba(0, 0, 0, 0.08)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = "transparent";

  // 2. Draw Eyes: 3D Spherical Eye Projection or Happy Closed Eyes
  const eyeDistance = r * 0.48;
  const eyeRadius = r * 0.28;
  const eyeY = -r * 0.08;

  let effectiveMouseX = mouse.x;
  let effectiveMouseY = mouse.y;

  if (hoverTarget === "settings") {
    effectiveMouseX = 0.85;
    effectiveMouseY = -0.7;
  } else if (hoverTarget === "add") {
    effectiveMouseX = -0.85;
    effectiveMouseY = -0.7;
  }

  const gazeX = Math.max(-1, Math.min(1, effectiveMouseX)) * (eyeRadius * 0.45);
  const gazeY = Math.max(-1, Math.min(1, effectiveMouseY)) * (eyeRadius * 0.45);
  const isHappyIdle =
    Math.hypot(effectiveMouseX, effectiveMouseY) < 0.12 &&
    !hoverTarget &&
    !emoteContext;

  const isGiggle = tapReaction === "giggle";
  const isWink = tapReaction === "wink";

  const drawOneEye = (ex: number) => {
    ctx.save();
    ctx.translate(ex, eyeY);

    if (isGiggle) {
      // Super cute squeezed anime happy eyes > < (giggle mode)
      ctx.beginPath();
      const spread = eyeRadius * 0.72;
      const point = eyeRadius * 0.65;
      if (ex < 0) {
        // Left eye: >
        ctx.moveTo(-spread, -point);
        ctx.lineTo(spread * 0.25, 0);
        ctx.lineTo(-spread, point);
      } else {
        // Right eye: <
        ctx.moveTo(spread, -point);
        ctx.lineTo(-spread * 0.25, 0);
        ctx.lineTo(spread, point);
      }
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    } else if (isWink && ex < 0) {
      // Left eye winks playfully: cute smiling curve ^
      ctx.beginPath();
      ctx.arc(0, eyeRadius * 0.35, eyeRadius * 0.75, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 2.6;
      ctx.lineCap = "round";
      ctx.stroke();
    } else if (isBlinking) {
      // Closed eye line
      ctx.beginPath();
      ctx.moveTo(-eyeRadius, 0);
      ctx.lineTo(eyeRadius, 0);
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.stroke();
    } else if (isHappyIdle || emoteContext === "success") {
      // Happy smiling curved eyes ^ ^
      ctx.beginPath();
      ctx.arc(0, eyeRadius * 0.4, eyeRadius * 0.75, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.strokeStyle = eyeColor;
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      ctx.stroke();
    } else {
      // Normal 3D Spherical Eye tracking mouse
      ctx.beginPath();
      ctx.arc(0, 0, eyeRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      // Pupil
      const pupilRadius = eyeRadius * 0.58;
      ctx.beginPath();
      ctx.arc(gazeX, gazeY, pupilRadius, 0, Math.PI * 2);
      ctx.fillStyle = eyeColor;
      ctx.fill();

      // Specular highlight reflection (extra sparkly on wink)
      ctx.beginPath();
      ctx.arc(
        gazeX - pupilRadius * 0.35,
        gazeY - pupilRadius * 0.35,
        isWink ? pupilRadius * 0.45 : pupilRadius * 0.3,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
    ctx.restore();
  };

  drawOneEye(-eyeDistance);
  drawOneEye(eyeDistance);

  // Cute Rosy Blush Cheeks (Glows brighter & wider on giggle!)
  const blushRadius = isGiggle ? 5.2 : isWink ? 4.2 : 3.6;
  const blushAlpha = isGiggle ? 0.75 : isWink ? 0.6 : 0.45;
  ctx.beginPath();
  ctx.arc(-eyeDistance - 2, eyeY + 11, blushRadius, 0, Math.PI * 2);
  ctx.arc(eyeDistance + 2, eyeY + 11, blushRadius, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(251, 113, 133, ${blushAlpha})`;
  ctx.fill();

  // Subtle cute diagonal anime blush stripes during giggle ///
  if (isGiggle) {
    const drawBlushStripes = (cx: number) => {
      ctx.save();
      ctx.strokeStyle = "rgba(244, 63, 94, 0.65)";
      ctx.lineWidth = 1.3;
      ctx.lineCap = "round";
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * 2.6 - 1.6, eyeY + 9);
        ctx.lineTo(cx + i * 2.6 + 1.6, eyeY + 13);
        ctx.stroke();
      }
      ctx.restore();
    };
    drawBlushStripes(-eyeDistance - 2);
    drawBlushStripes(eyeDistance + 2);
  }

  // 3. Mouth / Swallow Mode / Happy Giggle Mouth
  if (isSwallow) {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.42, r * 0.45, r * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#1e1b4b";
    ctx.fill();
    ctx.strokeStyle = "#4338ca";
    ctx.lineWidth = 2;
    ctx.stroke();

    const pulse = (Math.sin(time / 100) + 1) * 0.5;
    ctx.beginPath();
    ctx.arc(0, r * 0.42, r * 0.15 * pulse, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.fill();
  } else if (isGiggle) {
    // Joyful open giggle mouth with cute pink tongue! ▽
    ctx.beginPath();
    ctx.arc(0, r * 0.22, r * 0.22, 0, Math.PI);
    ctx.fillStyle = "#831843"; // deep berry cavity
    ctx.fill();

    // Cute pink tongue
    ctx.beginPath();
    ctx.arc(0, r * 0.36, r * 0.14, Math.PI, 0);
    ctx.fillStyle = "#fb7185";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, r * 0.22, r * 0.22, 0, Math.PI);
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = 2;
    ctx.stroke();
  } else if (isWink) {
    // Cute cat-like playful smile
    ctx.beginPath();
    ctx.arc(0, r * 0.26, r * 0.16, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.stroke();
  } else {
    // Happy gentle smile
    ctx.beginPath();
    ctx.arc(0, r * 0.28, r * 0.18, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  // 4. Render Drawn Accessory Layer
  if (accessoryImg) {
    const accSize = r * 2.2;
    ctx.drawImage(accessoryImg, -accSize / 2, -r * 1.55, accSize, accSize);
  }

  ctx.restore();
}

function renderSleepFrame(
  ctx: CanvasRenderingContext2D,
  size: number,
  bodyColor: string,
  eyeColor: string,
  isDark: boolean = true
) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const cx = w / 2;
  const cy = h / 2 + 2;
  const r = size * 0.44;

  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(cx, cy);

  // 1. Tucked Paws under cheek (sleeping pose)
  const pawRadius = r * 0.3;
  const drawSleepPaw = (px: number, py: number) => {
    ctx.save();
    ctx.translate(px, py);
    ctx.beginPath();
    ctx.roundRect(
      -pawRadius,
      -pawRadius * 0.7,
      pawRadius * 2,
      pawRadius * 1.4,
      pawRadius * 0.5
    );
    const pawGrad = ctx.createRadialGradient(
      -pawRadius * 0.2,
      -pawRadius * 0.2,
      pawRadius * 0.1,
      0,
      0,
      pawRadius * 1.2
    );
    pawGrad.addColorStop(0, "#ffffff");
    pawGrad.addColorStop(0.35, bodyColor);
    pawGrad.addColorStop(1, adjustColor(bodyColor, isDark ? -30 : -15));
    ctx.fillStyle = pawGrad;
    ctx.shadowColor = isDark ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.06)";
    ctx.shadowBlur = 4;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, pawRadius * 0.05, pawRadius * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(251, 113, 133, 0.35)";
    ctx.fill();
    ctx.restore();
  };

  drawSleepPaw(r * 0.45, r * 0.42);
  drawSleepPaw(r * 0.78, r * 0.35);

  // 2. Cozy relaxed squircle body
  ctx.save();
  ctx.rotate(0.04);
  ctx.beginPath();
  const squircleRadius = r * 0.55;
  ctx.roundRect(-r * 1.02, -r * 0.96, r * 2.04, r * 1.92, squircleRadius);

  const bodyGrad = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r * 1.4);
  bodyGrad.addColorStop(0, "#ffffff");
  bodyGrad.addColorStop(0.35, bodyColor);
  bodyGrad.addColorStop(1, adjustColor(bodyColor, isDark ? -35 : -15));

  ctx.fillStyle = bodyGrad;
  ctx.shadowColor = isDark ? "rgba(0, 0, 0, 0.25)" : "rgba(0, 0, 0, 0.06)";
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fill();
  ctx.shadowColor = "transparent";

  // 3. Sweet sleeping curved eyes
  const eyeDistance = r * 0.48;
  const eyeY = -r * 0.04;
  const drawSleepEye = (ex: number) => {
    ctx.beginPath();
    ctx.arc(ex, eyeY, r * 0.22, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.stroke();
  };
  drawSleepEye(-eyeDistance);
  drawSleepEye(eyeDistance);

  // Cute rosy blush cheeks
  ctx.beginPath();
  ctx.arc(-eyeDistance - 2, eyeY + 10, 3.8, 0, Math.PI * 2);
  ctx.arc(eyeDistance + 2, eyeY + 10, 3.8, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(251, 113, 133, 0.45)";
  ctx.fill();

  // Gentle peaceful sleeping smile
  ctx.beginPath();
  ctx.arc(0, r * 0.22, r * 0.12, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.strokeStyle = eyeColor;
  ctx.lineWidth = 1.8;
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();

  // 4. Stylized warm dreamy floating "z Z" bubbles
  ctx.save();
  ctx.font = "italic 600 10px 'Plus Jakarta Sans', sans-serif";
  ctx.fillStyle = isDark ? "rgba(250, 249, 246, 0.75)" : "rgba(24, 24, 27, 0.7)";
  ctx.fillText("z", r * 0.75, -r * 0.65);

  ctx.font = "italic 700 13px 'Plus Jakarta Sans', sans-serif";
  ctx.fillStyle = "rgba(217, 93, 57, 0.9)";
  ctx.shadowColor = "rgba(217, 93, 57, 0.4)";
  ctx.shadowBlur = 4;
  ctx.fillText("z", r * 0.98, -r * 1.0);
  ctx.restore();

  ctx.restore();
}

function adjustColor(color: string, amount: number): string {
  if (color.startsWith("#") && color.length === 7) {
    const num = parseInt(color.slice(1), 16);
    let r = (num >> 16) + amount;
    let g = ((num >> 8) & 0x00ff) + amount;
    let b = (num & 0x0000ff) + amount;
    r = Math.min(255, Math.max(0, r));
    g = Math.min(255, Math.max(0, g));
    b = Math.min(255, Math.max(0, b));
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
  }
  return color;
}
