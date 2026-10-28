import { useState } from "react";
import { ApiError, api, pct, type LrWalk, type Prediction, type RfWalk, type XgbWalk } from "../api";
import { Card } from "../components/Card";
import { Chart } from "../components/Chart";
import { ErrorState } from "../components/States";
import { useFilters } from "../filters";
import { ALGO_COLOR, ALGO_NAME, ALGO_SHORT, tokens } from "../theme";

type Profile = Record<string, string | number>;
const ALGOS = ["logistic_regression", "random_forest", "xgboost"];
const mono = { fontFamily: "JetBrains Mono, monospace", fontSize: 12 };
const f3 = (v: number) => (v >= 0 ? "+" : "−") + Math.abs(v).toFixed(3);

// ---------------------------------------------------------------- form

function ProfileForm({ profile, base, onChange }: { profile: Profile; base?: Profile; onChange: (p: Profile) => void }) {
  const { meta } = useFilters();
  const m = meta!;
  return (
    <div className="space-y-3">
      {m.features.map((f) => {
        const changed = base && base[f] !== profile[f];
        const cls = `mt-1 w-full rounded border px-2 py-1 text-body text-ink ${changed ? "border-pink bg-pink/15" : "border-white/10 bg-white/5"}`;
        const range = m.numeric_ranges[f];
        return (
          <label key={f} className="block text-cap text-ink-2">
            {f}{changed && <span className="ml-1 text-accent">· changed</span>}
            {range ? (
              <input type="number" className={cls} min={range[0]} max={range[1]} step={1} value={profile[f]}
                onChange={(e) => onChange({ ...profile, [f]: e.target.value === "" ? "" : Number(e.target.value) })} />
            ) : (
              <select className={cls} value={profile[f]} onChange={(e) => onChange({ ...profile, [f]: e.target.value })}>
                {m.levels[f].map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
            {range && <span className="text-ink-3">allowed {range[0]}–{range[1]}</span>}
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- result

function ProbBar({ p, threshold, color, label }: { p: number; threshold: number; color: string; label: string }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-cap text-ink-2"><span>{label}</span><span className="text-body font-semibold text-ink">{pct(p)}</span></div>
      <div className="relative h-4 rounded-sm bg-bg" role="img" aria-label={`${label}: probability ${pct(p)}, threshold ${threshold.toFixed(2)}`}>
        <div className="h-4 rounded-sm transition-[width] duration-200 ease-out" style={{ width: `${p * 100}%`, background: color }} />
        <div className="absolute -bottom-1 -top-1 w-px bg-ink" style={{ left: `${threshold * 100}%` }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- how it decided

function LrWaterfall({ w }: { w: LrWalk }) {
  const steps = [{ name: "Intercept", delta: w.intercept }, ...w.contributions.map((c) => ({ name: c.feature, delta: c.contribution }))];
  let run = 0;
  const bars = steps.map((s) => { const start = run; run += s.delta; return { ...s, start, end: run }; });
  bars.push({ name: "Score", delta: w.logit, start: 0, end: w.logit });
  const sum = w.intercept + w.contributions.reduce((s, c) => s + c.contribution, 0);
  return (
    <>
      <Chart notMerge height={300}
        table={{
          columns: ["Step", "Value", "Weight", "Value × weight", "Running score"],
          rows: [["Intercept", "", "", f3(w.intercept), bars[0].end.toFixed(3)],
            ...w.contributions.map((c, i) => [<span className="font-mono">{c.feature}</span>, c.value.toFixed(3), c.weight.toFixed(3), f3(c.contribution), bars[i + 1].end.toFixed(3)]),
            ["Score (logit)", "", "", "", w.logit.toFixed(3)]],
        }}
        option={{
          grid: { left: 56, right: 8, top: 24, bottom: 8, containLabel: true },
          tooltip: {
            trigger: "item", formatter: (p: any) => {
              const b = bars[p.dataIndex];
              const c = w.contributions[p.dataIndex - 1];
              return b.name === "Score" ? `Score = ${w.logit.toFixed(3)}`
                : c ? `${c.feature}<br/>value ${c.value.toFixed(3)} × weight ${c.weight.toFixed(3)} = ${f3(c.contribution)}`
                  : `Intercept ${f3(w.intercept)}`;
            },
          },
          xAxis: { type: "category", data: bars.map((b) => b.name), axisLabel: { ...mono, color: tokens.ink2, interval: 0, rotate: 35 } },
          yAxis: { type: "value", name: "score (log-odds)" },
          animationDelay: (i: number) => i * 60,
          series: [{
            type: "custom", data: bars.map((b, i) => [i, b.start, b.end]),
            renderItem: (params: any, api: any) => {
              const i = api.value(0);
              const a = api.coord([i, api.value(1)]), b = api.coord([i, api.value(2)]);
              const width = api.size([1, 0])[0] * 0.6;
              const isEnd = i === 0 || i === bars.length - 1;
              const up = api.value(2) >= api.value(1);
              return {
                type: "rect",
                shape: { x: a[0] - width / 2, y: Math.min(a[1], b[1]), width, height: Math.max(1, Math.abs(a[1] - b[1])) },
                style: { fill: isEnd ? tokens.lr : up ? tokens.accent : tokens.neutralBar },
                enterFrom: { shape: { y: a[1], height: 0 } },
                transition: ["shape"],
                enterAnimation: { delay: params.dataIndex * 60, duration: 240 },
              };
            },
          }],
        }} />
      <p className="mt-2 font-mono text-cap text-ink">
        score = {w.intercept.toFixed(3)} {w.contributions.map((c) => `${c.contribution >= 0 ? "+" : "−"} ${Math.abs(c.contribution).toFixed(3)}`).join(" ")} = {sum.toFixed(3)}
      </p>
      <p className="font-mono text-cap text-ink">
        p = 1 / (1 + e^−({w.logit.toFixed(3)})) = {w.probability.toFixed(4)}
      </p>
    </>
  );
}

function RfVotes({ w, onTree }: { w: RfWalk; onTree: (i: number) => void }) {
  const bins = Array.from({ length: 10 }, (_, i) => ({ lo: i / 10, hi: (i + 1) / 10, n: 0 }));
  w.tree_probabilities.forEach((p) => { bins[Math.min(9, Math.floor(p * 10))].n += 1; });
  const max = Math.max(...bins.map((b) => b.n), 1);
  const t = w.example_tree;
  return (
    <>
      <p className="text-card text-ink">{w.trees_voting_yes} of {w.n_trees} trees vote Yes</p>
      <p className="text-cap text-ink-2">Forest probability = average of all trees = {w.probability.toFixed(4)}</p>
      <Chart notMerge height={220}
        table={{ columns: ["Tree probability", "Trees"], rows: bins.map((b) => [`${b.lo.toFixed(1)}–${b.hi.toFixed(1)}`, b.n]) }}
        option={{
          grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
          tooltip: { trigger: "item", formatter: (p: any) => { const b = bins[p.dataIndex]; return b ? `Tree probability ${b.lo.toFixed(1)}–${b.hi.toFixed(1)}<br/>${b.n} trees (${pct(b.n / w.n_trees)})` : ""; } },
          xAxis: { type: "value", min: 0, max: 1, name: "tree's Yes probability", nameLocation: "middle", nameGap: 24 },
          yAxis: { type: "value", name: "trees", minInterval: 1, max: Math.ceil(max * 1.1) },
          series: [
            {
              type: "custom", data: bins.map((b) => [b.lo, b.hi, b.n]),
              renderItem: (params: any, api: any) => {
                const a = api.coord([api.value(0), api.value(2)]), b = api.coord([api.value(1), 0]);
                return {
                  type: "rect", shape: { x: a[0] + 1, y: a[1], width: b[0] - a[0] - 2, height: b[1] - a[1] },
                  style: { fill: api.value(0) >= 0.5 ? tokens.rf : tokens.neutralBar },
                  enterFrom: { shape: { y: b[1], height: 0 } }, transition: ["shape"],
                  enterAnimation: { delay: params.dataIndex * 30, duration: 300 },
                };
              },
            },
            { type: "line", data: [[0.5, 0], [0.5, Math.ceil(max * 1.1)]], symbol: "none", silent: true, tooltip: { show: false }, lineStyle: { type: "dashed", color: tokens.ink3, width: 1 } },
          ],
        }} />
      <div className="mt-3 flex items-center gap-2 text-cap text-ink-2">
        <button aria-label="Previous tree" className="clay clay-teal rounded-full px-2.5" onClick={() => onTree((t.index - 1 + w.n_trees) % w.n_trees)}>‹</button>
        <span>Tree {t.index + 1} of {w.n_trees}: its path for this profile</span>
        <button aria-label="Next tree" className="clay clay-teal rounded-full px-2.5" onClick={() => onTree((t.index + 1) % w.n_trees)}>›</button>
      </div>
      <p className="mt-1 font-mono text-cap leading-6 text-ink">
        {t.path.map((s, i) => (
          <span key={i}>{s.feature} = {s.value} {s.went} {s.threshold} <span className="text-ink-3">→</span> </span>
        ))}
        <span>leaf: {t.leaf_probability.toFixed(2)}</span>
      </p>
    </>
  );
}

function XgbRounds({ w, threshold }: { w: XgbWalk; threshold: number }) {
  const pts = [[0, w.start_probability], ...w.probability_by_round.map((p, i) => [i + 1, p])];
  return (
    <>
      <Chart notMerge height={260}
        table={{ columns: ["Round", "Probability"], rows: pts.map(([r, p]) => [r === 0 ? "start" : r, p.toFixed(4)]) }}
        option={{
          grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
          tooltip: { trigger: "axis", formatter: (ps: any) => `After round ${ps[0].value[0]}: ${pct(ps[0].value[1])}` },
          xAxis: { type: "value", min: 0, max: w.n_rounds, name: "boosting round", nameLocation: "middle", nameGap: 24 },
          yAxis: { type: "value", min: 0, max: 1, axisLabel: { formatter: (v: number) => pct(v, 0) } },
          animationDuration: 800, animationEasing: "linear",
          series: [
            { type: "line", data: pts, showSymbol: false, lineStyle: { color: tokens.xgb, width: 2 }, itemStyle: { color: tokens.xgb } },
            { type: "line", data: [[0, threshold], [w.n_rounds, threshold]], symbol: "none", silent: true, tooltip: { show: false }, lineStyle: { type: "dashed", color: tokens.ink3, width: 1 } },
          ],
        }} />
      <p className="mt-1 text-cap text-ink-2">
        Each round adds one small tree that nudges the estimate. Start {pct(w.start_probability)} → after {w.n_rounds} rounds {pct(w.probability)}.
      </p>
    </>
  );
}

function ShapBars({ r }: { r: Prediction }) {
  const rows = [...r.shap_top5].reverse();
  const lim = Math.max(...rows.map((s) => Math.abs(s.shap)), 0.01) * 1.15;
  return (
    <Chart notMerge height={220}
      table={{ columns: ["Feature", "SHAP", "Direction"], rows: r.shap_top5.map((s) => [<span className="font-mono">{s.feature}</span>, f3(s.shap), s.shap >= 0 ? "towards Yes" : "towards No"]) }}
      option={{
        grid: { left: 8, right: 16, top: 24, bottom: 8, containLabel: true },
        tooltip: { trigger: "item", formatter: (p: any) => `${p.name}<br/>${f3(p.value)} (${p.value >= 0 ? "towards Yes" : "towards No"})` },
        xAxis: { type: "value", min: -lim, max: lim, axisLabel: { formatter: (v: number) => v.toFixed(2) } },
        yAxis: { type: "category", data: rows.map((s) => s.feature), axisLabel: { ...mono, color: tokens.ink2 } },
        graphic: [
          { type: "text", left: 8, top: 0, style: { text: "← towards No", fill: tokens.ink2, fontSize: 12 } },
          { type: "text", right: 16, top: 0, style: { text: "towards Yes →", fill: tokens.ink2, fontSize: 12 } },
        ],
        series: [{
          type: "bar", barMaxWidth: 16,
          data: rows.map((s) => ({ value: s.shap, itemStyle: { color: s.shap >= 0 ? tokens.accent : tokens.neutralBar } })),
        }],
      }} />
  );
}

// ---------------------------------------------------------------- page

/** Predictor section, rendered at the bottom of the Models page grid. */
export function PredictorPanel() {
  const { meta } = useFilters();
  const m = meta!;
  const [a, setA] = useState<Profile>(m.profile_defaults);
  const [b, setB] = useState<Profile | null>(null);
  const [editing, setEditing] = useState<"A" | "B">("A");
  const [model, setModel] = useState(m.default_model);
  const [threshold, setThreshold] = useState(0.5);
  const [compare, setCompare] = useState(false);
  const [res, setRes] = useState<{ a: Prediction; b?: Prediction; all?: Prediction[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (tree?: number) => {
    setBusy(true); setError(null);
    try {
      const [ra, rb, all] = await Promise.all([
        api.predict(model, a, threshold, tree),
        b ? api.predict(model, b, threshold) : Promise.resolve(undefined),
        compare ? Promise.all(ALGOS.map((x) => api.predict(x, a, threshold))) : Promise.resolve(undefined),
      ]);
      setRes({ a: ra, b: rb, all });
    } catch (e) {
      const err = e as ApiError;
      const errs = (err.detail as { errors?: Record<string, { allowed: unknown }> })?.errors;
      setError(errs ? `${err.message}: ${Object.entries(errs).map(([k, v]) => `${k} — allowed ${JSON.stringify(v.allowed)}`).join("; ")}` : err.message);
    } finally { setBusy(false); }
  };

  const r = res?.a;
  const shown = r && r.model === model ? r : null;
  const auc = shown?.model_auc;

  return (
    <>
      <div id="predictor" className="col-span-12 mt-4 scroll-mt-20 border-t border-line pt-6">
        <h2 className="text-title text-ink">Predictor</h2>
        <p className="max-w-prose text-body text-ink-2">What does a model say for this profile, and why?</p>
      </div>
      <Card span={4} title="Profile" subtitle="Which respondent profile should the model score?"
        note={`Levels and ranges from the cleaned data (n = ${m.rows_clean})`}>
        {b && (
          <div className="glass-inset mb-3 inline-flex gap-0.5 p-0.5 text-cap" role="group" aria-label="Scenario">
            {(["A", "B"] as const).map((s) => (
              <button key={s} aria-pressed={editing === s} onClick={() => setEditing(s)}
                className={`rounded-full px-3 py-0.5 ${editing === s ? "clay clay-pink rounded-full" : "text-ink-2"}`}>Scenario {s}</button>
            ))}
          </div>
        )}
        {editing === "A" || !b
          ? <ProfileForm profile={a} onChange={setA} />
          : <ProfileForm profile={b} base={a} onChange={setB} />}

        <fieldset className="mt-4">
          <legend className="mb-1 text-cap text-ink-2">Model</legend>
          <div className="glass-inset inline-flex gap-0.5 p-0.5 text-body" role="group">
            {ALGOS.map((x) => (
              <button key={x} aria-pressed={model === x} onClick={() => setModel(x)}
                className={`rounded-full px-3 py-1 ${model === x ? "clay clay-violet rounded-full font-semibold" : "text-ink-2"}`}>
                {ALGO_SHORT[x]}{x === m.default_model && <span className="ml-1 text-cap font-normal text-ink-3">default</span>}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="mt-4 block text-cap text-ink-2">Threshold <span className="text-ink">{threshold.toFixed(2)}</span>
          <input type="range" className="single" min={0.05} max={0.95} step={0.05} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </label>
        <label className="mt-3 flex items-center gap-2 text-body text-ink">
          <input type="checkbox" role="switch" className="accent-accent" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
          Compare all three
        </label>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={() => run()} disabled={busy}
            className="clay clay-pink rounded-full px-5 py-1.5 text-body font-semibold disabled:opacity-60">
            {busy ? "Predicting…" : "Predict"}
          </button>
          {b ? (
            <button className="text-cap text-ink-2 underline" onClick={() => { setB(null); setEditing("A"); }}>Remove scenario B</button>
          ) : (
            <button className="text-cap text-accent underline" onClick={() => { setB({ ...a }); setEditing("B"); }}>Add scenario B</button>
          )}
        </div>
        {error && <div className="mt-3"><ErrorState message={error} /></div>}
      </Card>

      <div className="col-span-12 grid min-w-0 grid-cols-12 content-start gap-4 lg:col-span-8">
        <Card span={12} title="Result" subtitle="What probability of Yes does the model give this profile?"
          note={`Estimate from ${m.rows_raw} survey responses in Bangalore; not a forecast for any real person.`}>
          {!r ? <p className="text-body text-ink-2">Choose a profile and press Predict.</p> : (
            <div className="space-y-3">
              {res!.all
                ? res!.all.map((x) => <ProbBar key={x.model} p={x.probability} threshold={threshold} color={ALGO_COLOR[x.model]} label={`${ALGO_NAME[x.model]}${b ? " · scenario A" : ""}`} />)
                : <ProbBar p={r.probability} threshold={threshold} color={ALGO_COLOR[r.model]} label={`${ALGO_NAME[r.model]}${b ? " · scenario A" : ""}`} />}
              {res!.b && <ProbBar p={res!.b.probability} threshold={threshold} color={ALGO_COLOR[res!.b.model]} label={`${ALGO_NAME[res!.b.model]} · scenario B`} />}
              <p className="text-body text-ink">
                {ALGO_NAME[r.model]} predicts <b>{r.probability >= threshold ? "Yes" : "No"}</b>: probability {pct(r.probability)} is
                {r.probability >= threshold ? " at or above" : " below"} the {threshold.toFixed(2)} threshold.
              </p>
              {res!.b && (
                <p className="text-body text-ink">
                  B − A = <b>{((res!.b.probability - r.probability) * 100).toFixed(1)} percentage points</b>.{" "}
                  <span className="text-ink-2">Difference in model output — not the effect of changing this trait.</span>
                </p>
              )}
              {auc && (
                <p className="text-cap text-ink-2">
                  {ALGO_NAME[r.model]} cross-validated ROC-AUC {auc.mean.toFixed(3)} [{auc.ci_low.toFixed(2)}–{auc.ci_high.toFixed(2)}]
                </p>
              )}
            </div>
          )}
        </Card>

        <Card span={12} title="How it decided" subtitle="Replaying the model's actual steps"
          note={shown ? `Walkthrough values returned by the API for this profile · ${ALGO_NAME[shown.model]}` : "Press Predict to replay the model's steps"}
          tableToggle>
          {!shown ? <p className="text-body text-ink-2">{r ? "Press Predict to see this model's steps." : "No prediction yet."}</p>
            : shown.walkthrough.algorithm === "logistic_regression" ? <LrWaterfall key={JSON.stringify(a)} w={shown.walkthrough} />
              : shown.walkthrough.algorithm === "random_forest" ? <RfVotes w={shown.walkthrough} onTree={(i) => run(i)} />
                : <XgbRounds w={shown.walkthrough} threshold={threshold} />}
        </Card>

        <Card span={12} title="Top 5 factors (SHAP)" subtitle="Which features move this prediction, and in which direction?"
          note="Pushes towards Yes / towards No · SHAP values in log-odds (LR, XGBoost) or probability (RF)" tableToggle>
          {shown ? <ShapBars r={shown} /> : <p className="text-body text-ink-2">No prediction yet.</p>}
        </Card>
      </div>
    </>
  );
}
