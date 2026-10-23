import React from "react";
import { NotchIsland } from "./components/NotchIsland.tsx";

export const App: React.FC = () => {
  return (
    <main className="w-screen h-screen bg-transparent overflow-hidden relative font-sans">
      {/* Subtle Film Grain (2.5% Opacity) (Section 2.2) */}
      <div className="fixed inset-0 pointer-events-none z-[999] grain-overlay" />
      <NotchIsland />
    </main>
  );
};

export default App;
