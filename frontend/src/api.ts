// Typed fetch helpers, one per endpoint (spec Section 4).
import { useEffect, useState } from "react";

export type Filters = {
  age?: [number, number];
  family?: [number, number];
  gender?: string[];
  marital?: string[];
  occupation?: string[];
  income?: string[];
  education?: string[];
  customer?: string[];
  feedback?: string[];
};

export type GroupRate = {
  level: string; n: number; positive: number; rate: number;
  ci_low: number; ci_high: number; small: boolean;
};

export type Interval = { mean: number; ci_low: number; ci_high: number };

export type ColumnInfo = {
  column: string; type: string; role: string; levels: string[] | null; missing: number; note: string;
};

export type TargetGate = {
  positive_class: string; class_counts: Record<string, number>; positive_rate: number;
  single_feature_auc: Record<string, number>; leak_suspects: string[]; minority_share: number;
};

export type CleanLog = {
  raw_rows: number; raw_columns: string[]; unnamed_columns: string[];
  unnamed_vs_output_agreement?: number; exact_duplicates: number;
  rows_dropped_missing: number; clean_rows: number;
};

export type Meta = {
  rows_raw: number; rows_clean: number; columns: ColumnInfo[];
  levels: Record<string, string[]>; numeric_ranges: Record<string, [number, number]>;
  features: string[]; profile_defaults: Record<string, string | number>;
  clean_log: CleanLog; target_gate: TargetGate;
  default_model: string; default_reason: string; file: string;
};

export type Finding = { text: string; ref: string };
export type Overview = {
  kpis: { n: number; positive_rate: number | null; duplicates_removed: number; missing_pct: number; rows_raw: number };
  outcome: { label: string; n: number }[];
  by_occupation: GroupRate[]; by_income: GroupRate[]; findings: Finding[];
};

export type SegmentTest = {
  name: string; stat: number | null; stat_label: string | null; p: number | null;
  p_holm: number | null; n_tests?: number; reason?: string;
};
export type Segments = {
  rows: GroupRate[]; overall: { n: number; rate: number | null };
  test: SegmentTest | null; age_hist: { bin: string; yes: number; no: number }[];
  heatmap?: { x_levels: string[]; y_levels: string[]; cells: { x: string; y: string; n: number; rate: number | null }[] };
};

export type Pin = { pin: number; n: number; positive: number; rate: number; ci_low: number; ci_high: number; lat: number; lon: number };
export type Geo = {
  pins: Pin[]; points: { lat: number; lon: number; y: number }[];
  quality: { valid: number; invalid: number; pins: number; pins_n5: number };
};

export type Rows = { rows: Record<string, string | number | null>[]; total: number; columns: string[] };

export type Summary = Record<"roc_auc" | "pr_auc" | "f1" | "precision" | "recall" | "accuracy" | "brier", Interval> & {
  n_outer_folds: number; train_seconds: number; best_params_per_fold?: Record<string, string | number>[];
};
export type Confusion = { threshold: number; tn: number; fp: number; fn: number; tp: number };
export type Oof = {
  roc_auc: number; pr_auc: number; prevalence: number;
  roc: { fpr: number; tpr: number }[]; pr: { recall: number; precision: number }[];
  calibration: { predicted: number; observed: number; n: number }[];
  confusion: Confusion; confusion_by_threshold: Confusion[];
};
export type Models = {
  cv_results: Record<string, Summary>; fold_auc: Record<string, number[]>;
  explanations: Record<string, { mean_abs_shap: Record<string, number>; coefficients?: Record<string, number>; builtin_importance?: Record<string, number> }>;
  oof: Record<string, Oof>; default_model: string; default_reason: string; leak_suspects: string[];
};

export type FoldEvent = {
  model: string; fold: number; of: number;
  scores: Record<string, number>; params: Record<string, string | number> | null;
};

