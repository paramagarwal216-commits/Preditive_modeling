import * as echarts from "echarts";
import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, pct, useApi, type ColumnProfile, type Dashboard as DashboardData, type DistRow } from "../api";
import { Card } from "../components/Card";
import { Chart, gradient } from "../components/Chart";
import { ErrorState, Loading } from "../components/States";
import { LIST_KEYS, RangeInput, useFilters, type ListKey, type RangeKey } from "../filters";
import { ALGO_COLOR, ALGO_NAME, CATEGORY, GRADIENTS, HOVER_SHADE, tokens } from "../theme";

const source = "onlinefoods.csv, cleaned";
const COLUMN_KEY: Record<string, ListKey> = Object.fromEntries(LIST_KEYS.map((k) => [k.column, k.key]));

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
const fade = (hex: string) => new echarts.graphic.LinearGradient(0, 0, 0, 1, [
  { offset: 0, color: rgba(hex, 0.38) }, { offset: 1, color: rgba(hex, 0) },
]);

// ---------------------------------------------------------------- icons (16–20 px, 1.5 stroke)

const ICON: Record<string, ReactNode> = {
  people: <><circle cx="9" cy="8" r="3" /><path d="M3 19c0-3.3 2.7-5 6-5s6 1.7 6 5" /><circle cx="17" cy="9" r="2.2" /><path d="M16 14.2c2.6.2 5 1.6 5 4.8" /></>,
  check: <><circle cx="12" cy="12" r="8.5" /><path d="M8 12.3l2.7 2.7L16.3 9.4" /></>,
  star: <path d="M12 3.8l2.5 5.1 5.6.8-4 3.9.9 5.6-5-2.6-5 2.6.9-5.6-4-3.9 5.6-.8z" />,
  chip: <><rect x="6.5" y="6.5" width="11" height="11" rx="2" /><path d="M9.5 3.5v3M14.5 3.5v3M9.5 17.5v3M14.5 17.5v3M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" /></>,
  filter: <path d="M4 5h16l-6.2 7.2V19l-3.6-1.8v-5z" />,
  refresh: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4h-4" /></>,
  print: <><path d="M7 9V4h10v5" /><rect x="4" y="9" width="16" height="7" rx="1.5" /><path d="M7 14h10v6H7z" /></>,
  download: <><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5" /><path d="M5 19.5h14" /></>,
  reset: <><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" /><path d="M4.5 4.5v4h4" /></>,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  line: <path d="M3.5 17l5-6 4 3.5 7.5-9" />,
  bars: <path d="M6 19V11M12 19V5M18 19v-6" />,
  logo: <><circle cx="12" cy="12" r="9" /><path d="M7.5 13.5c1.2 2 2.8 3 4.5 3s3.3-1 4.5-3M8 9.5h.01M16 9.5h.01" /><path d="M12 3c2 2.4 2 5.6 0 8" /></>,
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>{ICON[name]}</svg>
  );
}

// ---------------------------------------------------------------- filter panel

