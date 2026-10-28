import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, pct, useApi, type Report as ReportData } from "../api";
import { Card } from "../components/Card";
import { Chart, DataTable, rateBarsOption, rateTable, whiskerSeries } from "../components/Chart";
import { ErrorState, Loading } from "../components/States";
import { ATTRIBUTE_LABEL } from "../filters";
import { ALGO_COLOR, ALGO_NAME, tokens } from "../theme";

const ATTRS = ["age", "family", "gender", "marital", "occupation", "income", "education"];
const MODELS = ["random_forest", "xgboost", "logistic_regression", "majority_baseline"];
const METRICS: [string, string, string][] = [
  ["roc_auc", "ROC-AUC", "How well the model ranks a Yes person above a No person. 0.5 = coin flip, 1.0 = perfect."],
  ["pr_auc", "PR-AUC", "Average precision across all thresholds; the baseline equals the share of Yes (about 0.76)."],
  ["accuracy", "Accuracy", "Share of people predicted correctly at a 0.5 threshold."],
  ["precision", "Precision", "Of the people the model says Yes for, how many really said Yes."],
  ["recall", "Recall", "Of the people who really said Yes, how many the model found."],
  ["f1", "F1", "One number balancing precision and recall."],
  ["brier", "Brier", "Average squared error of the probabilities; lower is better."],
];
const fmtP = (p: number | null) => (p == null ? "—" : p < 0.001 ? "< 0.001" : p.toFixed(3));
const holmText = (p: number | null) => (p != null && p < 0.001 ? "Holm p < 0.001" : `Holm p = ${fmtP(p)}`);
const name = (m: string) => ALGO_NAME[m] ?? m;

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="col-span-12 mt-6 flex items-baseline gap-3 border-b border-line pb-2">
      <span className={`clay clay-${["violet", "pink", "teal", "amber", "sky"][(n - 1) % 5]} grid h-9 w-9 shrink-0 place-items-center !rounded-full text-card`}>{n}</span>
      <h2 className="text-title text-ink">{title}</h2>
      {children}
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-prose space-y-2 text-body leading-6 text-ink-2">{children}</div>;
}

function Steps({ r }: { r: ReportData }) {
  const log = r.clean_log;
  const steps: [string, string][] = [
    ["Collect", `Kaggle "Online Food Ordering" survey: ${r.rows_raw} people in Bangalore, 14 columns.`],
    ["Clean", `Removed ${log.exact_duplicates} exact duplicate rows and an unnamed column that copied the answer (${pct(log.unnamed_vs_output_agreement ?? null)} agreement). ${log.clean_rows} respondents remain; no missing values.`],
    ["Explore", "Compared the Yes rate across 7 attributes with 95% intervals, and tested each one statistically."],
    ["Model", "Trained Logistic Regression, Random Forest and XGBoost on 7 inputs, scored on people they never saw (nested cross-validation)."],
    ["Explain", "Used SHAP values and step-by-step walkthroughs to show why each model gives its answer."],
  ];
  return (
    <div className="col-span-12 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
      {steps.map(([t, d], i) => (
        <div key={t} className="card-rise card-lift glass p-4">
          <p className="text-gradient text-cap font-semibold">Step {i + 1}</p>
          <p className="text-card text-ink">{t}</p>
          <p className="mt-1 text-cap leading-5 text-ink-2">{d}</p>
        </div>
      ))}
    </div>
  );
}

