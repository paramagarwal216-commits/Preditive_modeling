"""
Online food ordering - model training pipeline.

Trains Logistic Regression, Random Forest and XGBoost under ONE identical protocol:
  1. Load + clean the Kaggle CSV (original file is never modified).
  2. Run the target-validation gate (class balance, leakage, duplicates).
  3. Evaluate every model with repeated stratified nested cross-validation
     (outer loop = honest score, inner loop = hyperparameter tuning).
  4. Report mean and 95% interval for each metric, next to a majority-class baseline.
  5. Fit final models on all data and save them with metadata for the FastAPI backend.
  6. Save explanations: LR coefficients, mean |SHAP| for every model.

Run:  python train_models.py --data onlinefoods.csv --out artifacts
Fast check while developing:  python train_models.py --data onlinefoods.csv --fast
"""

import argparse
import json
import os
import time
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import shap
from scipy.stats import loguniform, randint, uniform
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.base import clone
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import get_scorer, roc_auc_score
from sklearn.model_selection import (RandomizedSearchCV, RepeatedStratifiedKFold,
                                     StratifiedKFold)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, OrdinalEncoder, StandardScaler
from xgboost import XGBClassifier

# Keep the console readable (also applies inside parallel worker processes).
os.environ.setdefault("PYTHONWARNINGS", "ignore::FutureWarning,ignore::UserWarning")
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

# ---------------------------------------------------------------------------
# 1. Configuration: the only place you should need to edit
# ---------------------------------------------------------------------------
SEED = 42
TARGET = "Output"
POSITIVE_CLASS = "Yes"          # write down what "Yes" means in your report

NUMERIC = ["Age", "Family size"]
NOMINAL = ["Gender", "Marital Status", "Occupation"]
ORDINAL = {
    # Order matters: low -> high. Check these spellings against your file;
    # fitting fails loudly if the file contains a level not listed here.
    "Monthly Income": ["No Income", "Below Rs.10000", "10001 to 25000",
                       "25001 to 50000", "More than 50000"],
    "Educational Qualifications": ["Uneducated", "School", "Graduate",
                                   "Post Graduate", "Ph.D"],
}
FEATURES = NUMERIC + NOMINAL + list(ORDINAL)

# Never used as model inputs (see PRD Section 3):
#   Feedback  -> recorded after the order, leaks the outcome
#   latitude/longitude/Pin code -> location, used only for the map
#   unnamed column -> undocumented, possibly a copy of Output
EXCLUDED = ["Feedback", "latitude", "longitude", "Pin code"]

METRICS = {
    "roc_auc": "roc_auc",
    "pr_auc": "average_precision",
    "f1": "f1",
    "precision": "precision",
    "recall": "recall",
    "accuracy": "accuracy",
    "brier": "neg_brier_score",
}


# ---------------------------------------------------------------------------
# 2. Load and clean
# ---------------------------------------------------------------------------
def load_and_clean(path, drop_duplicates=True):
    raw = pd.read_csv(path)
    log = {"raw_rows": len(raw), "raw_columns": list(raw.columns)}

    df = raw.copy()
    df.columns = [c.strip() for c in df.columns]
    unnamed = [c for c in df.columns if c == "" or c.startswith("Unnamed")]
    log["unnamed_columns"] = unnamed

    for col in df.columns:
        if pd.api.types.is_numeric_dtype(df[col]):
            continue
        df[col] = df[col].astype(str).str.strip()

    # How often does the unnamed column agree with Output? Report, then drop.
    if unnamed:
        agree = (df[unnamed[0]] == df[TARGET]).mean()
        log["unnamed_vs_output_agreement"] = round(float(agree), 4)
        df = df.drop(columns=unnamed)

    log["exact_duplicates"] = int(df.duplicated().sum())
    if drop_duplicates:
        df = df.drop_duplicates()

    before = len(df)
    df = df.dropna(subset=FEATURES + [TARGET])
    log["rows_dropped_missing"] = before - len(df)
    log["clean_rows"] = len(df)

    X = df[FEATURES]
    y = (df[TARGET] == POSITIVE_CLASS).astype(int)
    return df, X, y, log


