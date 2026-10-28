import * as echarts from "echarts";
import ReactECharts from "echarts-for-react";
import type { ReactNode } from "react";
import type { GroupRate } from "../api";
import { echartsTheme, GRADIENTS, HOVER_SHADE, tokens } from "../theme";
import { useTableView } from "./Card";

echarts.registerTheme("paper", echartsTheme);

/** Horizontal two-stop gradient fill (light → deep) for bars. */
export const gradient = (name: keyof typeof GRADIENTS | string, vertical = false) => {
  const [a, b] = GRADIENTS[name] ?? GRADIENTS.violet;
  return new echarts.graphic.LinearGradient(0, vertical ? 1 : 0, vertical ? 0 : 1, 0, [{ offset: 0, color: b }, { offset: 1, color: a }]);
};

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export type TableData = { columns: string[]; rows: ReactNode[][] };

export function DataTable({ columns, rows, maxHeight = 320 }: TableData & { maxHeight?: number }) {
  return (
    <div className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse text-cap">
        <thead className="sticky top-0 bg-raised/90 backdrop-blur">
          <tr>{columns.map((c) => <th key={c} className="border-b border-line px-2 py-1.5 text-left font-semibold text-ink-2">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-line last:border-0">
              {r.map((c, j) => <td key={j} className="px-2 py-1.5 text-ink">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The one chart wrapper: ECharts with the paper theme, plus the card's Table view. */
export function Chart({ option, table, height = 260, onClick, notMerge }: {
  option: echarts.EChartsOption; table: TableData; height?: number;
  onClick?: (p: { name: string; dataIndex: number; seriesName?: string; componentType?: string; value?: unknown }) => void;
  notMerge?: boolean;
}) {
  const showTable = useTableView();
  if (showTable) return <DataTable {...table} maxHeight={height} />;
  const reduced = reducedMotion();
  return (
    <ReactECharts
      theme="paper"
      notMerge={notMerge}
      option={{ animation: !reduced, animationDurationUpdate: 180, animationEasingUpdate: "cubicOut", ...option }}
      style={{ height, width: "100%" }}
      onEvents={onClick ? { click: onClick } : undefined}
      opts={{ renderer: "svg" }}
    />
  );
}

// ---- Shared option pieces --------------------------------------------------

export const pctLabel = (v: number) => `${Math.round(v * 100)}%`;

/** Error-bar series: vertical (or horizontal) whiskers with caps from [i, low, high]. */
export function whiskerSeries(data: [number, number, number][], horizontal = false, color: string = tokens.ink2) {
  return {
    type: "custom" as const,
    name: "95% CI",
    silent: true,
    z: 3,
    data,
    tooltip: { show: false },
    renderItem: (_: unknown, api: any): any => {
      const i = api.value(0), lo = api.value(1), hi = api.value(2);
      const a = horizontal ? api.coord([lo, i]) : api.coord([i, lo]);
      const b = horizontal ? api.coord([hi, i]) : api.coord([i, hi]);
      const cap = 4;
      const style = { stroke: color, lineWidth: 1 };
      const capLine = (p: number[]) => horizontal
        ? { type: "line", shape: { x1: p[0], y1: p[1] - cap, x2: p[0], y2: p[1] + cap }, style }
        : { type: "line", shape: { x1: p[0] - cap, y1: p[1], x2: p[0] + cap, y2: p[1] }, style };
      return {
        type: "group",
        children: [
          { type: "line", shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style },
          capLine(a), capLine(b),
        ],
      };
    },
  };
}

export const rateTooltip = (r: GroupRate) =>
  `<b>${r.level}</b><br/>Yes rate ${(r.rate * 100).toFixed(1)}% (${r.positive} of n = ${r.n})` +
  `<br/>95% CI ${(r.ci_low * 100).toFixed(1)}–${(r.ci_high * 100).toFixed(1)}%${r.small ? "<br/>Small group (n < 10)" : ""}`;

/** Bars of a rate per level (first level on top) with Wilson CI whiskers. */
export function rateBarsOption(rows: GroupRate[], selected: string[] = []): echarts.EChartsOption {
  return {
    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
    tooltip: {
      trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: HOVER_SHADE } },
      formatter: (ps: any) => rateTooltip(rows[ps[0].dataIndex]),
    },
    yAxis: {
      type: "category", inverse: true, data: rows.map((r) => r.level),
      axisLabel: {
        interval: 0, formatter: (v: string, i: number) => `{l|${v}}\n{n|n = ${rows[i].n}}`,
        rich: { l: { color: tokens.ink2, fontSize: 12, align: "right" }, n: { color: tokens.ink3, fontSize: 12, align: "right" } },
      },
    },
    xAxis: { type: "value", min: 0, max: 1, splitNumber: 2, axisLabel: { formatter: pctLabel } },
    series: [
      {
        type: "bar", name: "Yes rate", barMaxWidth: 22, cursor: "pointer",
        data: rows.map((r, i) => ({
          value: r.rate,
          itemStyle: {
            color: r.small ? tokens.neutralBar
              : selected.length && !selected.includes(r.level) ? tokens.neutralBar : gradient(["violet", "pink", "teal", "amber", "sky"][i % 5]),
            borderRadius: [0, 6, 6, 0],
          },
        })),
      },
      whiskerSeries(rows.map((r, i) => [i, r.ci_low, r.ci_high]), true),
    ],
  };
}

export const rateTable = (rows: GroupRate[]): TableData => ({
  columns: ["Level", "n", "Yes", "Yes rate", "95% CI"],
  rows: rows.map((r) => [r.level, r.n, r.positive, `${(r.rate * 100).toFixed(1)}%`,
    `${(r.ci_low * 100).toFixed(1)}–${(r.ci_high * 100).toFixed(1)}%`]),
});