function DataFindings({ r }: { r: ReportData }) {
  const [attr, setAttr] = useState("occupation");
  const rows = r.groups[attr];
  const big = rows.filter((g) => !g.small);
  const hi = big.length ? big.reduce((a, b) => (b.rate > a.rate ? b : a)) : null;
  const lo = big.length ? big.reduce((a, b) => (b.rate < a.rate ? b : a)) : null;
  const sig = ATTRS.filter((a) => (r.tests[a].p_holm ?? 1) < 0.05);
  return (
    <>
      <Card cols="col-span-12 xl:col-span-7" title="Yes rate by group" subtitle="Pick an attribute: which of its groups say Yes most and least?"
        tableToggle note={`Bars = Yes rate, whiskers = Wilson 95% interval, grey = fewer than 10 people · n = ${r.overall.n}`}
        actions={
          <div className="flex flex-wrap gap-1">
            {ATTRS.map((a) => (
              <button key={a} onClick={() => setAttr(a)} aria-pressed={attr === a}
                className={`rounded-full px-2.5 py-0.5 text-cap ${attr === a ? "clay clay-violet rounded-full" : "glass-inset text-ink-2"}`}>
                {ATTRIBUTE_LABEL[a]}
              </button>
            ))}
          </div>
        }>
        <Chart height={Math.max(220, rows.length * 44)} option={rateBarsOption(rows)} table={rateTable(rows)} />
        {hi && lo && (
          <p className="mt-3 max-w-prose text-body text-ink">
            <b>{hi.level}</b> has the highest Yes rate ({pct(hi.rate)}, n = {hi.n}) and <b>{lo.level}</b> the lowest
            ({pct(lo.rate)}, n = {lo.n}). {(r.tests[attr].p_holm ?? 1) < 0.05
              ? `This difference is statistically significant (${holmText(r.tests[attr].p_holm)}).`
              : `This difference could be chance (${holmText(r.tests[attr].p_holm)}).`}
          </p>
        )}
      </Card>
      <Card cols="col-span-12 xl:col-span-5" title="Is each attribute linked to saying Yes?" subtitle="Statistical test for every attribute, corrected for testing 7 at once."
        note="Chi-square test, or Fisher's exact test when groups are small. Holm p < 0.05 = significant association (not proof of cause).">
        <DataTable columns={["Attribute", "Holm p", "Verdict"]} maxHeight={420}
          rows={ATTRS.map((a) => {
            const t = r.tests[a];
            const yes = (t.p_holm ?? 1) < 0.05;
            return [ATTRIBUTE_LABEL[a], fmtP(t.p_holm),
              <span className={`rounded-sm border px-1.5 ${yes ? "border-good text-good" : "border-line text-ink-2"}`}>{yes ? "Associated" : "No clear link"}</span>];
          })} />
        <p className="mt-3 text-body text-ink">
          <b>{sig.length} of 7</b> attributes are associated with the answer: {sig.map((a) => ATTRIBUTE_LABEL[a]).join(", ") || "none"}.
        </p>
      </Card>
    </>
  );
}

function ModelResults({ r }: { r: ReportData }) {
  const ms = MODELS.filter((m) => r.cv_results[m]);
  const best = ms.filter((m) => m !== "majority_baseline").reduce((a, b) => (r.cv_results[b].roc_auc.mean > r.cv_results[a].roc_auc.mean ? b : a));
  const folds = r.cv_results[best].n_outer_folds;
  const rev = [...ms].reverse();
  return (
    <>
      <Card cols="col-span-12 xl:col-span-5" title="ROC-AUC with 95% interval" subtitle="How well does each model separate Yes from No on unseen people?" tableToggle
        note={`Dot = mean over ${folds} held-out folds, whisker = middle 95% of folds · dashed line = coin flip (0.5)`}>
        <Chart height={240}
          table={{ columns: ["Model", "Mean", "Low", "High"], rows: ms.map((m) => [name(m), r.cv_results[m].roc_auc.mean.toFixed(3), r.cv_results[m].roc_auc.ci_low.toFixed(3), r.cv_results[m].roc_auc.ci_high.toFixed(3)]) }}
          option={{
            grid: { left: 8, right: 16, top: 8, bottom: 8, containLabel: true },
            tooltip: { trigger: "item", formatter: (p: any) => { const m = rev[p.dataIndex]; const a = r.cv_results[m].roc_auc; return `${name(m)}<br/>ROC-AUC ${a.mean.toFixed(3)} [${a.ci_low.toFixed(2)}–${a.ci_high.toFixed(2)}]`; } },
            xAxis: { type: "value", min: 0.4, max: 0.9, splitNumber: 5 },
            yAxis: { type: "category", data: rev.map(name) },
            series: [
              whiskerSeries(rev.map((m, i) => [i, r.cv_results[m].roc_auc.ci_low, r.cv_results[m].roc_auc.ci_high]), true),
              { type: "scatter", symbolSize: 12, z: 4, data: rev.map((m) => ({ value: [r.cv_results[m].roc_auc.mean, name(m)], itemStyle: { color: ALGO_COLOR[m] } })),
                markLine: { symbol: "none", silent: true, lineStyle: { type: "dashed", color: tokens.ink3 }, label: { show: false }, data: [{ xAxis: 0.5 }] } },
            ],
          }} />
        <p className="mt-3 max-w-prose text-body text-ink">
          <b>{name(best)}</b> scores highest ({r.cv_results[best].roc_auc.mean.toFixed(3)}), clearly above the do-nothing baseline (0.500).
          The intervals of the three models overlap, so the app uses the simpler <b>{name(r.default_model)}</b> as its default.
        </p>
      </Card>
      <Card cols="col-span-12 xl:col-span-7" title="All seven metrics" subtitle="Mean [95% interval] over the held-out folds, best in bold."
        note="Accuracy, precision, recall and F1 use a 0.5 probability threshold. The baseline always predicts Yes, which is why its recall is 1.0.">
        <DataTable maxHeight={9999} columns={["Metric", ...ms.map(name)]}
          rows={METRICS.map(([k, label, means]) => {
            const vals = ms.map((m) => (r.cv_results[m] as any)[k].mean as number);
            const bestV = k === "brier" ? Math.min(...vals) : Math.max(...vals);
            return [<div className="min-w-[160px]"><b>{label}</b><p className="text-ink-3">{means}</p></div>, ...ms.map((m, i) => {
              const a = (r.cv_results[m] as any)[k];
              return <span className={vals[i] === bestV ? "font-semibold text-ink" : "text-ink-2"}>{a.mean.toFixed(3)}<br /><span className="text-ink-3">[{a.ci_low.toFixed(2)}–{a.ci_high.toFixed(2)}]</span></span>;
            })];
          })} />
      </Card>
    </>
  );
}

