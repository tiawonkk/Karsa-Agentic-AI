import React, { useEffect, useState } from "react";
import { ColorEyes } from "./ColorEyes";
import { Waveform } from "./IslandDeck";

const clock = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

interface IdleEyesViewProps {
  isDark?: boolean;
  isSleeping?: boolean;
}

/** IdleEyesView: the idle face on the top notch: two big colourful glowing eyes (see ColorEyes). */
export const IdleEyesView: React.FC<IdleEyesViewProps> = ({ isSleeping = false }) => {
  const [time, setTime] = useState(clock);
  useEffect(() => {
    const t = setInterval(() => setTime(clock()), 15000);
    return () => clearInterval(t);
  }, []);
  return (
  <div
    className="w-full h-full flex items-center justify-center cursor-pointer relative select-none pointer-events-auto"
    title="Karsa — Klik untuk membuka menu"
  >
    <div className="flex items-center gap-2">
      <ColorEyes scale={0.5} follow={false} isSleeping={isSleeping} />
      <span className="font-mono font-bold text-[12px] leading-none tracking-tight text-ink">{time}</span>
      <Waveform active={!isSleeping} />
    </div>
  </div>
  );
};
