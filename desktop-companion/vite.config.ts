import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  clearScreen: false,
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
        xfwd: true, // the backend must see the phone's address, not this computer's, to apply the pairing token
        configure: (proxy) => {
          proxy.on("error", (err, _req, res) => {
            if ("code" in err && err.code === "ECONNREFUSED") {
              if (res && "writeHead" in res && !res.headersSent) {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ status: "backend_offline" }));
              }
            }
          });
        },
      },
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    rollupOptions: { input: { main: path.resolve(__dirname, "index.html"), mobile: path.resolve(__dirname, "m.html") } },
    target: "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
