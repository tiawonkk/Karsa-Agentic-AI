import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface IdleEyesViewProps {
  isDark?: boolean;
  isSleeping?: boolean;
}

/**
 * IdleEyesView: the idle face in the notch (Coucou / Nusa style): two glowing white vertical ovals on the black
 * island that follow the cursor and blink. Asleep, the eyes squash shut and no listeners/timers run (Zero-Heat).
 */
export const IdleEyesView: React.FC<IdleEyesViewProps> = ({ isSleeping = false }) => {
  const [gaze, setGaze] = useState({ x: 0, y: 0 });
  const [isBlinkingState, setIsBlinking] = useState(false);
  const isBlinking = isBlinkingState || isSleeping;
  const [isHovered, setIsHovered] = useState(false);

  // Mouse tracking for gaze shift
  useEffect(() => {
    if (isSleeping) return;
    const handleMouseMove = (e: MouseEvent) => {
      const centerX = window.innerWidth / 2;
      const centerY = 16;
      const dx = (e.clientX - centerX) / (window.innerWidth / 2);
      const dy = (e.clientY - centerY) / (window.innerHeight / 2);
      setGaze({
        x: Math.max(-4, Math.min(4, dx * 4.5)),
        y: Math.max(-1.5, Math.min(2, dy * 2.5)),
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [isSleeping]);

  // Periodic blink cycle
  useEffect(() => {
    if (isSleeping) return;
    let timeout: NodeJS.Timeout;
    const triggerBlink = () => {
      setIsBlinking(true);
      setTimeout(() => {
        setIsBlinking(false);
        const nextDelay = 3200 + Math.random() * 3000;
        timeout = setTimeout(triggerBlink, nextDelay);
      }, 140);
    };
    timeout = setTimeout(triggerBlink, 3800);
    return () => clearTimeout(timeout);
  }, [isSleeping]);

  const eye = (
    <motion.div
      animate={{
        scaleY: isBlinking ? 0.12 : isHovered ? 1.12 : 1,
        x: gaze.x,
        y: gaze.y,
      }}
      transition={{ type: "spring", stiffness: 450, damping: 25 }}
      className="w-[8px] h-[14px] rounded-full bg-ink"
    />
  );

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="w-full h-full flex items-center justify-center gap-[14px] cursor-pointer relative select-none pointer-events-auto"
      title="Karsa — Klik untuk membuka menu"
    >
      {eye}
      {eye}
    </div>
  );
};
