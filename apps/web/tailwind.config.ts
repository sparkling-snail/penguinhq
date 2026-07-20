import type { Config } from "tailwindcss";

/**
 * Design tokens for the "cozy pixel-art operating system" aesthetic:
 * a dark base with glassmorphism panels layered on top, plus a small
 * palette of accent colors used for agent avatars and status pills.
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        penguin: {
          bg: "#0b1120",
          panel: "rgba(17, 24, 39, 0.65)",
          border: "rgba(148, 163, 184, 0.15)",
          ice: "#7dd3fc",
          accent: "#38bdf8",
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', "monospace"],
        ui: ["Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glass: "0 8px 32px 0 rgba(0, 0, 0, 0.37)",
      },
      backdropBlur: {
        glass: "16px",
      },
      keyframes: {
        "bob": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-4px)" },
        },
      },
      animation: {
        bob: "bob 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