function Factors({ r }: { r: ReportData }) {
  const ms = ["random_forest", "xgboost", "logistic_regression"].filter((m) => r.models[m]);
  return (
    <>
      {ms.map((m) => {
        const f = [...r.models[m].top_features].reverse();
        return (
          <Card key={m} cols="col-span-12 md:col-span-6 xl:col-span-4" title={name(m)} subtitle="Which inputs move this model's answer the most?" tableToggle
            note="Mean absolute SHAP value: the average size of each input's push on the prediction.">
            <Chart height={220} table={{ columns: ["Feature", "Mean |SHAP|"], rows: r.models[m].top_features.map(([k, v]) => [k, v.toFixed(4)]) }}
              option={{
                grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: false },
                xAxis: { type: "value", show: false },
                yAxis: { type: "category", data: f.map(([k]) => k), axisLine: { show: false },
                  axisLabel: { inside: true, verticalAlign: "bottom", padding: [0, 0, 9, 0], color: tokens.ink2, fontFamily: "JetBrains Mono, monospace" } },
                tooltip: { trigger: "item", formatter: (p: any) => `${p.name}<br/>Mean |SHAP| ${Number(p.value).toFixed(4)}` },
                series: [{ type: "bar", barWidth: 10, data: f.map(([, v]) => v), itemStyle: { color: ALGO_COLOR[m], borderRadius: 3 },
                  label: { show: true, position: "right", color: tokens.ink, formatter: (p: any) => Number(p.value).toFixed(3) } }],
              }} />
            <p className="mt-2 text-body text-ink">Most important: <b>{r.models[m].top_features[0]?.[0]}</b>, then {r.models[m].top_features.slice(1, 3).map(([k]) => k).join(" and ")}.</p>
          </Card>
        );
      })}
    </>
  );
}

