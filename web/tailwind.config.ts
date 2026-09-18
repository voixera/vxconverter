import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./web/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./web/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        vx: {
          bg: "#060d0c",
          "bg-elevated": "#0a1715",
          surface: "#0e1e1c",
          subtle: "#142b28",
          border: "#1d3b36",
          "border-light": "#2a524b",
          accent: "#a7f3d0",
          "accent-hover": "#6ee7b7",
          "accent-warm": "#f4f3ed",
          emerald: "#34d399",
          cyan: "#2dd4bf",
          red: "#f87171",
          dim: "#7f9690",
          muted: "#4d635e",
          text: "#f4f3ed",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "SF Pro Display",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "monospace",
        ],
      },
      animation: {
        "scan-line": "scanline 2s linear infinite",
        "pulse-fast": "pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-in": "fadeIn 0.5s ease-out forwards",
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(1000%)" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