# ---------------------------------------------------------------------------
# 3. Target-validation gate
# ---------------------------------------------------------------------------
def target_gate(df, y):
    report = {
        "positive_class": POSITIVE_CLASS,
        "class_counts": df[TARGET].value_counts().to_dict(),
        "positive_rate": round(float(y.mean()), 4),
        "single_feature_auc": {},
    }
    # Leakage check: no single column should predict the target almost perfectly.
    for col in FEATURES + [c for c in EXCLUDED if c in df.columns]:
        codes = (df[col] if pd.api.types.is_numeric_dtype(df[col])
                 else pd.factorize(df[col])[0])
        auc = roc_auc_score(y, codes)
        report["single_feature_auc"][col] = round(float(max(auc, 1 - auc)), 3)
    report["leak_suspects"] = [c for c, a in report["single_feature_auc"].items()
                               if a > 0.95]
    report["minority_share"] = round(float(min(y.mean(), 1 - y.mean())), 4)
    return report


# ---------------------------------------------------------------------------
# 4. Preprocessing + models
#    Each model gets its own Pipeline so preprocessing is fitted inside every
#    CV fold (no leakage) and is saved together with the model.
# ---------------------------------------------------------------------------
def make_preprocessor(scale_numeric):
    return ColumnTransformer([
        ("num", StandardScaler() if scale_numeric else "passthrough", NUMERIC),
        ("nom", OneHotEncoder(handle_unknown="ignore", drop=None), NOMINAL),
        ("ord", OrdinalEncoder(categories=list(ORDINAL.values()),
                               handle_unknown="use_encoded_value",
                               unknown_value=-1), list(ORDINAL)),
    ], verbose_feature_names_out=False)


def make_models(y):
    imbalanced = min(y.mean(), 1 - y.mean()) < 0.35
    cw = "balanced" if imbalanced else None
    spw = float((y == 0).sum() / (y == 1).sum()) if imbalanced else 1.0

    return {
        "majority_baseline": (
            Pipeline([("prep", make_preprocessor(False)),
                      ("model", DummyClassifier(strategy="prior"))]),
            None,
        ),
        "logistic_regression": (
            Pipeline([("prep", make_preprocessor(True)),
                      ("model", LogisticRegression(max_iter=5000, solver="liblinear",
                                                   class_weight=cw))]),
            {"model__C": loguniform(1e-2, 1e1),
             "model__penalty": ["l1", "l2"]},
        ),
        "random_forest": (
            Pipeline([("prep", make_preprocessor(False)),
                      ("model", RandomForestClassifier(random_state=SEED,
                                                       class_weight=cw, n_jobs=1))]),
            {"model__n_estimators": randint(100, 400),
             "model__max_depth": randint(3, 11),
             "model__min_samples_leaf": randint(1, 11),
             "model__max_features": ["sqrt", 0.5]},
        ),
        "xgboost": (
            Pipeline([("prep", make_preprocessor(False)),
                      ("model", XGBClassifier(random_state=SEED, n_jobs=1,
                                              eval_metric="logloss",
                                              scale_pos_weight=spw))]),
            {"model__n_estimators": randint(50, 300),
             "model__learning_rate": loguniform(1e-2, 3e-1),
             "model__max_depth": randint(2, 7),
             "model__subsample": uniform(0.6, 0.4),
             "model__colsample_bytree": uniform(0.6, 0.4),
             "model__reg_lambda": uniform(0, 10)},
        ),
    }


def tuned(pipe, space, n_iter, inner_folds):
    """Wrap a pipeline in an inner-CV hyperparameter search (or return as-is)."""
    if space is None:
        return pipe
    return RandomizedSearchCV(
        pipe, space, n_iter=n_iter, scoring="roc_auc",
        cv=StratifiedKFold(inner_folds, shuffle=True, random_state=SEED),
        random_state=SEED, n_jobs=-1, refit=True)


