import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#172033",
          soft: "#667085",
          faint: "#667085",
        },
        line: "#e3e8ef",
        surface: "#ffffff",
        canvas: "#f3f6fa",
        accent: {
          DEFAULT: "#1176d3",
          contrast: "#ffffff",
        },
        state: {
          pending: "#667085",
          approved: "#16a36a",
          changes: "#e5484d",
          progress: "#b76200",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        readable: "44rem",
      },
    },
  },
  plugins: [],
} satisfies Config;
