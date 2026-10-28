import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, pct, useApi, type Filters, type GroupRate, type SegmentTest } from "../api";
import { Card } from "../components/Card";
import { Chart, DataTable, rateTable, whiskerSeries } from "../components/Chart";
import { Page } from "../components/Shell";
import { Guard } from "../components/States";
import { ATTRIBUTE_LABEL, LIST_KEYS, useFilters, type ListKey } from "../filters";
import { HOVER_SHADE, tealScale, tokens } from "../theme";

const ATTRS = ["age", "family", "gender", "marital", "occupation", "income", "education"];
const MEASURE_WORD = { output: "Yes", feedback: "Positive feedback" } as const;
const selectCls = "glass-inset rounded-full px-3 py-1 text-body text-ink";
const source = "Source: onlinefoods.csv, cleaned";

/** Filters for one level of an attribute, combined with the current filters. */
function levelFilters(filters: Filters, by: string, level: string): Filters {
  if (by === "age") {
    const [a, b] = level.split("–").map(Number);
    return { ...filters, age: [Math.max(a, filters.age?.[0] ?? a), Math.min(b, filters.age?.[1] ?? b)] };
  }
  if (by === "family") return { ...filters, family: [Number(level), Number(level)] };
  return { ...filters, [by]: [level] };
}

const fmtP = (p: number | null) => (p == null ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));

function testSentence(t: SegmentTest, by: string, measure: "output" | "feedback") {
  if (t.p_holm == null) return t.reason ?? "Not enough data to test.";
  const attr = ATTRIBUTE_LABEL[by].toLowerCase();
  const what = measure === "output" ? "the Yes rate" : "the positive-feedback rate";
  return t.p_holm < 0.05
    ? `In this selection, ${attr} is associated with ${what}; the difference is unlikely to be chance alone after adjusting for testing 7 attributes.`
    : `In this selection, no association between ${attr} and ${what} is detected at the 5% level after adjusting for testing 7 attributes.`;
}