# ---------------------------------------------------------------------------
# 5. Nested, repeated cross-validation
#    Manual fold loop so a caller (the API) can stream progress per fold.
# ---------------------------------------------------------------------------
def evaluate_model(name, pipe, space, X, y, repeats, n_iter, on_fold=None):
    """Score one model. on_fold(event_dict) is called after every outer fold."""
    outer = RepeatedStratifiedKFold(n_splits=5, n_repeats=repeats, random_state=SEED)
    splits = list(outer.split(X, y))
    scorers = {m: get_scorer(s) for m, s in METRICS.items()}
    scores = {m: [] for m in METRICS}
    best_params = []
    t0 = time.time()

    for i, (tr, te) in enumerate(splits, start=1):
        est = clone(tuned(pipe, space, n_iter, inner_folds=3))
        est.fit(X.iloc[tr], y.iloc[tr])
        fold = {}
        for m, scorer in scorers.items():
            v = float(scorer(est, X.iloc[te], y.iloc[te]))
            v = -v if m == "brier" else v
            scores[m].append(v)
            fold[m] = round(v, 4)
        if space is not None:
            best_params.append({k: (v.item() if hasattr(v, "item") else v)
                                for k, v in est.best_params_.items()})
        if on_fold:
            on_fold({"model": name, "fold": i, "of": len(splits),
                     "scores": fold, "params": best_params[-1] if best_params else None})

    summary = {}
    for m, s in scores.items():
        s = np.array(s)
        summary[m] = {"mean": round(float(s.mean()), 4),
                      "ci_low": round(float(np.percentile(s, 2.5)), 4),
                      "ci_high": round(float(np.percentile(s, 97.5)), 4)}
    summary["n_outer_folds"] = len(splits)
    summary["train_seconds"] = round(time.time() - t0, 1)
    if best_params:
        summary["best_params_per_fold"] = best_params
    return summary, scores["roc_auc"]


def evaluate(models, X, y, repeats, n_iter, on_fold=None):
    results, fold_scores = {}, {}
    for name, (pipe, space) in models.items():
        summary, aucs = evaluate_model(name, pipe, space, X, y, repeats, n_iter, on_fold)
        results[name], fold_scores[name] = summary, [round(a, 4) for a in aucs]
        r = summary["roc_auc"]
        print(f"  {name:<20} ROC-AUC {r['mean']:.3f}  "
              f"[{r['ci_low']:.3f}, {r['ci_high']:.3f}]  ({summary['train_seconds']}s)")
    return results, fold_scores


def pick_default(results):
    """Highest mean ROC-AUC; if a simpler model's interval overlaps heavily, prefer it."""
    order = ["logistic_regression", "random_forest", "xgboost"]   # simple -> complex
    best = max(order, key=lambda m: results[m]["roc_auc"]["mean"])
    b = results[best]["roc_auc"]
    for m in order[:order.index(best)]:
        r = results[m]["roc_auc"]
        overlap = max(0, min(r["ci_high"], b["ci_high"]) - max(r["ci_low"], b["ci_low"]))
        width = b["ci_high"] - b["ci_low"]
        if width > 0 and overlap / width > 0.5:
            return m, f"{m} chosen: its interval overlaps {best}'s by >50% and it is simpler"
    return best, f"{best} chosen: highest mean ROC-AUC"


# ---------------------------------------------------------------------------
# 6. Explanations
# ---------------------------------------------------------------------------
def shap_values_for(pipe, X_background, X_explain):
    """Return (feature_names, shap matrix for the positive class)."""
    prep, model = pipe.named_steps["prep"], pipe.named_steps["model"]
    names = list(prep.get_feature_names_out())
    Xb = prep.transform(X_background)
    Xe = prep.transform(X_explain)
    Xb = Xb.toarray() if hasattr(Xb, "toarray") else Xb
    Xe = Xe.toarray() if hasattr(Xe, "toarray") else Xe

    if isinstance(model, LogisticRegression):
        explainer = shap.LinearExplainer(model, Xb)
    else:
        explainer = shap.TreeExplainer(model)
    sv = explainer.shap_values(Xe)
    if isinstance(sv, list):                 # older SHAP: one array per class
        sv = sv[1]
    if sv.ndim == 3:                         # newer SHAP for RF: (rows, features, classes)
        sv = sv[:, :, 1]
    return names, sv


