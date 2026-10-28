// Design tokens (spec Section 5) and the ECharts theme built from them.
// tailwind.config.ts imports `tokens` so both read the same values.

// Dark, immersive navy theme (modelled on the reference BI dashboard).
export const tokens = {
  bg: "#120F2E",
  surface: "#221E4A",
  raised: "#2C275C",
  line: "#3D3670",
  ink: "#F4F2FF",
  ink2: "#C3BEE6",
  ink3: "#8F89BF",
  accent: "#A78BFA",
  accentSoft: "#3A2A6E",
  sky: "#38BDF8",
  violet: "#8B5CF6",
  pink: "#F472B6",
  teal: "#2DD4BF",
  amber: "#FBBF24",
  neutralBar: "#3A3466",
  good: "#4CCB7A",
  warn: "#F2B04A",
  bad: "#F2647A",
  lr: "#8A90FF",
  rf: "#A6D65E",
  xgb: "#FF9B57",
  baseline: "#9EA2C4",
} as const;

/** Category palette for donuts and multi-series charts. */
export const CATEGORY = [tokens.violet, tokens.pink, tokens.teal, tokens.amber, tokens.sky, tokens.rf, tokens.xgb, tokens.lr];

/** Two-stop gradients for bars and accents, so charts are not one flat colour. */
export const GRADIENTS: Record<string, [string, string]> = {
  violet: ["#C4B5FD", "#7C3AED"], pink: ["#F9A8D4", "#DB2777"], teal: ["#5EEAD4", "#0D9488"],
  amber: ["#FDE68A", "#D97706"], sky: ["#7DD3FC", "#2563EB"],
};

export const ALGO_COLOR: Record<string, string> = {
  logistic_regression: tokens.lr,
  random_forest: tokens.rf,
  xgboost: tokens.xgb,
  majority_baseline: tokens.baseline,
};

export const ALGO_NAME: Record<string, string> = {
  logistic_regression: "Logistic Regression",
  random_forest: "Random Forest",
  xgboost: "XGBoost",
  majority_baseline: "Baseline",
};

export const ALGO_SHORT: Record<string, string> = {
  logistic_regression: "LR",
  random_forest: "RF",
  xgboost: "XGB",
  majority_baseline: "Baseline",
};

// Gridlines use the line colour at 60% opacity.
const grid = "rgba(255, 255, 255, 0.08)";
/** Axis-pointer shadow behind hovered bars. */
export const HOVER_SHADE = "rgba(244, 114, 182, 0.08)";
const font = "Inter, system-ui, sans-serif";

export const echartsTheme = {
  color: [tokens.accent, tokens.neutralBar, tokens.lr, tokens.rf, tokens.xgb, tokens.baseline],
  backgroundColor: "transparent",
  textStyle: { fontFamily: font, color: tokens.ink2, fontSize: 12 },
  grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: tokens.line } },
    axisTick: { show: false },
    axisLabel: { color: tokens.ink2, fontSize: 12 },
    splitLine: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: tokens.ink2, fontSize: 12 },
    splitLine: { show: true, lineStyle: { color: grid } },
    nameTextStyle: { color: tokens.ink2, fontSize: 12 },
  },
  tooltip: {
    backgroundColor: "rgba(34, 30, 74, 0.82)",
    borderColor: "rgba(255, 255, 255, 0.16)",
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: tokens.ink, fontSize: 12, fontFamily: font },
    extraCssText: "backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-radius:12px;box-shadow:0 8px 24px rgba(6,4,26,.4);font-variant-numeric:tabular-nums;",
  },
  legend: { textStyle: { color: tokens.ink2, fontSize: 12 }, itemWidth: 12, itemHeight: 8 },
};

/** Sequential scale: deep violet (0) → pink (0.5) → amber (1). */
export function tealScale(t: number): string {
  const stops = [[0x3a, 0x2a, 0x6e], [0xf4, 0x72, 0xb6], [0xfb, 0xbf, 0x24]];
  const x = Math.min(1, Math.max(0, t)) * 2;
  const [a, b] = x <= 1 ? [stops[0], stops[1]] : [stops[1], stops[2]];
  const k = x <= 1 ? x : x - 1;
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * k));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
