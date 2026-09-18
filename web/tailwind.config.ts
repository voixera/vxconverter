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
          bg: "#09090b",
          "bg-elevated": "#121215",
          surface: "#18181b",
          subtle: "#27272a",
          border: "#27272a",
          "border-light": "#3f3f46",
          accent: "#ffffff",
          "accent-hover": "#e4e4e7",
          "accent-warm": "#f4f4f5",
          emerald: "#ffffff",
          cyan: "#ffffff",
          red: "#ef4444",
          dim: "#a1a1aa",
          muted: "#71717a",
          text: "#fafafa",
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
        "fade-in": "fadeIn 0.4s ease-out forwards",
      },
      keyframes: {
        scanline: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(1000%)" },
        },
        fadeIn: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
