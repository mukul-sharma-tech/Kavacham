import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        space: {
          bg: "#050a14",
          panel: "#0a1628",
          border: "#1a3a5c",
          accent: "#00d4ff",
          warn: "#ffaa00",
          danger: "#ff3333",
          safe: "#00ff88",
        },
      },
    },
  },
  plugins: [],
};
export default config;
