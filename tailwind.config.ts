import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./web/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./web/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        vx: {
          bg: "#08090a",
          surface: "#0f1115",
          subtle: "#16191f",
          border: "#20252e",
          "border-light": "#2d3440",
          accent: "#f59e0b",
          "accent-hover": "#d97706",
          emerald: "#10b981",
          cyan: "#06b6d4",
          red: "#ef4444",
          dim: "#71798e",
          text: "#f1f3f7",
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