function Confusions({ r }: { r: ReportData }) {
  const ms = ["random_forest", "xgboost", "logistic_regression"].filter((m) => r.models[m]);
  return (
    <Card cols="col-span-12" title="How many people does each model get right?" subtitle="Out-of-fold predictions at a 0.5 threshold: every person is predicted by a model that never saw them."
      note="Rows = what the person actually answered; columns = what the model predicted.">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {ms.map((m) => {
          const c = r.models[m].confusion;
          const yes = c.tp + c.fn, no = c.tn + c.fp;
          return (
            <div key={m}>
              <p className="mb-2 text-card" style={{ color: ALGO_COLOR[m] }}>{name(m)}</p>
              <table className="w-full border-collapse text-cap">
                <thead><tr><th className="p-1 text-left text-ink-3">Actual ↓ / Predicted →</th><th className="p-1 text-ink-2">No</th><th className="p-1 text-ink-2">Yes</th></tr></thead>
                <tbody>
                  {([["No", c.tn, c.fp], ["Yes", c.fn, c.tp]] as const).map(([lab, a, b], ri) => (
                    <tr key={lab}>
                      <th className="p-1 text-left font-normal text-ink-2">{lab}</th>
                      {[a, b].map((v, ci) => (
                        <td key={ci} className={`border border-white/10 p-2 text-center text-body font-semibold ${ri === ci ? "bg-white/10 text-ink" : "text-ink-2"}`}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-body text-ink-2">
                Finds <b className="text-ink">{c.tp} of {yes}</b> Yes people ({pct(c.tp / yes, 0)}) and <b className="text-ink">{c.tn} of {no}</b> No people ({pct(c.tn / no, 0)}).
              </p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export default function Report() {
  const q = useApi(api.report, "report");
  const r = q.data;
  if (q.error) return <ErrorState message={q.error} />;
  if (!r) return <Loading />;
  const best = ["random_forest", "xgboost", "logistic_regression"].reduce((a, b) => (r.cv_results[b].roc_auc.mean > r.cv_results[a].roc_auc.mean ? b : a));
  const sig = ATTRS.filter((a) => (r.tests[a].p_holm ?? 1) < 0.05).map((a) => ATTRIBUTE_LABEL[a].toLowerCase());

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="card-rise glass col-span-12 p-6">
        <p className="text-cap uppercase tracking-wider text-sky">Project report</p>
        <h1 className="text-gradient mt-1 text-kpi">Who orders food online, and can a model predict it?</h1>
        <div className="mt-3 max-w-prose space-y-2 text-body leading-6 text-ink-2">
          <p>
            This project analyses a Kaggle survey of <b className="text-ink">{r.rows_raw} people in Bangalore</b> about ordering food online.
            After cleaning, <b className="text-ink">{r.overall.n} respondents</b> remain, and <b className="text-ink">{pct(r.overall.rate)}</b> of them
            answered <b className="text-ink">Yes</b> ({r.overall.yes} people).
          </p>
          <p>
            The answer is significantly associated with <b className="text-ink">{sig.join(", ")}</b>. Three machine-learning models were trained to predict it
            from 7 personal details; the best, <b className="text-ink">{name(best)}</b>, reaches a ROC-AUC of <b className="text-ink">{r.cv_results[best].roc_auc.mean.toFixed(3)}</b>
            {" "}(0.5 would be guessing). The prediction is useful but far from perfect, which is expected from {r.overall.n} survey answers.
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-cap">
          <Link to="/" className="clay clay-violet !rounded-full px-4 py-1.5 font-semibold">Interactive dashboard</Link>
          <Link to="/models" className="clay clay-teal !rounded-full px-4 py-1.5 font-semibold">Models & Predictor</Link>
          <a href="#powerbi" className="clay clay-amber !rounded-full px-4 py-1.5 font-semibold">Power BI dashboard ↓</a>
        </div>
      </div>

      <Section n={1} title="How the project works"><span /></Section>
      <Steps r={r} />

      <Section n={2} title="What the data shows"><span /></Section>
      <DataFindings r={r} />

      <Section n={3} title="Model results"><span /></Section>
      <div className="col-span-12"><Prose>
        <p>Each model was trained on 7 inputs: {r.features.join(", ")}. Feedback, location and the answer itself were kept out, so no model can cheat.</p>
        <p>Scores come from <b className="text-ink">nested cross-validation</b>: the data is split into 5 parts, each model is trained on 4 and tested on the 5th,
          and this is repeated 10 times with different splits, giving {r.cv_results[best].n_outer_folds} honest test scores per model. Settings
          (like tree depth) are tuned inside each training part only.</p>
      </Prose></div>
      <ModelResults r={r} />

      <Section n={4} title="Which factors matter most"><span /></Section>
      <Factors r={r} />

      <Section n={5} title="How many predictions are right"><span /></Section>
      <Confusions r={r} />

      <Section n={6} title="Limitations"><span /></Section>
      <div className="col-span-12"><Prose>
        <p>• <b className="text-ink">Small sample:</b> {r.overall.n} people from one city, mostly young and many of them students, so results may not generalise.</p>
        <p>• <b className="text-ink">Association, not cause:</b> a group with a higher Yes rate is not shown to say Yes <i>because</i> of that trait.</p>
        <p>• <b className="text-ink">Imbalanced answer:</b> {pct(r.overall.rate)} said Yes, so models were trained with class weights and judged by ROC-AUC rather than accuracy.</p>
        <p>• <b className="text-ink">Predictions are estimates</b> from survey answers, not forecasts for any real person.</p>
      </Prose></div>

      <Section n={7} title="Power BI dashboard"><span /></Section>
      <Card cols="col-span-12" id="powerbi" title="Open the Power BI version" subtitle="The same data and model results as a Power BI report with five pages."
        note="Tables are exported by powerbi/export_data.py; the report is generated by powerbi/build_pbip.py.">
        <Prose>
          <p>Open this file in <b className="text-ink">Power BI Desktop</b>, then press <b className="text-ink">Refresh</b> on the Home tab to load the data:</p>
        </Prose>
        <p className="glass-inset my-3 break-all px-3 py-2 font-mono text-cap text-amber">{r.powerbi_path}</p>
        <DataTable columns={["Page", "What it shows"]} rows={[
          ["1. Dataset overview", "Slicers (gender, occupation, customer type, income), KPI cards, Yes/No split, occupation, income, marital status, age bands"],
          ["2. Who says Yes", "Yes rate by occupation, marital status, education and family size, plus the 7 association tests"],
          ["3. Geography", "Pin codes on a latitude/longitude grid sized by respondents, with a pin-code table"],
          ["4. Model results", "ROC-AUC by model, all metrics, fold-by-fold scores, feature importance, confusion matrices"],
          ["5. Data dictionary", "Every column with its type, role, missing values and levels, plus the cleaning steps"],
        ]} />
      </Card>
    </div>
  );
}
