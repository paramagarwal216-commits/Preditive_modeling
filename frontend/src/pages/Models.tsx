import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { api, num, useApi, type FoldEvent, type Models as ModelsData, type Summary } from "../api";
import { Card } from "../components/Card";
import { Chart, DataTable, whiskerSeries } from "../components/Chart";
import { Page } from "../components/Shell";
import { ErrorState, Loading } from "../components/States";
import { ALGO_COLOR, ALGO_NAME, tokens } from "../theme";
import { PredictorPanel } from "./Predictor";

const ORDER = ["logistic_regression", "random_forest", "xgboost", "majority_baseline"];
const ALGOS = ORDER.slice(0, 3);
const METRICS = [
  ["roc_auc", "ROC-AUC"], ["pr_auc", "PR-AUC"], ["f1", "F1"], ["precision", "Precision"],
  ["recall", "Recall"], ["accuracy", "Accuracy"], ["brier", "Brier"],
] as const;
type Metric = (typeof METRICS)[number][0];

const PARAM_SHORT: Record<string, string> = {
  n_estimators: "trees", max_depth: "depth", learning_rate: "lr", min_samples_leaf: "min_leaf",
  max_features: "max_feat", subsample: "subsample", colsample_bytree: "colsample", reg_lambda: "lambda",
  C: "C", penalty: "penalty",
};
const fmtParams = (p: Record<string, string | number> | null | undefined) =>
  p ? Object.entries(p).map(([k, v]) => {
    const key = k.replace("model__", "");
    return `${PARAM_SHORT[key] ?? key}=${typeof v === "number" && !Number.isInteger(v) ? v.toPrecision(2) : v}`;
  }).join("  ") : "";
const prettyReason = (r: string) => ORDER.reduce((s, m) => s.split(m).join(ALGO_NAME[m]), r);
const source = "Source: nested repeated cross-validation, onlinefoods.csv";

// ---------------------------------------------------------------- A. Live training

type Lane = { aucs: number[]; of: number; params: Record<string, string | number> | null; status: "saved" | "waiting" | "running" | "done" };

function savedLanes(d: ModelsData): Record<string, Lane> {
  return Object.fromEntries(ORDER.map((m) => {
    const per = d.cv_results[m]?.best_params_per_fold;
    return [m, { aucs: d.fold_auc[m] ?? [], of: d.fold_auc[m]?.length ?? 0, params: per ? per[per.length - 1] : null, status: "saved" }];
  }));
}

function LaneChart({ lane, model }: { lane: Lane; model: string }) {
  const mean = lane.aucs.map((_, i) => lane.aucs.slice(0, i + 1).reduce((s, v) => s + v, 0) / (i + 1));
  return (
    <Chart height={64} notMerge={lane.status === "saved"}
      table={{ columns: ["Fold", "ROC-AUC", "Running mean"], rows: lane.aucs.map((a, i) => [i + 1, a.toFixed(3), mean[i].toFixed(3)]) }}
      option={{
        animation: lane.status !== "saved",
        grid: { left: 4, right: 8, top: 6, bottom: 4, containLabel: true },
        tooltip: { trigger: "item", formatter: (p: any) => `Fold ${p.value[0]} of ${lane.of}<br/>ROC-AUC ${Number(p.value[1]).toFixed(3)}` },
        xAxis: { type: "value", min: 0.5, max: Math.max(lane.of, 1) + 0.5, show: false },
        yAxis: { type: "value", min: 0.4, max: 1, interval: 0.3, axisLabel: { fontSize: 12, formatter: (v: number) => v.toFixed(1) } },
        series: [
          { type: "line", data: mean.map((v, i) => [i + 1, v]), symbol: "none", lineStyle: { color: ALGO_COLOR[model], width: 1.5, opacity: 0.6 }, silent: true, tooltip: { show: false } },
          { type: "scatter", data: lane.aucs.map((v, i) => [i + 1, v]), symbolSize: 7, itemStyle: { color: ALGO_COLOR[model] } },
        ],
      }} />
  );
}