function PanelRange({ k, label, column }: { k: RangeKey; label: string; column: string }) {
  const { filters, setRange, meta } = useFilters();
  const [lo, hi] = meta!.numeric_ranges[column];
  const applied = filters[k];
  const [draft, setDraft] = useState<[number, number]>(applied ?? [lo, hi]);
  useEffect(() => setDraft(applied ?? [lo, hi]), [applied?.[0], applied?.[1], lo, hi]); // eslint-disable-line
  useEffect(() => {
    if (draft[0] === (applied?.[0] ?? lo) && draft[1] === (applied?.[1] ?? hi)) return;
    const t = setTimeout(() => setRange(k, draft), 300);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line
  return (
    <div>
      <div className="mb-1 flex justify-between text-cap"><span className="font-semibold text-ink">{label}</span>
        <span className="text-ink-2">{draft[0]}–{draft[1]}</span></div>
      <RangeInput min={lo} max={hi} value={draft} onChange={setDraft} label={label} />
    </div>
  );
}

function FilterPanel({ n, nAll }: { n?: number; nAll?: number }) {
  const { meta, filters, filterKey, setList, reset } = useFilters();
  const active = Object.keys(JSON.parse(filterKey)).length;
  return (
    <aside className="card-rise glass col-span-12 self-start p-5 lg:sticky lg:top-20 lg:col-span-3 xl:col-span-2">
      <div className="mb-4 flex items-center gap-2 border-b border-white/10 pb-3 text-card text-ink">
        <span className="clay clay-violet grid h-8 w-8 place-items-center rounded-[10px]"><Icon name="filter" size={16} /></span> Filter
        {active > 0 && <span className="clay clay-pink ml-auto rounded-full px-2 text-cap">{active}</span>}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1">
        <PanelRange k="age" label="Age" column="Age" />
        {LIST_KEYS.map(({ key, label, column }) => {
          const sel = filters[key] ?? [];
          return (
            <label key={key} className="block text-cap font-semibold text-ink">
              {label}
              <select className="glass-inset mt-1 w-full rounded-[12px] px-2 py-1.5 text-body font-normal text-ink"
                value={sel.length === 1 ? sel[0] : sel.length > 1 ? "__multi" : ""}
                onChange={(e) => setList(key, e.target.value ? [e.target.value] : [])}>
                <option value="">All</option>
                {sel.length > 1 && <option value="__multi" disabled>{sel.length} selected</option>}
                {meta!.levels[column].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </label>
          );
        })}
        <PanelRange k="family" label="Family size" column="Family size" />
      </div>
      <button onClick={reset} disabled={active === 0}
        className="clay clay-pink mt-5 w-full py-2 text-body font-semibold disabled:opacity-40">Reset filter</button>
      {n != null && <p className="mt-3 text-center text-cap text-ink-2">{n} of {nAll} respondents in view</p>}
    </aside>
  );
}

// ---------------------------------------------------------------- KPI cards

function KpiCard({ title, value, sub, delta, icon, spark, color, clay, table }: {
  title: string; value: string; sub: string; delta?: { text: string; tone: "good" | "bad" | "flat" };
  icon: string; spark: (number | null)[]; color: string; clay: string; table: { columns: string[]; rows: ReactNode[][] };
}) {
  const tone = delta?.tone === "good" ? "text-good" : delta?.tone === "bad" ? "text-bad" : "text-ink-2";
  return (
    <section className="card-rise card-lift glass col-span-12 flex min-w-0 flex-col p-5 sm:col-span-6 xl:col-span-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-card text-ink-2">{title}</h2>
          <p className="mt-1 text-kpi text-ink">{value}</p>
        </div>
        <span className={`clay clay-${clay} grid h-11 w-11 place-items-center`}><Icon name={icon} /></span>
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <p className="max-w-[55%] text-cap text-ink-2">
          {delta && <span className={`font-semibold ${tone}`}>{delta.text} </span>}{sub}
        </p>
        <div className="h-14 w-[45%] min-w-[110px]">
          <Chart height={56} table={table} option={{
            grid: { left: 0, right: 0, top: 4, bottom: 0 },
            tooltip: { show: false },
            xAxis: { type: "category", show: false, boundaryGap: false, data: spark.map((_, i) => i) },
            yAxis: { type: "value", show: false, scale: true },
            series: [{ type: "line", data: spark, smooth: true, showSymbol: false, connectNulls: true,
              lineStyle: { color, width: 2 }, areaStyle: { color: fade(color) } }],
          }} />
        </div>
      </div>
    </section>
  );
}

function deltaPts(value: number | null, all: number, filtered: boolean): { text: string; tone: "good" | "bad" | "flat" } | undefined {
  if (value == null) return undefined;
  if (!filtered) return { text: "All respondents", tone: "flat" };
  const d = (value - all) * 100;
  return { text: `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)} pts`, tone: Math.abs(d) < 0.05 ? "flat" : d > 0 ? "good" : "bad" };
}

// ---------------------------------------------------------------- chart cards

function DonutCard({ title, subtitle, rows, k, cols }: { title: string; subtitle: string; rows: DistRow[]; k: ListKey; cols: string }) {
  const { filters, toggleLevel } = useFilters();
  const total = rows.reduce((s, r) => s + r.n, 0);
  const sel = filters[k] ?? [];
  return (
    <Card cols={cols} title={title} subtitle={subtitle} tableToggle note={`Click a slice or row to filter · n = ${total} · ${source}`}>
      <Chart height={180} onClick={(p) => p.name && toggleLevel(k, p.name)}
        table={{ columns: ["Level", "n", "Share", "Yes rate"], rows: rows.map((r) => [r.level, r.n, total ? pct(r.n / total) : "—", pct(r.rate)]) }}
        option={{
          tooltip: { trigger: "item", formatter: (p: any) => { const r = rows[p.dataIndex]; return `<b>${r.level}</b><br/>${r.n} respondents (${pct(p.percent / 100)})<br/>Yes rate ${pct(r.rate)}`; } },
          graphic: [{ type: "text", left: "center", top: "middle", style: { text: `${total}\nrespondents`, fill: tokens.ink, fontSize: 13, align: "center", lineHeight: 18 } }],
          series: [{
            type: "pie", radius: ["58%", "80%"], cursor: "pointer", avoidLabelOverlap: true, label: { show: false },
            itemStyle: { borderColor: tokens.surface, borderWidth: 3 },
            emphasis: { scale: true, scaleSize: 6 },
            data: rows.map((r, i) => ({
              name: r.level, value: r.n,
              itemStyle: { color: CATEGORY[i % CATEGORY.length], opacity: sel.length && !sel.includes(r.level) ? 0.35 : 1 },
            })),
          }],
        }} />
      <ul className="mt-2 space-y-1">
        {rows.map((r, i) => (
          <li key={r.level}>
            <button onClick={() => toggleLevel(k, r.level)}
              className={`grid w-full grid-cols-[12px_1fr_auto_auto] items-center gap-2 rounded-lg px-1 py-0.5 text-left text-cap hover:bg-white/5 ${sel.includes(r.level) ? "bg-white/10" : ""}`}>
              <span className="h-3 w-3 rounded-sm" style={{ background: CATEGORY[i % CATEGORY.length] }} />
              <span className="truncate text-ink">{r.level}</span>
              <span className="text-right text-ink">{r.n}</span>
              <span className="w-12 text-right text-ink-2">{total ? pct(r.n / total) : "—"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function BarsCard({ title, subtitle, rows, onPick, selected, cols, height, grad = "violet" }: {
  title: string; subtitle: string; rows: DistRow[]; onPick: (level: string) => void; selected: string[]; cols: string; height?: number;
  grad?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card cols={cols} title={title} subtitle={subtitle} tableToggle note={`Bar = respondents, label = Yes rate · click to filter · ${source}`}>
      <Chart notMerge height={height ?? Math.max(180, rows.length * 46 + 16)}
        onClick={(p) => { const lv = p.componentType === "yAxis" ? String(p.value) : p.name; if (lv) onPick(lv); }}
        table={{ columns: ["Level", "n", "Yes", "Yes rate"], rows: rows.map((r) => [r.level, r.n, r.yes, pct(r.rate)]) }}
        option={{
          grid: { left: 4, right: 76, top: 18, bottom: 4, containLabel: false },
          tooltip: { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: HOVER_SHADE } },
            formatter: (ps: any) => { const r = rows[ps[0].dataIndex]; return `<b>${r.level}</b><br/>${r.n} respondents<br/>Yes rate ${pct(r.rate)} (${r.yes} of ${r.n})`; } },
          xAxis: { type: "value", show: false, max: max * 1.05 },
          // Level names sit above their bar so the bars get the card's full width.
          yAxis: { type: "category", inverse: true, data: rows.map((r) => r.level), axisLine: { show: false }, triggerEvent: true,
            axisLabel: { color: tokens.ink2, inside: true, verticalAlign: "bottom", padding: [0, 0, 11, 0] } },
          series: [{
            type: "bar", barWidth: 12, cursor: "pointer",
            showBackground: true, backgroundStyle: { color: "rgba(255, 255, 255, 0.07)", borderRadius: 6 },
            data: rows.map((r) => ({ value: r.n, itemStyle: {
              color: selected.length && !selected.includes(r.level) ? tokens.neutralBar : gradient(grad), borderRadius: 6 } })),
            label: { show: true, position: "right", color: tokens.ink, fontSize: 12,
              formatter: (p: any) => `${p.value}  {r|${pct(rows[p.dataIndex].rate, 0)}}`,
              rich: { r: { color: GRADIENTS[grad]?.[0] ?? tokens.sky, fontSize: 12 } } },
          }],
        }} />
    </Card>
  );
}

function AgeTrend({ d, cols }: { d: DashboardData; cols: string }) {
  const { filters, setRange } = useFilters();
  const [kind, setKind] = useState<"line" | "bar">("line");
  const rows = d.by_age;
  const toggleAge = (a: number) =>
    setRange("age", filters.age?.[0] === a && filters.age?.[1] === a ? undefined : [a, a]);
  const series = [["Respondents", "n", tokens.violet], ["Say Yes", "yes", tokens.pink], ["Positive feedback", "positive", tokens.teal]] as const;
  return (
    <Card cols={cols} title="Respondents across age" subtitle="How do counts, Yes answers and positive feedback change with age? Click an age to filter."
      tableToggle note={`One point per year of age · n = ${d.n} · ${source}`}
      actions={
        <div className="glass-inset inline-flex gap-0.5 p-0.5" role="group" aria-label="Chart type">
          {(["line", "bar"] as const).map((t) => (
            <button key={t} aria-pressed={kind === t} aria-label={t === "line" ? "Line chart" : "Bar chart"} onClick={() => setKind(t)}
              className={`grid h-7 w-8 place-items-center rounded-[10px] ${kind === t ? "clay clay-teal" : "text-ink-2"}`}>
              <Icon name={t === "line" ? "line" : "bars"} size={16} />
            </button>
          ))}
        </div>
      }>
      <Chart notMerge height={260} onClick={(p) => { const r = rows[p.dataIndex]; if (r) toggleAge(r.age); }}
        table={{ columns: ["Age", "Respondents", "Say Yes", "Yes rate", "Positive feedback"], rows: rows.map((r) => [r.age, r.n, r.yes, r.n ? pct(r.yes / r.n) : "—", r.positive]) }}
        option={{
          legend: { top: 0, left: 0, data: series.map((s) => s[0]) },
          grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
          tooltip: { trigger: "axis", formatter: (ps: any) => {
            const r = rows[ps[0].dataIndex];
            return `<b>Age ${r.age}</b><br/>${r.n} respondents<br/>${r.yes} say Yes (${r.n ? pct(r.yes / r.n) : "—"})<br/>${r.positive} positive feedback`;
          } },
          xAxis: { type: "category", data: rows.map((r) => String(r.age)), boundaryGap: kind === "bar" },
          yAxis: { type: "value", minInterval: 1 },
          series: series.map(([name, key, color]) => ({
            name, type: kind, data: rows.map((r) => r[key]), smooth: true, symbolSize: 6, cursor: "pointer",
            barMaxWidth: 12, itemStyle: { color, borderRadius: kind === "bar" ? [2, 2, 0, 0] : 0 },
            lineStyle: { color, width: 2.5 }, areaStyle: kind === "line" && key === "n" ? { color: fade(color) } : undefined,
          })),
        }} />
    </Card>
  );
}

function TopPins({ d, cols }: { d: DashboardData; cols: string }) {
  const { search } = useLocation();
  const max = Math.max(1, ...d.top_pins.map((p) => p.n));
  return (
    <Card cols={cols} title="Top pin codes" subtitle="Where do most respondents in this view live?"
      note={<>Bar = respondents · <Link to={{ pathname: "/geography", search }} className="text-sky underline">open the map</Link></>}>
      {d.top_pins.length === 0 ? <p className="text-body text-ink-2">No respondents in view.</p> : (
        <ul className="space-y-3">
          {d.top_pins.map((p) => (
            <li key={p.pin}>
              <div className="flex items-center gap-2">
                <div className="h-2.5 flex-1 rounded-full bg-white/10">
                  <div className="h-2.5 rounded-full" style={{ width: `${(p.n / max) * 100}%`, background: "linear-gradient(90deg, #F59E0B, #F472B6)" }} />
                </div>
                <span className="w-6 text-right text-cap text-ink">{p.n}</span>
              </div>
              <p className="mt-0.5 flex justify-between text-cap"><span className="font-mono text-ink">{p.pin}</span>
                <span className="text-ink-2">{pct(p.rate, 0)} say Yes</span></p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RowBars({ rows, k, color }: { rows: DistRow[]; k: ListKey; color: string }) {
  const { filters, toggleLevel } = useFilters();
  const total = rows.reduce((s, r) => s + r.n, 0);
  const sel = filters[k] ?? [];
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.level}>
          <button onClick={() => toggleLevel(k, r.level)}
            className={`grid w-full grid-cols-[88px_1fr_36px_44px] items-center gap-2 rounded-lg px-1 py-0.5 text-left text-cap hover:bg-white/5 ${sel.includes(r.level) ? "bg-white/10" : ""}`}>
            <span className="truncate text-ink-2">{r.level}</span>
            <span className="h-3 rounded-full bg-white/10"><span className="block h-3 rounded-full" style={{ width: `${total ? (r.n / total) * 100 : 0}%`, background: color }} /></span>
            <span className="text-right text-ink">{r.n}</span>
            <span className="text-right text-ink-2">{total ? pct(r.n / total, 0) : "—"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Loyalty({ d, cols }: { d: DashboardData; cols: string }) {
  const fb = d.kpis.feedback_rate.value;
  return (
    <Card cols={cols} title="Feedback & customer type" subtitle="How do respondents rate the experience, and how often do they order?"
      note={`Descriptive only, never model inputs · click a row to filter · n = ${d.n}`}>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2">
        <span className="text-kpi text-ink">{pct(fb)}</span>
        <span className="text-cap text-ink-2">positive feedback</span>
        <span className="flex text-warn" aria-hidden>
          {[0, 1, 2, 3, 4].map((i) => (
            <svg key={i} width="14" height="14" viewBox="0 0 24 24" fill={fb != null && i < Math.round(fb * 5) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
              {ICON.star}
            </svg>
          ))}
        </span>
      </div>
      <p className="mb-1 text-cap font-semibold text-ink">Feedback</p>
      <RowBars rows={d.dist["Feedback"]} k="feedback" color="linear-gradient(90deg, #0D9488, #5EEAD4)" />
      <p className="mb-1 mt-3 text-cap font-semibold text-ink">Customer type</p>
      <RowBars rows={d.dist["Customer Type"]} k="customer" color="linear-gradient(90deg, #D97706, #FDE68A)" />
    </Card>
  );
}

function ModelsCard({ d, cols }: { d: DashboardData; cols: string }) {
  const m = d.models;
  const order = ["random_forest", "xgboost", "logistic_regression", "majority_baseline"].filter((x) => m.roc_auc[x]);
  return (
    <Card cols={cols} title="Prediction models" subtitle="How well can a model tell Yes from No on unseen respondents?"
      note={<>ROC-AUC over {m.n_folds} held-out folds · 0.5 = coin flip · <Link to="/models" className="text-sky underline">open Models & Predictor</Link></>}>
      <ul className="space-y-3">
        {order.map((x) => {
          const a = m.roc_auc[x];
          const pos = (v: number) => `${((v - 0.4) / 0.6) * 100}%`;
          return (
            <li key={x}>
              <div className="flex items-center justify-between text-cap">
                <span className="font-semibold" style={{ color: ALGO_COLOR[x] }}>{ALGO_NAME[x]}
                  {x === m.default_model && <span className="clay clay-violet ml-2 rounded-full px-1.5 font-normal">default</span>}</span>
                <span className="text-ink">{a.mean.toFixed(3)} <span className="text-ink-3">[{a.ci_low.toFixed(2)}–{a.ci_high.toFixed(2)}]</span></span>
              </div>
              <div className="relative mt-1 h-2.5 rounded-full bg-white/10" aria-hidden>
                <div className="absolute top-0 h-2.5 rounded-sm opacity-40" style={{ left: pos(Math.max(0.4, a.ci_low)), width: `calc(${pos(a.ci_high)} - ${pos(Math.max(0.4, a.ci_low))})`, background: ALGO_COLOR[x] }} />
                <div className="absolute -top-0.5 h-3.5 w-1 rounded-sm" style={{ left: pos(a.mean), background: ALGO_COLOR[x] }} />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-cap text-ink-2">{m.default_reason.replace(/logistic_regression|random_forest|xgboost/g, (s) => ALGO_NAME[s])}.</p>
    </Card>
  );
}

// ---------------------------------------------------------------- dataset details

const ROLE_TONE: Record<string, string> = {
  "Target": "border-good text-good", "Dropped": "border-bad text-bad", "Charts only": "border-warn text-warn",
  "Geography only": "border-sky text-sky", "Descriptive only": "border-violet text-violet",
};
const roleTone = (role: string) => ROLE_TONE[role] ?? (role.includes("feature") ? "border-accent text-accent" : "border-line text-ink-2");
const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(Math.abs(v) < 100 ? 2 : 4));

function ColumnTile({ c }: { c: ColumnProfile }) {
  const { filters, toggleLevel } = useFilters();
  const key = COLUMN_KEY[c.column.trim()];
  const total = c.top?.reduce((s, t) => s + t.n, 0) ?? 0;
  return (
    <div className="card-lift glass-inset p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="font-mono text-body text-ink">{c.column}</p>
        <span className={`shrink-0 rounded-sm border px-1.5 text-cap ${roleTone(c.role)}`}>{c.role}</span>
      </div>
      <p className="mt-1 text-cap text-ink-2">
        {c.type} · {c.unique == null ? "removed" : `${c.unique} unique`} · {c.missing} missing in raw file
      </p>
      {c.summary && (() => {
        const s = c.summary;
        const span = s.max - s.min || 1;
        const at = (v: number) => `${((v - s.min) / span) * 100}%`;
        return (
          <>
            <div className="relative mt-3 h-3" aria-hidden>
              <div className="absolute top-1 h-1 w-full rounded-sm bg-line" />
              <div className="absolute top-0 h-3 rounded-full" style={{ left: at(s.q1), width: `calc(${at(s.q3)} - ${at(s.q1)})`, background: "linear-gradient(90deg, rgba(45,212,191,.7), rgba(167,139,250,.7))" }} />
              <div className="absolute top-0 h-3 w-0.5 bg-amber" style={{ left: at(s.median) }} />
            </div>
            <dl className="mt-2 grid grid-cols-4 gap-1 text-cap">
              {([["min", s.min], ["median", s.median], ["mean", s.mean], ["max", s.max]] as const).map(([l, v]) => (
                <div key={l}><dt className="text-ink-3">{l}</dt><dd className="text-ink">{fmt(v)}</dd></div>
              ))}
            </dl>
          </>
        );
      })()}
      {c.top && (
        <ul className="mt-3 space-y-1">
          {c.top.map((t) => {
            const on = key && filters[key]?.includes(t.level);
            const body = (
              <>
                <span className="truncate text-ink-2">{t.level}</span>
                <span className="h-2 rounded-full bg-white/10"><span className="block h-2 rounded-full" style={{ width: `${total ? (t.n / total) * 100 : 0}%`, background: "linear-gradient(90deg, #7C3AED, #F472B6)" }} /></span>
                <span className="text-right text-ink">{t.n}</span>
              </>
            );
            const cls = `grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] items-center gap-2 rounded-lg px-1 text-left text-cap ${on ? "bg-white/10" : ""}`;
            return (
              <li key={t.level}>
                {key ? <button className={`${cls} hover:bg-white/5`} onClick={() => toggleLevel(key, t.level)} title={`Filter to ${t.level}`}>{body}</button>
                  : <div className={cls}>{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-cap text-ink-3">{c.note}</p>
    </div>
  );
}

function DatasetDetails({ d }: { d: DashboardData }) {
  const s = d.source;
  const facts: [string, ReactNode][] = [
    ["Source", s.name], ["File", <span className="font-mono">{s.file}</span>], ["Collected in", s.place],
    ["Rows", `${s.rows_raw} raw → ${s.rows_clean} clean`], ["Columns", `${s.columns_raw} in the raw file`],
    ["Duplicates removed", s.duplicates], ["Missing cells", s.missing_cells],
    ["Target", `${s.target} (positive class "${s.positive_class}")`], ["Model inputs", `${s.features.length}: ${s.features.join(", ")}`],
  ];
  return (
    <Card cols="col-span-12" id="dataset" title="Dataset details" subtitle="What is every column in the file, and what does it look like in the current selection?"
      note={`Summaries use the ${d.n} cleaned respondents in view; "missing" counts the raw file · click a level to filter`}>
      <dl className="glass-inset mb-5 grid grid-cols-1 gap-x-6 gap-y-2 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {facts.map(([k, v]) => (
          <div key={k} className="min-w-0"><dt className="text-cap text-ink-3">{k}</dt><dd className="text-body text-ink">{v}</dd></div>
        ))}
      </dl>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {d.profile.map((c) => <ColumnTile key={c.column} c={c} />)}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- page

function Dock({ onRefresh, busy }: { onRefresh: () => void; busy: boolean }) {
  const { filters, reset } = useFilters();
  const doExport = async () => {
    const url = URL.createObjectURL(await api.exportCsv(filters));
    const a = document.createElement("a");
    a.href = url; a.download = "onlinefoods_filtered.csv"; a.click();
    URL.revokeObjectURL(url);
  };
  const items: [string, string, () => void, string][] = [
    ["refresh", "Refresh data", onRefresh, "violet"], ["download", "Export filtered CSV", doExport, "pink"],
    ["print", "Print dashboard", () => window.print(), "teal"], ["reset", "Reset filters", reset, "amber"],
    ["up", "Back to top", () => window.scrollTo({ top: 0, behavior: "smooth" }), "sky"],
  ];
  return (
    <div className="no-print glass fixed bottom-5 right-5 z-[1050] flex gap-2 !rounded-full p-2">
      {items.map(([icon, label, fn, tone]) => (
        <button key={icon} onClick={fn} title={label} aria-label={label}
          className={`clay clay-${tone} grid h-10 w-10 place-items-center !rounded-full ${icon === "refresh" && busy ? "animate-spin" : ""}`}>
          <Icon name={icon} size={18} />
        </button>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { filters, filterKey, toggleLevel, setRange } = useFilters();
  const [nonce, setNonce] = useState(0);
  const q = useApi(() => api.dashboard(filters), filterKey + nonce);
  const d = q.data;
  const filtered = filterKey !== "{}";
  const familyPick = (lv: string) => {
    const v = Number(lv);
    setRange("family", filters.family?.[0] === v && filters.family?.[1] === v ? undefined : [v, v]);
  };
  const ages = d?.by_age ?? [];

  return (
    <>
      <div className="card-rise glass mb-4 flex flex-wrap items-center gap-4 px-5 py-4">
        <span className="clay clay-pink grid h-12 w-12 place-items-center !rounded-2xl"><Icon name="logo" size={28} /></span>
        <div className="min-w-0">
          <h1 className="text-gradient text-kpi">Online Food Ordering · Consumer Dashboard</h1>
          <p className="text-cap text-ink-2">
            {d ? <>Data loaded {d.source.loaded_at} · {d.source.file} · {d.source.place} · {d.n} of {d.n_all} respondents in view</> : "Loading data…"}
          </p>
        </div>
        <a href="#dataset" className="clay clay-teal ml-auto !rounded-full px-4 py-1.5 text-cap font-semibold">Dataset details ↓</a>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <FilterPanel n={d?.n} nAll={d?.n_all} />
        <div className="col-span-12 grid min-w-0 grid-cols-12 content-start gap-4 lg:col-span-9 xl:col-span-10">
          {q.error ? <div className="col-span-12"><ErrorState message={q.error} /></div> : !d ? <div className="col-span-12"><Loading /></div> : (
            <>
              <KpiCard title="Respondents" value={String(d.n)} icon="people" color={tokens.violet} clay="violet"
                delta={{ text: pct(d.n / d.n_all, 0), tone: "flat" }} sub={`of ${d.n_all} after cleaning`}
                spark={ages.map((a) => a.n)} table={{ columns: ["Age", "n"], rows: ages.map((a) => [a.age, a.n]) }} />
              <KpiCard title="Say Yes" value={pct(d.kpis.yes_rate.value)} icon="check" color={tokens.pink} clay="pink"
                delta={deltaPts(d.kpis.yes_rate.value, d.kpis.yes_rate.all, filtered)} sub={filtered ? "vs all respondents" : ""}
                spark={ages.map((a) => (a.n >= 3 ? a.yes / a.n : null))} table={{ columns: ["Age", "Yes rate"], rows: ages.map((a) => [a.age, a.n ? pct(a.yes / a.n) : "—"]) }} />
              <KpiCard title="Positive feedback" value={pct(d.kpis.feedback_rate.value)} icon="star" color={tokens.teal} clay="teal"
                delta={deltaPts(d.kpis.feedback_rate.value, d.kpis.feedback_rate.all, filtered)} sub={filtered ? "vs all respondents" : ""}
                spark={ages.map((a) => (a.n >= 3 ? a.positive / a.n : null))} table={{ columns: ["Age", "Positive"], rows: ages.map((a) => [a.age, a.n ? pct(a.positive / a.n) : "—"]) }} />
              <KpiCard title="Model ROC-AUC" value={d.models.roc_auc[d.models.default_model].mean.toFixed(3)}
                icon="chip" color={tokens.amber} clay="amber"
                delta={{ text: ALGO_NAME[d.models.default_model], tone: "flat" }}
                sub={`(default), ${d.models.n_folds} folds`}
                spark={d.models.fold_auc} table={{ columns: ["Fold", "ROC-AUC"], rows: d.models.fold_auc.map((v, i) => [i + 1, v.toFixed(3)]) }} />

              {d.n === 0 ? (
                <div className="glass col-span-12 p-5">
                  <p className="text-body text-ink-2">No respondents match these filters — use Reset filter.</p>
                </div>
              ) : (
                <>
                  <DonutCard cols="col-span-12 md:col-span-6 xl:col-span-3" title="Marital status" subtitle="Who is in this view?" rows={d.dist["Marital Status"]} k="marital" />
                  <BarsCard cols="col-span-12 md:col-span-6 xl:col-span-3" title="Occupation" subtitle="How many respondents per occupation, and what share say Yes?"
                    rows={d.dist["Occupation"]} onPick={(l) => toggleLevel("occupation", l)} selected={filters.occupation ?? []} grad="violet" />
                  <BarsCard cols="col-span-12 md:col-span-6 xl:col-span-3" title="Monthly income" subtitle="How is the view spread across income bands (low to high)?"
                    rows={d.dist["Monthly Income"]} onPick={(l) => toggleLevel("income", l)} selected={filters.income ?? []} grad="teal" />
                  <TopPins d={d} cols="col-span-12 md:col-span-6 xl:col-span-3" />

                  <DonutCard cols="col-span-12 md:col-span-6 xl:col-span-3" title="Gender" subtitle="How does the view split by gender?" rows={d.dist["Gender"]} k="gender" />
                  <AgeTrend d={d} cols="col-span-12 xl:col-span-6" />
                  <Loyalty d={d} cols="col-span-12 md:col-span-6 xl:col-span-3" />

                  <BarsCard cols="col-span-12 md:col-span-6 xl:col-span-4" title="Education" subtitle="Which qualifications are in this view (low to high)?"
                    rows={d.dist["Educational Qualifications"]} onPick={(l) => toggleLevel("education", l)} selected={filters.education ?? []} grad="amber" />
                  <BarsCard cols="col-span-12 md:col-span-6 xl:col-span-4" title="Family size" subtitle="How large are respondents' households?"
                    rows={d.dist["Family size"]} onPick={familyPick} grad="pink"
                    selected={filters.family && filters.family[0] === filters.family[1] ? [String(filters.family[0])] : []} />
                  <ModelsCard d={d} cols="col-span-12 xl:col-span-4" />
                </>
              )}
            </>
          )}
        </div>
      </div>
      {/* Outside the filter grid so the sticky filter panel stops above it. */}
      {d && <div className="mt-4 grid grid-cols-12"><DatasetDetails d={d} /></div>}
      <Dock onRefresh={() => setNonce((x) => x + 1)} busy={q.loading} />
    </>
  );
}
