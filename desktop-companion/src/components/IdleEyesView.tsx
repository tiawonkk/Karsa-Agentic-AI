import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";

interface IdleEyesViewProps {
  isDark?: boolean;
}

/**
 * IdleEyesView: Two glowing white capsule AI eyes looking around smoothly,
 * with natural blinks and cute interactive reactions when hovered.
 */
export const IdleEyesView: React.FC<IdleEyesViewProps> = ({ isDark = true }) => {
  const [eyePos, setEyePos] = useState({ x: 0, y: 0 });
  const [isBlinking, setIsBlinking] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Mouse tracking for 3D pupil gaze
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const centerX = window.innerWidth / 2;
      const centerY = 20;
      const deltaX = (e.clientX - centerX) / (window.innerWidth / 2);
      const deltaY = (e.clientY - centerY) / (window.innerHeight / 2);
      setEyePos({
        x: Math.max(-3.5, Math.min(3.5, deltaX * 4)),
        y: Math.max(-2, Math.min(2.5, deltaY * 3)),
      });
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, []);

  // Periodic Blink Cycle (every 3 to 6 seconds)
  useEffect(() => {
    let timeout: NodeJS.Timeout;
    const triggerBlink = () => {
      setIsBlinking(true);
      setTimeout(() => {
        setIsBlinking(false);
        const nextDelay = 3000 + Math.random() * 3000;
        timeout = setTimeout(triggerBlink, nextDelay);
      }, 140);
    };
    timeout = setTimeout(triggerBlink, 3500);
    return () => clearTimeout(timeout);
  }, []);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="w-full h-full flex items-center justify-center gap-4 cursor-pointer relative"
      title="Klik untuk membuka Karsa Dynamic Island"
    >
      {/* Left Capsule Glowing Eye */}
      <motion.div
        animate={{
          scaleY: isBlinking ? 0.1 : isHovered ? 1.15 : 1,
          x: eyePos.x,
          y: eyePos.y,
        }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
        className="w-3.5 h-4.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)] flex items-center justify-center"
      />

      {/* Right Capsule Glowing Eye */}
      <motion.div
        animate={{
          scaleY: isBlinking ? 0.1 : isHovered ? 1.15 : 1,
          x: eyePos.x,
          y: eyePos.y,
        }}
        transition={{ type: "spring", stiffness: 500, damping: 28 }}
        className="w-3.5 h-4.5 rounded-full bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)] flex items-center justify-center"
      />

      {/* Cute little floating hands waving when hovered */}
      {isHovered && (
        <motion.div
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6 }}
          className="absolute -bottom-1 flex items-center justify-between w-14 pointer-events-none"
        >
          <div className="w-2 h-2 rounded-full bg-white/80 shadow-sm" />
          <div className="w-2 h-2 rounded-full bg-white/80 shadow-sm" />
        </motion.div>
      )}
    </div>
  );
};

export default IdleEyesView;