def explain_global(name, pipe, X):
    out = {}
    names, sv = shap_values_for(pipe, X, X)
    out["mean_abs_shap"] = dict(sorted(
        {n: round(float(v), 4) for n, v in zip(names, np.abs(sv).mean(0))}.items(),
        key=lambda kv: -kv[1]))
    model = pipe.named_steps["model"]
    if isinstance(model, LogisticRegression):
        # Coefficients are log-odds per unit of the ENCODED feature:
        # per 1 SD for Age/Family size, per level step for ordinal fields,
        # and vs. "not this category" for one-hot fields.
        out["coefficients"] = dict(sorted(
            {n: round(float(c), 4) for n, c in zip(names, model.coef_[0])}.items(),
            key=lambda kv: -abs(kv[1])))
    elif hasattr(model, "feature_importances_"):
        out["builtin_importance"] = {n: round(float(v), 4)
                                     for n, v in zip(names, model.feature_importances_)}
    return out


def explain_one(pipe, X_background, profile, top_k=5):
    """Used by the Predictor page: probability + top contributing features."""
    row = pd.DataFrame([profile])[FEATURES]
    proba = float(pipe.predict_proba(row)[0, 1])
    names, sv = shap_values_for(pipe, X_background, row)
    contrib = sorted(zip(names, sv[0]), key=lambda kv: -abs(kv[1]))[:top_k]
    return {"probability_positive": round(proba, 4),
            "top_contributions": [{"feature": n, "shap": round(float(v), 4)}
                                  for n, v in contrib]}


# ---------------------------------------------------------------------------
# 6b. "How the algorithm decided" - one walk-through per algorithm
#     Each returns plain JSON the frontend can draw without extra maths.
# ---------------------------------------------------------------------------
def _row(pipe, profile):
    prep = pipe.named_steps["prep"]
    x = prep.transform(pd.DataFrame([profile])[FEATURES])
    x = x.toarray() if hasattr(x, "toarray") else x
    return list(prep.get_feature_names_out()), x[0]


def lr_walkthrough(pipe, profile):
    """Weighted sum -> sigmoid. Contributions add up exactly to the logit."""
    names, x = _row(pipe, profile)
    m = pipe.named_steps["model"]
    parts = [{"feature": n, "value": round(float(v), 4),
              "weight": round(float(w), 4), "contribution": round(float(v * w), 4)}
             for n, v, w in zip(names, x, m.coef_[0]) if abs(v * w) > 1e-9]
    parts.sort(key=lambda p: -abs(p["contribution"]))
    logit = float(m.intercept_[0] + np.dot(x, m.coef_[0]))
    return {"algorithm": "logistic_regression", "intercept": round(float(m.intercept_[0]), 4),
            "contributions": parts, "logit": round(logit, 4),
            "probability": round(float(1 / (1 + np.exp(-logit))), 4)}


def rf_walkthrough(pipe, profile, show_tree=0):
    """Every tree votes; the forest averages. Also returns one tree's path as rules."""
    names, x = _row(pipe, profile)
    m = pipe.named_steps["model"]
    tree_p = np.array([t.predict_proba(x.reshape(1, -1))[0, 1] for t in m.estimators_])
    t = m.estimators_[show_tree].tree_
    node, path = 0, []
    while t.children_left[node] != -1:
        f, thr = t.feature[node], t.threshold[node]
        go_left = x[f] <= thr
        path.append({"feature": names[f], "threshold": round(float(thr), 3),
                     "value": round(float(x[f]), 3), "went": "<=" if go_left else ">"})
        node = t.children_left[node] if go_left else t.children_right[node]
    leaf = t.value[node][0]
    return {"algorithm": "random_forest", "n_trees": len(tree_p),
            "trees_voting_yes": int((tree_p >= 0.5).sum()),
            "tree_probabilities": [round(float(p), 3) for p in tree_p],
            "probability": round(float(tree_p.mean()), 4),
            "example_tree": {"index": show_tree, "path": path,
                             "leaf_probability": round(float(leaf[1] / leaf.sum()), 4)}}


