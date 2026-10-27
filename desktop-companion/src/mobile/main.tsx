import React from "react";
import ReactDOM from "react-dom/client";
import { ThemeProvider } from "../context/ThemeContext.tsx";
import { MobileApp } from "./MobileApp.tsx";
import "../index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <MobileApp />
    </ThemeProvider>
  </React.StrictMode>
);