function RowsDrawer({ by, level, onClose }: { by: string; level: string; onClose: () => void }) {
  const { filters, toggleLevel } = useFilters();
  const f = levelFilters(filters, by, level);
  const [page, setPage] = useState(1);
  const q = useApi(() => api.rows(f, "clean", page, 25), JSON.stringify(f) + page);
  const isList = LIST_KEYS.some((k) => k.key === by);
  return (
    <div className="fixed inset-0 z-[1200] flex justify-end bg-bg/70" onClick={onClose}>
      <aside className="glass glass-strong h-full w-full max-w-[640px] overflow-auto !rounded-none p-5" role="dialog"
        aria-label={`Rows for ${level}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="text-card text-ink">{ATTRIBUTE_LABEL[by]}: {level}</h2>
            <p className="text-cap text-ink-2">{q.data ? `${q.data.total} respondents in the current selection` : ""}</p>
          </div>
          <div className="flex gap-2">
            {isList && (
              <button className="rounded border border-accent px-2 py-0.5 text-cap text-accent"
                onClick={() => { toggleLevel(by as ListKey, level); onClose(); }}>Filter to this level</button>
            )}
            <button className="glass-inset rounded-full px-3 py-0.5 text-cap text-ink-2" onClick={onClose} autoFocus>Close</button>
          </div>
        </div>
        <Guard loading={q.loading} error={q.error} empty={q.data ? q.data.total === 0 : undefined}>
          {() => (
            <>
              <DataTable maxHeight={9999} columns={q.data!.columns}
                rows={q.data!.rows.map((r) => q.data!.columns.map((c) => r[c] ?? ""))} />
              <div className="mt-2 flex items-center gap-2 text-cap text-ink-2">
                <button disabled={page === 1} onClick={() => setPage(page - 1)} className="disabled:opacity-40">‹ Prev</button>
                <span>Page {page} of {Math.max(1, Math.ceil(q.data!.total / 25))}</span>
                <button disabled={page * 25 >= q.data!.total} onClick={() => setPage(page + 1)} className="disabled:opacity-40">Next ›</button>
              </div>
            </>
          )}
        </Guard>
      </aside>
    </div>
  );
}

export default function Segments() {
  const { filters, filterKey } = useFilters();
  const [sp, setSp] = useSearchParams();
  const by = ATTRS.includes(sp.get("by") ?? "") ? sp.get("by")! : "occupation";
  const measure = sp.get("measure") === "feedback" ? "feedback" : "output";
  const by2 = ATTRS.includes(sp.get("by2") ?? "") && sp.get("by2") !== by ? sp.get("by2")! : (by === "income" ? "occupation" : "income");
  const setParam = (k: string, v: string) => { const n = new URLSearchParams(sp); n.set(k, v); setSp(n); };
  const [drawer, setDrawer] = useState<string | null>(null);

  const q = useApi(() => api.segments(filters, by, measure, by2), filterKey + by + measure + by2);
  const d = q.data;
  const empty = d ? d.overall.n === 0 : undefined;
  const word = MEASURE_WORD[measure];
  const sorted: GroupRate[] = d ? [...d.rows].sort((a, b) => a.rate - b.rate) : [];

  return (
    <Page title="Segments" question="Which groups differ on Output or Feedback?" filters>
      <div className="col-span-12 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-body text-ink-2">Compare by
          <select className={selectCls} value={by} onChange={(e) => setParam("by", e.target.value)}>
            {ATTRS.map((a) => <option key={a} value={a}>{ATTRIBUTE_LABEL[a]}</option>)}
          </select>
        </label>
        <div className="glass-inset inline-flex gap-0.5 p-0.5 text-body" role="group" aria-label="Measure">
          {(["output", "feedback"] as const).map((m) => (
            <button key={m} aria-pressed={measure === m} onClick={() => setParam("measure", m)}
              className={`rounded-full px-3 py-1 ${measure === m ? "clay clay-violet rounded-full" : "text-ink-2"}`}>
              {m === "output" ? "Output" : "Feedback"}
            </button>
          ))}
        </div>
      </div>

      <Card span={8} title={`${word} rate by ${ATTRIBUTE_LABEL[by].toLowerCase()}`}
        subtitle="Which levels sit above or below the overall rate? Click a level to see its rows."
        note={`Dot = rate, whisker = Wilson 95% interval, dashed = overall ${pct(d?.overall.rate)} (n = ${d?.overall.n ?? "—"}) · grey = n < 10 · ${source}`}
        tableToggle>
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => (
            <Chart height={Math.max(220, sorted.length * 34 + 40)} table={rateTable(sorted.slice().reverse())}
              onClick={(p) => setDrawer(p.componentType === "yAxis" ? String(p.value) : sorted[p.dataIndex]?.level ?? null)}
              option={{
                grid: { left: 8, right: 24, top: 16, bottom: 8, containLabel: true },
                tooltip: {
                  trigger: "item",
                  formatter: (p: any) => {
                    const r = sorted[p.dataIndex];
                    return `<b>${r.level}</b><br/>${word} rate ${pct(r.rate)} (${r.positive} of n = ${r.n})<br/>95% CI ${pct(r.ci_low)}–${pct(r.ci_high)}`;
                  },
                },
                xAxis: { type: "value", min: 0, max: 1, axisLabel: { formatter: (v: number) => pct(v, 0) } },
                yAxis: { type: "category", data: sorted.map((r) => r.level), triggerEvent: true, axisLabel: { color: tokens.ink2 } },
                series: [
                  whiskerSeries(sorted.map((r, i) => [i, r.ci_low, r.ci_high]), true),
                  {
                    type: "scatter", symbolSize: 10, cursor: "pointer", z: 4,
                    data: sorted.map((r) => ({ value: [r.rate, r.level], itemStyle: { color: r.small ? tokens.ink3 : tokens.accent } })),
                    markLine: d!.overall.rate == null ? undefined : {
                      symbol: "none", silent: true,
                      lineStyle: { type: "dashed", color: tokens.ink3 },
                      label: { formatter: `overall ${pct(d!.overall.rate)}`, color: tokens.ink3, fontSize: 12 },
                      data: [{ xAxis: d!.overall.rate }],
                    },
                  },
                ],
              }} />
          )}
        </Guard>
      </Card>

      <Card span={4} title="Association test" subtitle={`Is ${ATTRIBUTE_LABEL[by].toLowerCase()} associated with the ${word} rate?`}
        note={`Holm adjustment across ${d?.test?.n_tests ?? 7} attributes · n = ${d?.overall.n ?? "—"} · ${source}`}>
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => {
            const t = d!.test!;
            return (
              <div className="space-y-3">
                <dl className="grid grid-cols-2 gap-y-1 text-body">
                  <dt className="text-ink-2">Test</dt><dd className="text-ink">{t.name}</dd>
                  <dt className="text-ink-2">Statistic</dt>
                  <dd className="text-ink">{t.stat == null ? "—" : `${t.stat_label} = ${t.stat.toFixed(2)}`}</dd>
                  <dt className="text-ink-2">p</dt><dd className="text-ink">{fmtP(t.p)}</dd>
                  <dt className="text-ink-2">Holm p</dt><dd className="font-semibold text-ink">{fmtP(t.p_holm)}</dd>
                </dl>
                <p className="max-w-prose text-body text-ink">{testSentence(t, by, measure)}</p>
              </div>
            );
          }}
        </Guard>
      </Card>

      <Card span={6} title="Age by outcome" subtitle="How are ages spread among Yes and No respondents?"
        note={`2-year bins · n = ${d?.overall.n ?? "—"} · ${source}`} tableToggle>
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => (
            <Chart table={{ columns: ["Age", "Yes", "No"], rows: d!.age_hist.map((b) => [b.bin, b.yes, b.no]) }}
              option={{
                legend: { top: 0, right: 0, data: ["Yes", "No"] },
                grid: { left: 8, right: 8, top: 28, bottom: 8, containLabel: true },
                tooltip: {
                  trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: HOVER_SHADE } },
                  formatter: (ps: any) => {
                    const b = d!.age_hist[ps[0].dataIndex];
                    const n = b.yes + b.no;
                    return `<b>Age ${b.bin}</b><br/>Yes ${b.yes} (${n ? pct(b.yes / n) : "—"})<br/>No ${b.no} (${n ? pct(b.no / n) : "—"})<br/>n = ${n}`;
                  },
                },
                xAxis: { type: "category", data: d!.age_hist.map((b) => b.bin) },
                yAxis: { type: "value", name: "respondents", minInterval: 1 },
                series: [
                  { type: "bar", name: "Yes", stack: "o", data: d!.age_hist.map((b) => b.yes), itemStyle: { color: tokens.accent } },
                  { type: "bar", name: "No", stack: "o", data: d!.age_hist.map((b) => b.no), itemStyle: { color: tokens.neutralBar } },
                ],
              }} />
          )}
        </Guard>
      </Card>

      <Card span={6} title={`${word} rate by ${ATTRIBUTE_LABEL[by].toLowerCase()} and ${ATTRIBUTE_LABEL[by2].toLowerCase()}`}
        subtitle="How does the rate vary when two attributes are combined?"
        note={`Cells with n < 5 left blank · n = ${d?.overall.n ?? "—"} · ${source}`} tableToggle
        actions={
          <select aria-label="Second attribute" className={`${selectCls} text-cap`} value={by2} onChange={(e) => setParam("by2", e.target.value)}>
            {ATTRS.filter((a) => a !== by).map((a) => <option key={a} value={a}>{ATTRIBUTE_LABEL[a]}</option>)}
          </select>
        }>
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => {
            const h = d!.heatmap!;
            return (
              <Chart notMerge height={Math.max(240, h.y_levels.length * 36 + 70)}
                table={{
                  columns: [ATTRIBUTE_LABEL[by], ATTRIBUTE_LABEL[by2], "n", `${word} rate`],
                  rows: h.cells.filter((c) => c.n > 0).map((c) => [c.x, c.y, c.n, c.rate == null ? "n < 5" : pct(c.rate)]),
                }}
                option={{
                  grid: { left: 8, right: 8, top: 8, bottom: 32, containLabel: true },
                  tooltip: {
                    trigger: "item",
                    formatter: (p: any) => {
                      const c = h.cells[p.dataIndex];
                      return `<b>${c.x} · ${c.y}</b><br/>${c.rate == null ? "Too few respondents to show" : `${word} rate ${pct(c.rate)}`}<br/>n = ${c.n}`;
                    },
                  },
                  xAxis: { type: "category", data: h.x_levels, axisLabel: { interval: 0, rotate: h.x_levels.length > 3 ? 30 : 0, width: 90, overflow: "truncate" } },
                  yAxis: { type: "category", data: h.y_levels },
                  visualMap: {
                    type: "piecewise", orient: "horizontal", left: "center", bottom: 0, itemWidth: 14, itemHeight: 10,
                    pieces: [0, 0.2, 0.4, 0.6, 0.8].map((lo) => ({
                      min: lo, max: lo + 0.2, label: `${Math.round(lo * 100)}–${Math.round((lo + 0.2) * 100)}%`, color: tealScale(lo + 0.1),
                    })),
                    textStyle: { color: tokens.ink2, fontSize: 12 },
                  },
                  series: [{
                    type: "heatmap",
                    data: h.cells.map((c) => ({
                      value: [h.x_levels.indexOf(c.x), h.y_levels.indexOf(c.y), c.rate ?? "-"],
                      label: { color: (c.rate ?? 0) > 0.6 ? tokens.surface : tokens.ink },
                    })),
                    label: {
                      show: true, fontSize: 12,
                      formatter: (p: any) => (typeof p.value[2] === "number" ? pct(p.value[2], 0) : ""),
                    },
                    itemStyle: { borderColor: tokens.surface, borderWidth: 2 },
                  }],
                }} />
            );
          }}
        </Guard>
      </Card>

      {drawer && <RowsDrawer by={by} level={drawer} onClose={() => setDrawer(null)} />}
    </Page>
  );
}