def xgb_walkthrough(pipe, profile):
    """Trees are added one by one, each correcting the last. Probability after every round."""
    prep, m = pipe.named_steps["prep"], pipe.named_steps["model"]
    row = prep.transform(pd.DataFrame([profile])[FEATURES])
    n = m.get_booster().num_boosted_rounds()
    curve = [round(float(m.predict_proba(row, iteration_range=(0, i))[0, 1]), 4)
             for i in range(1, n + 1)]
    # Starting point before any tree = the model's base score (a probability).
    cfg = json.loads(m.get_booster().save_config())
    base = float(str(cfg["learner"]["learner_model_param"]["base_score"]).strip("[]"))
    return {"algorithm": "xgboost", "n_rounds": n, "start_probability": round(base, 4),
            "probability_by_round": curve, "probability": curve[-1] if curve else None}


WALKTHROUGHS = {"logistic_regression": lr_walkthrough,
                "random_forest": rf_walkthrough,
                "xgboost": xgb_walkthrough}


# ---------------------------------------------------------------------------
# 7. Main
# ---------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--out", default="artifacts")
    ap.add_argument("--repeats", type=int, default=10, help="outer CV repeats")
    ap.add_argument("--n-iter", type=int, default=30, help="search draws per fold")
    ap.add_argument("--keep-duplicates", action="store_true")
    ap.add_argument("--fast", action="store_true", help="2 repeats, 8 draws")
    args = ap.parse_args()
    if args.fast:
        args.repeats, args.n_iter = 2, 8

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    print("1. Loading and cleaning")
    df, X, y, clean_log = load_and_clean(args.data, not args.keep_duplicates)
    print(f"   {clean_log['raw_rows']} raw rows -> {clean_log['clean_rows']} clean rows")

    print("2. Target gate")
    gate = target_gate(df, y)
    print(f"   positive rate {gate['positive_rate']:.1%}, leak suspects: "
          f"{gate['leak_suspects'] or 'none'}")
    if gate["leak_suspects"]:
        print("   WARNING: investigate leak suspects before trusting any score.")

    print(f"3. Nested CV ({args.repeats}x5 outer folds, {args.n_iter} draws inner)")
    models = make_models(y)
    results, fold_scores = evaluate(models, X, y, args.repeats, args.n_iter)
    default, reason = pick_default(results)
    print(f"   default model: {reason}")

    print("4. Final fit on all clean data + explanations")
    final, explanations = {}, {}
    for name, (pipe, space) in models.items():
        if space is None:
            continue
        search = tuned(pipe, space, args.n_iter, inner_folds=5).fit(X, y)
        final[name] = search.best_estimator_
        explanations[name] = explain_global(name, final[name], X)
        joblib.dump(final[name], out / f"{name}.joblib")

    example = X.iloc[0].to_dict()
    demo = {m: {**explain_one(final[m], X, example),
                "walkthrough": WALKTHROUGHS[m](final[m], example)} for m in final}

    metadata = {
        "dataset": str(args.data), "seed": SEED, "target": TARGET,
        "positive_class": POSITIVE_CLASS, "features": FEATURES,
        "excluded": EXCLUDED, "ordinal_levels": ORDINAL,
        "nominal_levels": {c: sorted(X[c].unique().tolist()) for c in NOMINAL},
        "numeric_ranges": {c: [float(X[c].min()), float(X[c].max())] for c in NUMERIC},
        "cleaning_log": clean_log, "target_gate": gate,
        "cv_results": results, "cv_fold_roc_auc": fold_scores,
        "default_model": default, "default_reason": reason,
        "threshold": 0.5,
    }
    (out / "metadata.json").write_text(json.dumps(metadata, indent=2, default=str))
    (out / "explanations.json").write_text(json.dumps(explanations, indent=2))
    (out / "example_prediction.json").write_text(json.dumps(
        {"profile": example, "predictions": demo}, indent=2, default=str))
    X.to_csv(out / "background.csv", index=False)   # SHAP background for the API
    print(f"   saved models + metadata to {out.resolve()}")


if __name__ == "__main__":
    main()
