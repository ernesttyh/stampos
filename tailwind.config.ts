import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: "rgb(var(--brand-rgb) / <alpha-value>)",
        "brand-dark": "rgb(var(--brand-dark-rgb) / <alpha-value>)",
        cream: "#FFF8F0",
        ink: "#1F1A17",
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        drop: {
          "0%": { transform: "translateY(-40px) scale(1.4)", opacity: "0" },
          "60%": { transform: "translateY(4px) scale(0.95)", opacity: "1" },
          "80%": { transform: "translateY(-2px) scale(1.05)" },
          "100%": { transform: "translateY(0) scale(1)", opacity: "1" },
        },
        pop: {
          "0%": { transform: "scale(0.6)", opacity: "0" },
          "70%": { transform: "scale(1.08)", opacity: "1" },
          "100%": { transform: "scale(1)" },
        },
        confetti: {
          "0%": { transform: "translateY(0) rotate(0deg)", opacity: "1" },
          "100%": { transform: "translateY(260px) rotate(540deg)", opacity: "0" },
        },
        shake: {
          "0%, 100%": { transform: "translateX(0)" },
          "25%": { transform: "translateX(-4px)" },
          "75%": { transform: "translateX(4px)" },
        },
        spin3: {
          "0%": { transform: "rotate(0deg)" },
          "100%": { transform: "rotate(var(--spin-to, 1440deg))" },
        },
        pulseSoft: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.04)" },
        },
      },
      animation: {
        drop: "drop 0.55s cubic-bezier(.2,.9,.3,1.2) both",
        pop: "pop 0.4s ease-out both",
        confetti: "confetti 1.6s ease-in forwards",
        shake: "shake 0.3s ease-in-out",
        spin3: "spin3 3.2s cubic-bezier(.15,.75,.2,1) forwards",
        pulseSoft: "pulseSoft 1.6s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
