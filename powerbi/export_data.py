"""
Export the cleaned data and the trained models' results as CSV tables for Power BI.

Run from the backend folder after training:
    .venv\\Scripts\\python.exe ..\\powerbi\\export_data.py
Writes powerbi/data/*.csv, which FoodOrdering.pbip loads.
"""

import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app import analytics as an  # noqa: E402
from app.state import State, tm  # noqa: E402

OUT = Path(__file__).resolve().parent / "data"
MODEL_NAME = {"majority_baseline": "Baseline", "logistic_regression": "Logistic Regression",
              "random_forest": "Random Forest", "xgboost": "XGBoost"}
MODEL_ORDER = {"logistic_regression": 1, "random_forest": 2, "xgboost": 3, "majority_baseline": 4}
METRIC_NAME = {"roc_auc": "ROC-AUC", "pr_auc": "PR-AUC", "f1": "F1", "precision": "Precision",
               "recall": "Recall", "accuracy": "Accuracy", "brier": "Brier"}


def main():
    s = State()
    s.load()
    OUT.mkdir(exist_ok=True)

    # 1. Respondents: one row per cleaned respondent, plus helper columns for sorting.
    df = s.df.copy()
    df["Income Order"] = df["Monthly Income"].map({v: i for i, v in enumerate(tm.ORDINAL["Monthly Income"])})
    edu = tm.ORDINAL["Educational Qualifications"]
    df["Education Order"] = df["Educational Qualifications"].map({v: i for i, v in enumerate(edu)})
    lo = int(df["Age"].min())
    df["Age Band"] = df["Age"].map(lambda a: an.age_band(int(a), lo))
    df["Says Yes"] = (df["Output"] == "Yes").astype(int)
    df["Positive Feedback"] = (df["Feedback"] == "Positive").astype(int)
    df.insert(0, "Respondent ID", range(1, len(df) + 1))
    df.to_csv(OUT / "respondents.csv", index=False)

    # 2. Model scores: mean and 95% interval of every metric for every model.
    rows = []
    for m, res in s.cv_results.items():
        for k, label in METRIC_NAME.items():
            rows.append({"Model": MODEL_NAME[m], "Model Order": MODEL_ORDER[m], "Metric": label,
                         "Mean": res[k]["mean"], "CI Low": res[k]["ci_low"], "CI High": res[k]["ci_high"],
                         "Folds": res["n_outer_folds"], "Is Default": int(m == s.default_model)})
    pd.DataFrame(rows).to_csv(OUT / "model_scores.csv", index=False)

    # 3. Fold scores: ROC-AUC on every held-out outer fold.
    rows = [{"Model": MODEL_NAME[m], "Fold": i + 1, "ROC-AUC": v}
            for m, folds in s.fold_auc.items() for i, v in enumerate(folds)]
    pd.DataFrame(rows).to_csv(OUT / "fold_scores.csv", index=False)

    # 4. Feature importance: mean |SHAP| and its share within each model (comparable across models).
    rows = []
    for m, e in s.explanations.items():
        total = sum(e["mean_abs_shap"].values()) or 1
        for f, v in e["mean_abs_shap"].items():
            rows.append({"Model": MODEL_NAME[m], "Feature": f, "Mean Abs SHAP": v,
                         "Importance Share": v / total,
                         "LR Coefficient": e.get("coefficients", {}).get(f)})
    pd.DataFrame(rows).to_csv(OUT / "feature_importance.csv", index=False)

    # 5. Confusion matrices at threshold 0.5 from out-of-fold predictions.
    rows = []
    for m, o in s.oof.items():
        c = o["confusion"]
        for actual, pred, key in [("No", "No", "tn"), ("No", "Yes", "fp"), ("Yes", "No", "fn"), ("Yes", "Yes", "tp")]:
            rows.append({"Model": MODEL_NAME[m], "Actual": actual, "Predicted": pred, "Count": c[key]})
    pd.DataFrame(rows).to_csv(OUT / "confusion.csv", index=False)

    # 6. Association tests: is each attribute associated with saying Yes?
    rows = []
    for attr, col in an.ATTRIBUTES.items():
        t = an.segment_test(s.df, attr, "output", s.df)
        rows.append({"Attribute": col, "Test": t["name"],
                     "Statistic": None if t["stat"] is None else round(t["stat"], 4),
                     "p": round(t["p"], 6), "Holm p": round(t["p_holm"], 6), "Significant (5%)": "Yes" if (t["p_holm"] or 1) < 0.05 else "No"})
    pd.DataFrame(rows).to_csv(OUT / "association_tests.csv", index=False)

    # 7. Data dictionary.
    rows = [{"Column": c["column"], "Type": c["type"], "Role": c["role"], "Missing": c["missing"],
             "Levels": ", ".join(c["levels"]) if c["levels"] else "", "Note": c["note"]} for c in s.columns()]
    pd.DataFrame(rows).to_csv(OUT / "data_dictionary.csv", index=False)

    print(f"wrote {len(list(OUT.glob('*.csv')))} tables to {OUT}")
    print(f"default model: {s.default_reason}")


if __name__ == "__main__":
    main()