export type LrWalk = {
  algorithm: "logistic_regression"; intercept: number; logit: number; probability: number;
  contributions: { feature: string; value: number; weight: number; contribution: number }[];
};
export type RfWalk = {
  algorithm: "random_forest"; n_trees: number; trees_voting_yes: number; tree_probabilities: number[];
  probability: number;
  example_tree: { index: number; leaf_probability: number; path: { feature: string; threshold: number; value: number; went: string }[] };
};
export type XgbWalk = {
  algorithm: "xgboost"; n_rounds: number; start_probability: number; probability_by_round: number[]; probability: number;
};
export type Prediction = {
  model: string; probability: number; predicted: "Yes" | "No"; threshold: number;
  shap_top5: { feature: string; shap: number }[];
  walkthrough: LrWalk | RfWalk | XgbWalk; model_auc: Interval; n_train: number;
};

export type DistRow = { level: string; n: number; yes: number; rate: number | null };
export type ColumnProfile = ColumnInfo & {
  unique: number | null;
  summary: { min: number; q1: number; median: number; mean: number; q3: number; max: number; std: number } | null;
  top: { level: string; n: number }[] | null;
};
export type Dashboard = {
  n: number; n_all: number;
  kpis: Record<"yes_rate" | "feedback_rate" | "median_age", { value: number | null; all: number }>;
  by_age: { age: number; n: number; yes: number; positive: number }[];
  dist: Record<string, DistRow[]>;
  top_pins: { pin: number; n: number; yes: number; rate: number }[];
  profile: ColumnProfile[];
  models: { default_model: string; default_reason: string; roc_auc: Record<string, Interval>; fold_auc: number[]; n_folds: number };
  source: {
    name: string; file: string; place: string; rows_raw: number; rows_clean: number; columns_raw: number;
    duplicates: number; missing_cells: number; target: string; positive_class: string; features: string[]; loaded_at: string;
  };
};

export type Report = {
  overall: { n: number; yes: number; rate: number };
  tests: Record<string, SegmentTest>;
  groups: Record<string, GroupRate[]>;
  cv_results: Record<string, Summary>;
  models: Record<string, { top_features: [string, number][]; coefficients: [string, number][]; confusion: Confusion; oof_roc_auc: number }>;
  default_model: string; default_reason: string;
  clean_log: CleanLog; target_gate: TargetGate; features: string[]; rows_raw: number; powerbi_path: string;
};

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail: unknown) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Empty in dev (Vite proxies /api); set VITE_API_URL to the hosted backend for a static deploy.
const API = `${(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "")}/api`;

async function send(path: string, body?: unknown): Promise<Response> {
  const r = await fetch(`${API}${path}`, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    let detail: unknown = r.statusText;
    try { detail = (await r.json()).detail; } catch { /* non-JSON error body */ }
    const msg = typeof detail === "string" ? detail
      : (detail as { message?: string })?.message ?? `Request failed (${r.status})`;
    throw new ApiError(msg, r.status, detail);
  }
  return r;
}

const json = <T,>(path: string, body?: unknown) => send(path, body).then((r) => r.json() as Promise<T>);

export const api = {
  meta: () => json<Meta>("/meta"),
  overview: (filters: Filters) => json<Overview>("/overview", { filters }),
  dashboard: (filters: Filters) => json<Dashboard>("/dashboard", { filters }),
  report: () => json<Report>("/report"),
  segments: (filters: Filters, by: string, measure: "output" | "feedback", by2?: string) =>
    json<Segments>("/segments", { filters, by, measure, by2 }),
  geo: (filters: Filters) => json<Geo>("/geo", { filters }),
  rows: (filters: Filters, view: "raw" | "clean", page: number, size: number, sort?: string) =>
    json<Rows>("/rows", { filters, view, page, size, sort }),
  exportCsv: (filters: Filters) => send("/export", { filters }).then((r) => r.blob()),
  models: () => json<Models>("/models"),
  train: (models: string[]) => json<{ job: string }>("/train", { models }),
  trainEventsUrl: (job: string) => `${API}/train/${job}/events`,
  predict: (model: string, profile: Record<string, string | number>, threshold: number, tree?: number) =>
    json<Prediction>("/predict", { model, profile, threshold, tree }),
};

/** Run an API call whenever `key` changes; stale responses are ignored. */
export function useApi<T>(fn: () => Promise<T>, key: string) {
  const [state, setState] = useState<{ data?: T; error?: string; loading: boolean }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (e: Error) => live && setState({ error: e.message, loading: false }),
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

export const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
export const num = (v: number | null | undefined, d = 3) => (v == null ? "—" : v.toFixed(d));
