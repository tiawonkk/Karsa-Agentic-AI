import React from "react";
import { NotchIsland } from "./components/NotchIsland.tsx";
import { ThemeProvider } from "./context/ThemeContext.tsx";
import { WidgetsProvider } from "./context/WidgetsContext.tsx";
import { ShortcutsSheet } from "./components/ShortcutsSheet.tsx";
import { useTauriBridge } from "./lib/tauriBridge.ts";

export const App: React.FC = () => {
  useTauriBridge(); // click-through regions + global hotkeys + tray events when running inside the desktop shell
  return (
    <ThemeProvider>
      <WidgetsProvider>
        {/* Click-through root: only the notch, the right dock and active widgets re-enable pointer events */}
        <div className="fixed inset-0 pointer-events-none w-screen h-screen bg-transparent overflow-hidden select-none font-sans">
          <NotchIsland />
          <ShortcutsSheet />
        </div>
      </WidgetsProvider>
    </ThemeProvider>
  );
};

export default App;
