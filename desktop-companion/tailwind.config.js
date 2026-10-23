/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ["'Instrument Serif'", "Georgia", "serif"],
        sans: ["'Plus Jakarta Sans'", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      colors: {
        karsa: {
          paper: "#FAF9F6",
          "paper-muted": "#F2EFE9",
          obsidian: "#121212",
          "obsidian-muted": "#1A1917",
          charcoal: "#171615",
          terracotta: "#D95D39",
          "terracotta-dark": "#B84827",
          "terracotta-light": "#F5EAE6",
          sage: "#3B7A57",
          "sage-muted": "#2E5F44",
        },
        island: {
          bg: "#121212",
          border: "rgba(255, 255, 255, 0.08)",
          accent: "#D95D39",
        },
      },
      boxShadow: {
        "tactile-rest": "var(--shadow-tactile-rest)",
        "tactile-lifted": "var(--shadow-tactile-lifted)",
        "tactile-notch": "var(--shadow-tactile-notch)",
      },
      animation: {
        "pulse-glow": "pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        pulseGlow: {
          "0%, 100%": { opacity: 0.8, transform: "scale(1)" },
          "50%": { opacity: 1, transform: "scale(1.02)" },
        },
      },
    },
  },
  plugins: [],
};