function LiveTraining({ data, onDone }: { data: ModelsData; onDone: () => void }) {
  const [lanes, setLanes] = useState<Record<string, Lane>>(() => savedLanes(data));
  const [selected, setSelected] = useState<string[]>(ORDER);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ default_model: string; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const es = useRef<EventSource | null>(null);
  useEffect(() => () => es.current?.close(), []);

  const start = async () => {
    setError(null); setResult(null);
    try {
      const { job } = await api.train(selected);
      setRunning(true);
      setLanes((l) => ({ ...l, ...Object.fromEntries(selected.map((m) => [m, { aucs: [], of: 0, params: null, status: "waiting" as const }])) }));
      const src = new EventSource(api.trainEventsUrl(job));
      es.current = src;
      src.addEventListener("fold", (e) => {
        const ev: FoldEvent = JSON.parse((e as MessageEvent).data);
        setLanes((l) => ({ ...l, [ev.model]: { aucs: [...l[ev.model].aucs, ev.scores.roc_auc], of: ev.of, params: ev.params, status: "running" } }));
      });
      src.addEventListener("model_done", (e) => {
        const { model } = JSON.parse((e as MessageEvent).data);
        setLanes((l) => ({ ...l, [model]: { ...l[model], status: "done" } }));
      });
      src.addEventListener("done", (e) => {
        setResult(JSON.parse((e as MessageEvent).data));
        src.close(); setRunning(false); onDone();
      });
      src.addEventListener("error", (e) => {
        const msg = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data).message : "Connection to the training stream was lost";
        setError(msg); src.close(); setRunning(false);
      });
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Card span={12} title="Live training" subtitle="How does each algorithm score on folds it never saw while training?"
      note={`ROC-AUC per outer fold, y-axis 0.4–1.0 · retraining uses fast mode (2 × 5 folds, 8 search draws) · ${source}`}
      tableToggle
      actions={
        <div className="flex flex-wrap items-center gap-3">
          {ORDER.map((m) => (
            <label key={m} className="flex items-center gap-1 text-cap text-ink-2">
              <input type="checkbox" className="accent-accent" disabled={running} checked={selected.includes(m)}
                onChange={() => setSelected(selected.includes(m) ? selected.filter((x) => x !== m) : [...selected, m])} />
              {ALGO_NAME[m]}
            </label>
          ))}
          <button onClick={start} disabled={running || selected.length === 0}
            className="clay clay-pink rounded-full px-4 py-1 text-cap font-semibold disabled:opacity-50">
            {running ? "Training…" : "Retrain (fast mode)"}
          </button>
        </div>
      }>
      <div className="divide-y divide-line">
        {ORDER.map((m) => {
          const l = lanes[m];
          const mean = l.aucs.length ? l.aucs.reduce((s, v) => s + v, 0) / l.aucs.length : null;
          return (
            <div key={m} className="grid grid-cols-12 items-center gap-3 py-2">
              <div className="col-span-12 md:col-span-4">
                <div>
                  <p className="text-card" style={{ color: ALGO_COLOR[m] }}>{ALGO_NAME[m]}</p>
                  <span className="text-cap text-ink-2">
                    {l.status === "waiting" ? "waiting" : `fold ${l.aucs.length}/${l.of}`}
                    {mean != null && <> · mean <span className="text-ink">{mean.toFixed(3)}</span></>}
                  </span>
                </div>
                <p className="truncate font-mono text-cap text-ink-2" title={fmtParams(l.params)}>{l.status === "waiting" ? "" : fmtParams(l.params) || "no hyperparameters"}</p>
              </div>
              <div className="col-span-12 md:col-span-8">{l.status === "waiting" ? <div className="h-16" /> : <LaneChart lane={l} model={m} />}</div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-cap text-ink-2">Each dot is one held-out fold: the model never saw these respondents while training.</p>
      {error && <div className="mt-2"><ErrorState message={error} /></div>}
      {result && (
        <p className="glass-inset mt-3 px-4 py-3 text-body text-ink">
          Default model: <b>{ALGO_NAME[result.default_model]}</b> — {prettyReason(result.reason)}.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- B–F

const best = (cv: Record<string, Summary>, m: Metric) => {
  const vals = ORDER.filter((x) => cv[x]).map((x) => [x, cv[x][m].mean] as const);
  return (m === "brier" ? vals.sort((a, b) => a[1] - b[1]) : vals.sort((a, b) => b[1] - a[1]))[0]?.[0];
};
const cell = (i: { mean: number; ci_low: number; ci_high: number }) =>
  `${i.mean.toFixed(3)} [${i.ci_low.toFixed(2)}–${i.ci_high.toFixed(2)}]`;

const mono = { fontFamily: "JetBrains Mono, monospace", fontSize: 12 };

function curveOption(d: ModelsData, kind: "roc" | "pr" | "cal"): any {
  const series: any[] = ALGOS.map((m) => {
    const o = d.oof[m];
    const pts = kind === "roc" ? o.roc.map((p) => [p.fpr, p.tpr])
      : kind === "pr" ? o.pr.map((p) => [p.recall, p.precision])
        : o.calibration.map((p) => [p.predicted, p.observed]);
    return {
      type: "line", name: ALGO_NAME[m], data: pts, showSymbol: kind === "cal", symbolSize: 5,
      step: kind === "roc" ? "end" : kind === "pr" ? "start" : undefined,
      lineStyle: { color: ALGO_COLOR[m], width: 1.5 }, itemStyle: { color: ALGO_COLOR[m] },
    };
  });
  const prev = d.oof[ALGOS[0]].prevalence;
  series.push({
    type: "line", name: kind === "pr" ? "Prevalence" : kind === "roc" ? "Chance" : "Perfect calibration", silent: true,
    data: kind === "pr" ? [[0, prev], [1, prev]] : [[0, 0], [1, 1]], symbol: "none",
    lineStyle: { type: "dashed", color: tokens.ink3, width: 1 }, itemStyle: { color: tokens.ink3 }, tooltip: { show: false },
  });
  const [xn, yn] = kind === "roc" ? ["False positive rate", "True positive rate"] : kind === "pr" ? ["Recall", "Precision"] : ["Mean predicted", "Observed Yes rate"];
  return {
    legend: { top: 0, left: 0, data: ALGOS.map((m) => ALGO_NAME[m]), itemGap: 8 },
    grid: { left: 8, right: 16, top: 52, bottom: 24, containLabel: true },
    tooltip: { trigger: "item", formatter: (p: any) => `${p.seriesName}<br/>${xn} ${Number(p.value[0]).toFixed(2)} · ${yn} ${Number(p.value[1]).toFixed(2)}` },
    xAxis: { type: "value", min: 0, max: 1, name: xn, nameLocation: "middle", nameGap: 24 },
    yAxis: { type: "value", min: kind === "pr" ? Math.floor(prev * 10) / 10 - 0.1 : 0, max: 1, name: yn, nameLocation: "middle", nameGap: 36 },
    series,
  };
}

function curveTable(d: ModelsData, kind: "roc" | "pr" | "cal") {
  if (kind === "cal") return {
    columns: ["Model", "Mean predicted", "Observed", "n"],
    rows: ALGOS.flatMap((m) => d.oof[m].calibration.map((c) => [ALGO_NAME[m], c.predicted.toFixed(3), c.observed.toFixed(3), c.n])),
  };
  return {
    columns: ["Model", kind === "roc" ? "AUC (out-of-fold)" : "Average precision", kind === "roc" ? "Points" : "Points"],
    rows: ALGOS.map((m) => [ALGO_NAME[m], (kind === "roc" ? d.oof[m].roc_auc : d.oof[m].pr_auc).toFixed(3),
      (kind === "roc" ? d.oof[m].roc : d.oof[m].pr).map((p: any) => `(${Object.values(p).map((v: any) => v.toFixed(2)).join(", ")})`).join(" ")]),
  };
}

function ConfusionMatrices({ d }: { d: ModelsData }) {
  const [t, setT] = useState(0.5);
  return (
    <Card span={12} title="Confusion matrices" subtitle="How many respondents does each model get right at a given threshold?"
      note={`Out-of-fold predictions (5-fold, seed 42) · n = ${Object.values(d.oof[ALGOS[0]].confusion).slice(1).reduce((s: number, v) => s + (v as number), 0)} · cells show count and row %`}
      actions={
        <label className="flex items-center gap-2 text-cap text-ink-2">Threshold
          <input type="range" className="single w-40" min={0.05} max={0.95} step={0.05} value={t} onChange={(e) => setT(Number(e.target.value))} />
          <span className="w-8 text-ink">{t.toFixed(2)}</span>
        </label>
      }>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ALGOS.map((m) => {
          const c = d.oof[m].confusion_by_threshold.find((x) => Math.abs(x.threshold - t) < 1e-6)!;
          const rows = [["No", c.tn, c.fp], ["Yes", c.fn, c.tp]] as const;
          return (
            <div key={m}>
              <p className="mb-1 text-card" style={{ color: ALGO_COLOR[m] }}>{ALGO_NAME[m]}</p>
              <table className="w-full border-collapse text-cap">
                <thead><tr><th className="p-1 text-left text-ink-3">Actual ↓ / Predicted →</th><th className="p-1 text-ink-2">No</th><th className="p-1 text-ink-2">Yes</th></tr></thead>
                <tbody>
                  {rows.map(([lab, a, b], ri) => {
                    const n = a + b;
                    return (
                      <tr key={lab}>
                        <th className="p-1 text-left font-normal text-ink-2">{lab}</th>
                        {[a, b].map((v, ci) => (
                          <td key={ci} className={`border border-white/10 p-2 text-center ${ri === ci ? "bg-white/10" : ""}`}>
                            <span className="text-body font-semibold text-ink">{v}</span>
                            <span className="block text-ink-2">{n ? `${((v / n) * 100).toFixed(0)}%` : "—"}</span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const EXPLAIN: Record<string, string> = {
  logistic_regression: "Gives every feature a weight and adds them up into a score, then squeezes the score into a probability between 0 and 1. Positive weights push towards Yes, negative towards No.",
  random_forest: "Grows hundreds of small decision trees, each on a random slice of the data and features. The final answer is the share of trees that vote Yes.",
  xgboost: "Builds trees one after another, where each new tree corrects the mistakes of the ones before it. The final answer is the sum of all those small corrections.",
};

function ExplainCard({ d, m }: { d: ModelsData; m: string }) {
  const e = d.explanations[m];
  const isLr = m === "logistic_regression";
  const entries = Object.entries(isLr ? e.coefficients! : e.mean_abs_shap)
    .sort((a, b) => (isLr ? Math.abs(a[1]) - Math.abs(b[1]) : a[1] - b[1]));
  const label = isLr ? "Coefficient (log-odds)" : "Mean |SHAP|";
  return (
    <Card span={4} title={ALGO_NAME[m]} subtitle={`How does ${ALGO_NAME[m]} reach an answer, and which features matter most?`} tableToggle
      note={isLr
        ? "Reference encoding: Age and Family size are standardised (per 1 SD); income and education are ordinal codes (per level step); one-hot categories have no dropped level, so each weight compares that category with all others."
        : "Mean absolute SHAP value over all respondents (average size of the change in model output, in log-odds for XGBoost, probability for RF)."}>
      <p className="mb-3 max-w-prose text-body text-ink-2">{EXPLAIN[m]}</p>
      <Chart height={Math.max(240, entries.length * 30 + 40)}
        table={{ columns: ["Feature", label], rows: [...entries].reverse().map(([f, v]) => [<span className="font-mono">{f}</span>, v.toFixed(4)]) }}
        option={{
          grid: { left: 8, right: 24, top: 8, bottom: 8, containLabel: true },
          tooltip: { trigger: "item", formatter: (p: any) => `${p.name}<br/>${label} ${Number(p.value).toFixed(4)}` },
          xAxis: { type: "value", splitNumber: 3, axisLabel: { formatter: (v: number) => v.toFixed(2) } },
          // Feature codes sit above their bar so long names do not squeeze the plot.
          yAxis: {
            type: "category", data: entries.map(([f]) => f), axisLine: { show: false },
            axisLabel: { ...mono, color: tokens.ink2, inside: true, verticalAlign: "bottom", padding: [0, 0, 7, 0] },
          },
          series: [{
            type: "bar", barMaxWidth: 8,
            data: entries.map(([, v]) => ({ value: v, itemStyle: { color: isLr && v < 0 ? tokens.neutralBar : ALGO_COLOR[m] } })),
          }],
        }} />
    </Card>
  );
}

export default function Models() {
  const q = useApi(api.models, "models");
  const [metric, setMetric] = useState<Metric>("roc_auc");
  const { hash } = useLocation();
  // /predictor redirects here with #predictor; scroll once the section exists.
  useEffect(() => {
    if (q.data && hash === "#predictor") document.getElementById("predictor")?.scrollIntoView();
  }, [q.data, hash]);
  const title = "Models & Predictor";
  const question = "Which algorithm predicts best, how sure are we, and what does it say for one profile?";
  if (q.error) return <Page title={title} question={question}><div className="col-span-12"><ErrorState message={q.error} /></div></Page>;
  const d = q.data;
  const mlabel = METRICS.find(([k]) => k === metric)![1];

  return (
    <Page title={title} question={question}>
      {!d ? <div className="col-span-12"><Loading /></div> : (
        <>
          {d.leak_suspects.length > 0 && (
            <p className="col-span-12 rounded border border-warn bg-warn/[0.12] px-4 py-2 text-body text-ink" role="alert">
              Possible target leakage: {d.leak_suspects.join(", ")} alone predicts Output almost perfectly. Treat these scores with caution.
            </p>
          )}
          <LiveTraining data={d} onDone={q.reload} />

          <Card span={8} title="Scoreboard" subtitle="How does each model score across seven metrics?"
            note={`Mean [95% interval] over ${d.cv_results[ALGOS[0]].n_outer_folds} outer folds · best mean per column in bold (lowest for Brier) · default: ${ALGO_NAME[d.default_model]} — ${prettyReason(d.default_reason)}`}
            actions={
              <label className="flex items-center gap-2 text-cap text-ink-2">Metric
                <select className="glass-inset rounded-full px-2 py-0.5 text-cap text-ink" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
                  {METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
            }>
            <DataTable columns={["Model", ...METRICS.map(([, l]) => l)]}
              rows={ORDER.filter((m) => d.cv_results[m]).map((m) => [
                <span style={{ color: ALGO_COLOR[m] }} className="font-semibold">{ALGO_NAME[m]}</span>,
                ...METRICS.map(([k]) => (
                  <span className={`whitespace-nowrap ${best(d.cv_results, k) === m ? "font-semibold" : ""} ${k === metric ? "text-ink" : "text-ink-2"}`}>
                    {cell(d.cv_results[m][k])}
                  </span>
                )),
              ])} />
          </Card>

          <Card span={4} title={`${mlabel} interval`} subtitle="Do the models' intervals overlap?" tableToggle
            note={`Dot = mean, whisker = 2.5–97.5th percentile across folds · ${source}`}>
            {(() => {
              const ms = ORDER.filter((m) => d.cv_results[m]).reverse();
              return (
                <Chart height={220}
                  table={{ columns: ["Model", "Mean", "Low", "High"], rows: ms.slice().reverse().map((m) => [ALGO_NAME[m], num(d.cv_results[m][metric].mean), num(d.cv_results[m][metric].ci_low), num(d.cv_results[m][metric].ci_high)]) }}
                  option={{
                    grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
                    tooltip: { trigger: "item", formatter: (p: any) => { const i = d.cv_results[ms[p.dataIndex]][metric]; return `${ALGO_NAME[ms[p.dataIndex]]}<br/>${mlabel} ${cell(i)}`; } },
                    xAxis: {
                      type: "value", splitNumber: 2, axisLabel: { formatter: (v: number) => v.toFixed(1) },
                      min: (v: any) => Math.max(0, Math.floor(v.min * 10) / 10), max: (v: any) => Math.min(1, Math.ceil(v.max * 10) / 10),
                    },
                    yAxis: { type: "category", data: ms.map((m) => ALGO_NAME[m]) },
                    series: [
                      whiskerSeries(ms.map((m, i) => [i, d.cv_results[m][metric].ci_low, d.cv_results[m][metric].ci_high]), true),
                      { type: "scatter", symbolSize: 10, z: 4, data: ms.map((m) => ({ value: [d.cv_results[m][metric].mean, ALGO_NAME[m]], itemStyle: { color: ALGO_COLOR[m] } })) },
                    ],
                  }} />
              );
            })()}
          </Card>

          <Card span={4} title="ROC curves" subtitle="How well does each model rank Yes above No?" tableToggle
            note="Out-of-fold predictions (5-fold, seed 42) · dashed = chance">
            <Chart height={300} option={curveOption(d, "roc")} table={curveTable(d, "roc")} />
          </Card>
          <Card span={4} title="Precision–recall curves" subtitle="How precise are Yes predictions at each recall level?" tableToggle
            note={`Out-of-fold predictions · dashed = prevalence ${(d.oof[ALGOS[0]].prevalence * 100).toFixed(1)}%`}>
            <Chart height={300} option={curveOption(d, "pr")} table={curveTable(d, "pr")} />
          </Card>
          <Card span={4} title="Calibration" subtitle="Do predicted probabilities match observed Yes rates?" tableToggle
            note="Out-of-fold predictions, 10 equal-width bins · dashed = perfect calibration">
            <Chart height={300} option={curveOption(d, "cal")} table={curveTable(d, "cal")} />
          </Card>

          <ConfusionMatrices d={d} />

          {ALGOS.map((m) => <ExplainCard key={m} d={d} m={m} />)}

          <PredictorPanel />
        </>
      )}
    </Page>
  );
}
