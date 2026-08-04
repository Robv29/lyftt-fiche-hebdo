import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#131722",
          soft: "#5d6573",
          faint: "#697180",
        },
        line: "#e8eaee",
        surface: "#ffffff",
        canvas: "#f7f8fa",
        accent: {
          DEFAULT: "#111111",
          contrast: "#ffffff",
        },
        state: {
          pending: "#8a8a8a",
          approved: "#1c7c54",
          changes: "#b4451f",
          progress: "#9a6b00",
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
