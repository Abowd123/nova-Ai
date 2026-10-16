import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const color = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      colors: {
        border: color("border"),
        outline: color("outline"),
        input: color("input"),
        ring: color("ring"),
        background: color("background"),
        foreground: color("foreground"),
        surface: {
          DEFAULT: color("background"),
          "container-low": color("surface-container-low"),
          container: color("surface-container"),
          "container-high": color("surface-container-high"),
        },
        primary: { DEFAULT: color("primary"), foreground: color("primary-foreground") },
        secondary: { DEFAULT: color("secondary"), foreground: color("secondary-foreground") },
        muted: { DEFAULT: color("muted"), foreground: color("muted-foreground") },
        accent: { DEFAULT: color("accent"), foreground: color("accent-foreground") },
        destructive: { DEFAULT: color("destructive"), foreground: color("destructive-foreground") },
        success: { DEFAULT: color("success"), foreground: color("success-foreground") },
        warning: { DEFAULT: color("warning"), foreground: color("warning-foreground") },
        card: { DEFAULT: color("card"), foreground: color("card-foreground") },
        popover: { DEFAULT: color("card"), foreground: color("card-foreground") },
      },
      borderRadius: {
        "3xl": "calc(var(--radius) * 1.75)",
        "2xl": "calc(var(--radius) * 1.25)",
        xl: "var(--radius)",
        lg: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 6px)",
        sm: "calc(var(--radius) - 8px)",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Noto Sans Arabic",
          "Noto Sans",
          "Tahoma",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        elevation1: "0 1px 2px 0 rgb(0 0 0 / 0.12), 0 1px 3px 1px rgb(0 0 0 / 0.08)",
        elevation2: "0 1px 2px 0 rgb(0 0 0 / 0.12), 0 2px 6px 2px rgb(0 0 0 / 0.08)",
      },
    },
  },
  plugins: [animate],
};

export default config;
