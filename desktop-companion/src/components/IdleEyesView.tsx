import React from "react";
import { ColorEyes } from "./ColorEyes";

interface IdleEyesViewProps {
  isDark?: boolean;
  isSleeping?: boolean;
}

/** IdleEyesView: the idle face on the top notch: two big colourful glowing eyes (see ColorEyes). */
export const IdleEyesView: React.FC<IdleEyesViewProps> = ({ isSleeping = false }) => (
  <div
    className="w-full h-full flex items-center justify-center cursor-pointer relative select-none pointer-events-auto"
    title="Karsa — Klik untuk membuka menu"
  >
    <ColorEyes scale={1.2} isSleeping={isSleeping} />
  </div>
);
