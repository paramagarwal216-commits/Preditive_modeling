"""In-memory state: cleaned data, saved models, metadata and out-of-fold curves."""

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import calibration_curve
from sklearn.metrics import (average_precision_score, precision_recall_curve,
                             roc_auc_score, roc_curve)
from sklearn.model_selection import StratifiedKFold, cross_val_predict

BASE = Path(__file__).resolve().parents[1]
DATA = BASE / "data" / "onlinefoods.csv"
ARTIFACTS = BASE / "artifacts"
sys.path.insert(0, str(BASE / "ml"))

import train_models as tm  # noqa: E402

MODEL_NAMES = ["logistic_regression", "random_forest", "xgboost"]

ROLES = {
    "Age": ("numeric", "Numeric feature", "Model input"),
    "Family size": ("numeric", "Numeric feature", "Model input"),
    "Gender": ("category", "Nominal feature (one-hot)", "Model input"),
    "Marital Status": ("category", "Nominal feature (one-hot)", "Model input"),
    "Occupation": ("category", "Nominal feature (one-hot)", "Model input"),
    "Monthly Income": ("ordered category", "Ordinal feature", "Encoded low to high"),
    "Educational Qualifications": ("ordered category", "Ordinal feature",
                                   "Encoded low to high"),
    "Output": ("category", "Target", "Positive class = Yes"),
    "Feedback": ("category", "Charts only", "Recorded after the order; never a model input"),
    "Customer Type": ("category", "Descriptive only",
                      "Not in the original spec; shown in charts and filters, never a model input"),
    "latitude": ("numeric", "Geography only", "Used for the map"),
    "longitude": ("numeric", "Geography only", "Used for the map"),
    "Pin code": ("numeric", "Geography only", "Used for the map"),
}


class State:
    def load(self):
        self.loaded_at = pd.Timestamp.now().strftime("%d %b %Y, %H:%M")
        self.raw = pd.read_csv(DATA)
        self.df, self.X, self.y, self.clean_log = tm.load_and_clean(DATA)
        self.df = self.df.reset_index(drop=True)
        self.X = self.X.reset_index(drop=True)
        self.y = self.y.reset_index(drop=True)
        self.gate = tm.target_gate(self.df, self.y)

        # Raw view with stripped strings, so the same filters work on raw rows.
        self.raw_stripped = self.raw.copy()
        self.raw_stripped.columns = [c.strip() for c in self.raw_stripped.columns]
        for c in self.raw_stripped.columns:
            if not pd.api.types.is_numeric_dtype(self.raw_stripped[c]):
                self.raw_stripped[c] = self.raw_stripped[c].astype(str).str.strip()

        self.metadata = json.loads((ARTIFACTS / "metadata.json").read_text())
        self.explanations = json.loads((ARTIFACTS / "explanations.json").read_text())
        self.models = {m: joblib.load(ARTIFACTS / f"{m}.joblib") for m in MODEL_NAMES}
        self.background = pd.read_csv(ARTIFACTS / "background.csv")
        self.cv_results = self.metadata["cv_results"]
        self.fold_auc = self.metadata["cv_fold_roc_auc"]
        self.default_model = self.metadata["default_model"]
        self.default_reason = self.metadata["default_reason"]

        oof_path = ARTIFACTS / "oof.json"
        if not oof_path.exists():
            oof_path.write_text(json.dumps(self._compute_oof()))
        self.oof = json.loads(oof_path.read_text())

    def _compute_oof(self):
        cv = StratifiedKFold(5, shuffle=True, random_state=42)
        y = self.y.to_numpy()
        out = {}
        for name, model in self.models.items():
            p = cross_val_predict(clone(model), self.X, self.y, cv=cv,
                                  method="predict_proba")[:, 1]
            fpr, tpr, _ = roc_curve(y, p)
            prec, rec, _ = precision_recall_curve(y, p)
            obs, pred = calibration_curve(y, p, n_bins=10, strategy="uniform")
            bins = np.searchsorted(np.linspace(0, 1, 11)[1:-1], p)   # same bins as sklearn
            counts = [int(c) for c in np.bincount(bins, minlength=10) if c > 0]

            def confusion(t):
                yp = (p >= t).astype(int)
                return {"threshold": round(float(t), 2),
                        "tn": int(((yp == 0) & (y == 0)).sum()),
                        "fp": int(((yp == 1) & (y == 0)).sum()),
                        "fn": int(((yp == 0) & (y == 1)).sum()),
                        "tp": int(((yp == 1) & (y == 1)).sum())}

            out[name] = {
                "roc_auc": round(float(roc_auc_score(y, p)), 4),
                "pr_auc": round(float(average_precision_score(y, p)), 4),
                "prevalence": round(float(y.mean()), 4),
                "roc": [{"fpr": round(float(a), 4), "tpr": round(float(b), 4)}
                        for a, b in zip(fpr, tpr)],
                "pr": [{"recall": round(float(a), 4), "precision": round(float(b), 4)}
                       for a, b in zip(rec, prec)],
                "calibration": [{"predicted": round(float(a), 4), "observed": round(float(b), 4),
                                 "n": n} for a, b, n in zip(pred, obs, counts)],
                "confusion": confusion(0.5),
                "confusion_by_threshold": [confusion(t) for t in np.arange(0.05, 0.951, 0.05)],
            }
        return out

    def columns(self):
        """Data dictionary rows."""
        rows = []
        for raw_col in self.raw.columns:
            col = raw_col.strip()
            s = self.raw_stripped[col]
            missing = int(self.raw[raw_col].isna().sum())
            levels = None
            if not pd.api.types.is_numeric_dtype(s):
                levels = sorted(s[self.raw[raw_col].notna()].unique().tolist())
            if col in tm.ORDINAL:
                levels = tm.ORDINAL[col]
            if col in ROLES:
                typ, role, note = ROLES[col]
            elif col == "" or col.startswith("Unnamed"):
                agree = self.clean_log.get("unnamed_vs_output_agreement")
                typ, role = "category", "Dropped"
                note = f"Undocumented; agrees with Output on {agree * 100:.1f}% of rows"
            else:
                typ = "numeric" if pd.api.types.is_numeric_dtype(s) else "category"
                role, note = "Not used", "Not described in the spec; never a model input"
            rows.append({"column": raw_col, "type": typ, "role": role, "levels": levels,
                         "missing": missing, "note": note})
        return rows


state = State()
