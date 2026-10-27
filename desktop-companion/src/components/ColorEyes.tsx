import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useJellyMood } from "../lib/jelly";

interface ColorEyesProps {
  /** 1 = idle notch size (13x24 px eyes) */
  scale?: number;
  isSleeping?: boolean;
  follow?: boolean;
}

/**
 * ColorEyes: Karsa's face on the top notch. Two big glossy pill eyes, white at the core and tinted with a slowly
 * drifting rainbow glow. They follow the cursor, blink, and show the AI agent's mood (thinking, talking, happy,
 * worried, listening). Asleep, they close and nothing animates or listens (Zero-Heat).
 */
export const ColorEyes: React.FC<ColorEyesProps> = ({ scale = 1, isSleeping = false, follow = true }) => {
  const mood = useJellyMood();
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (isSleeping || !follow) return;
    const onMove = (e: MouseEvent) => {
      const dx = (e.clientX - window.innerWidth / 2) / (window.innerWidth / 2);
      const dy = (e.clientY - 20) / (window.innerHeight / 2);
      setGaze({ x: Math.max(-5, Math.min(5, dx * 6)) * scale, y: Math.max(-2, Math.min(3, dy * 3)) * scale });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [isSleeping, follow, scale]);

  useEffect(() => {
    if (isSleeping) return;
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      setBlink(true);
      setTimeout(() => {
        setBlink(false);
        t = setTimeout(loop, 3000 + Math.random() * 3200);
      }, 140);
    };
    t = setTimeout(loop, 3000);
    return () => clearTimeout(t);
  }, [isSleeping]);

  const W = 13 * scale;
  const H = 24 * scale;
  const gap = 17 * scale;
  const glow = `0 0 ${9 * scale}px rgba(170, 195, 255, 0.95), 0 0 ${22 * scale}px rgba(255, 140, 215, 0.5)`;
  const body = {
    width: W,
    height: H,
    borderRadius: 999,
    background: "linear-gradient(180deg, #ffffff 0%, #ffffff 42%, #cfe6ff 72%, #ffc8ec 100%)",
    boxShadow: glow,
  } as React.CSSProperties;

  const closed = isSleeping || mood === "happy";
  const arc = (
    <div
      style={{
        width: W * 1.25,
        height: W * 0.7,
        borderTop: `${Math.max(3, 4.2 * scale)}px solid #fff`,
        borderRadius: "999px 999px 0 0",
        filter: `drop-shadow(0 0 ${5 * scale}px rgba(170,195,255,.95))`,
        marginTop: H * 0.15,
        opacity: isSleeping ? 0.7 : 1,
      }}
    />
  );

  const eye = (side: -1 | 1) => {
    if (closed) return <div key={side}>{arc}</div>;
    let animate: Record<string, number | number[]> = { x: gaze.x, y: gaze.y, scaleY: blink ? 0.1 : hover ? 1.1 : 1, scaleX: 1, rotate: 0 };
    let transition: Record<string, unknown> = { type: "spring", stiffness: 420, damping: 24 };
    if (mood === "thinking") animate = { x: 3 * scale, y: -4 * scale, scaleY: blink ? 0.1 : 0.88, scaleX: 1, rotate: 0 };
    if (mood === "speaking") {
      animate = { x: gaze.x, y: gaze.y, scaleY: [1, 0.78, 1], scaleX: [1, 1.08, 1], rotate: 0 };
      transition = { duration: 0.5, repeat: Infinity };
    }
    if (mood === "worried") animate = { x: gaze.x, y: 2 * scale, scaleY: blink ? 0.1 : 1, scaleX: 1, rotate: side * -14 };
    if (mood === "listening") animate = { x: gaze.x, y: gaze.y, scaleY: 1.18, scaleX: 1.18, rotate: 0 };
    return <motion.div key={side} style={body} animate={animate} transition={transition} />;
  };

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="karsa-hue flex items-center justify-center select-none"
      style={{ gap, height: H * 1.3 }}
      aria-hidden="true"
    >
      {eye(-1)}
      {eye(1)}
    </div>
  );
};
