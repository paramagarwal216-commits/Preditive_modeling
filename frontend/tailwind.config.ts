import type { Config } from "tailwindcss";
import { tokens as t } from "./src/theme";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // Only the spec's tokens exist; nothing else can be used by accident.
    colors: {
      transparent: "transparent",
      current: "currentColor",
      white: "#FFFFFF",               // only used at low opacity for glass rims and hovers
      bg: t.bg,
      surface: t.surface,
      raised: t.raised,
      line: t.line,
      sky: t.sky,
      violet: t.violet,
      pink: t.pink,
      teal: t.teal,
      amber: t.amber,
      ink: { DEFAULT: t.ink, 2: t.ink2, 3: t.ink3 },
      accent: { DEFAULT: t.accent, soft: t.accentSoft },
      "neutral-bar": t.neutralBar,
      good: t.good,
      warn: t.warn,
      bad: t.bad,
      lr: t.lr,
      rf: t.rf,
      xgb: t.xgb,
      baseline: t.baseline,
    },
    fontFamily: {
      sans: ["Inter", "system-ui", "sans-serif"],
      mono: ["JetBrains Mono", "ui-monospace", "monospace"],
    },
    fontSize: {
      title: ["20px", { lineHeight: "28px", fontWeight: "600" }],
      card: ["14px", { lineHeight: "20px", fontWeight: "600" }],
      body: ["14px", { lineHeight: "20px", fontWeight: "400" }],
      cap: ["12px", { lineHeight: "16px", fontWeight: "400" }],
      kpi: ["28px", { lineHeight: "34px", fontWeight: "600" }],
    },
    borderRadius: { none: "0", sm: "4px", DEFAULT: "8px", full: "9999px" },
    boxShadow: { none: "none" },
    extend: {
      maxWidth: { content: "1280px", prose: "72ch" },
      width: { sidebar: "224px" },
    },
  },
  plugins: [],
} satisfies Config;
