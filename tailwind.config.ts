import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: "#111111",
          soft: "#4a4a4a",
          faint: "#8a8a8a",
        },
        line: "#e4e4e4",
        surface: "#ffffff",
        canvas: "#fafaf9",
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
