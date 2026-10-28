"""Filters, group rates with Wilson intervals, and association tests."""

import numpy as np
import pandas as pd
from scipy.special import gammaln
from scipy.stats import chi2_contingency, fisher_exact
from statsmodels.stats.multitest import multipletests
from statsmodels.stats.proportion import proportion_confint

from .state import tm

# Filter key -> column. Every analytics endpoint takes the same object.
RANGE_COLS = {"age": "Age", "family": "Family size"}
LIST_COLS = {"gender": "Gender", "marital": "Marital Status", "occupation": "Occupation",
             "income": "Monthly Income", "education": "Educational Qualifications"}
ATTRIBUTES = {"age": "Age", "family": "Family size", **LIST_COLS}
# Descriptive-only columns can be filtered on, but are never tested or modelled.
FILTER_LIST_COLS = {**LIST_COLS, "customer": "Customer Type", "feedback": "Feedback"}

AGE_BIN = 3          # Age is grouped into 3-year bands for rates and tests
HIST_BIN = 2         # Age histogram uses 2-year bins


def apply_filters(df, f):
    mask = pd.Series(True, index=df.index)
    for key, col in RANGE_COLS.items():
        r = f.get(key)
        if r:
            mask &= df[col].between(r[0], r[1])
    for key, col in FILTER_LIST_COLS.items():
        levels = f.get(key)
        if levels and col in df.columns:
            mask &= df[col].isin(levels)
    return df[mask]


def outcome(df, measure):
    if measure == "feedback":
        return (df["Feedback"] == "Positive").astype(int)
    return (df[tm.TARGET] == tm.POSITIVE_CLASS).astype(int)


def wilson(k, n):
    if n == 0:
        return None, None
    lo, hi = proportion_confint(k, n, alpha=0.05, method="wilson")
    return float(lo), float(hi)


def age_band(age, lo):
    start = lo + ((age - lo) // AGE_BIN) * AGE_BIN
    return f"{start}–{start + AGE_BIN - 1}"


def grouping(df, by, full_df):
    """Return (Series of level labels, ordered list of all levels)."""
    col = ATTRIBUTES[by]
    if by == "age":
        lo = int(full_df["Age"].min())
        hi = int(full_df["Age"].max())
        levels = [age_band(a, lo) for a in range(lo, hi + 1, AGE_BIN)]
        return df["Age"].map(lambda a: age_band(int(a), lo)), levels
    if by == "family":
        levels = [str(v) for v in sorted(full_df[col].unique())]
        return df[col].astype(str), levels
    if col in tm.ORDINAL:
        return df[col], tm.ORDINAL[col]
    return df[col], sorted(full_df[col].unique().tolist())


def group_rate(df, by, measure, full_df):
    labels, levels = grouping(df, by, full_df)
    y = outcome(df, measure)
    rows = []
    for level in levels:
        sel = labels == level
        n = int(sel.sum())
        if n == 0:
            continue
        k = int(y[sel].sum())
        lo, hi = wilson(k, n)
        rows.append({"level": level, "n": n, "positive": k, "rate": k / n,
                     "ci_low": lo, "ci_high": hi, "small": n < 10})
    return rows


def _freeman_halton_mc(labels, y, n_perm=10000, seed=42):
    """Fisher's exact test for an r x 2 table, Monte Carlo p-value."""
    codes, _ = pd.factorize(labels)
    y = np.asarray(y)
    r, n = codes.max() + 1, len(y)

    def log_prob(tables):
        # Table probability under fixed margins: only the cells vary between tables.
        return -gammaln(tables + 1).sum(axis=(-1, -2))

    obs = np.zeros((r, 2))
    np.add.at(obs, (codes, y), 1)
    rng = np.random.default_rng(seed)
    perm_y = np.array([rng.permutation(y) for _ in range(n_perm)])
    tables = np.zeros((n_perm, r, 2))
    for g in range(r):
        in_g = codes == g
        ones = perm_y[:, in_g].sum(axis=1)
        tables[:, g, 1] = ones
        tables[:, g, 0] = in_g.sum() - ones
    p = (np.sum(log_prob(tables) <= log_prob(obs) + 1e-9) + 1) / (n_perm + 1)
    return float(p)


def association_test(df, by, measure, full_df):
    labels, _ = grouping(df, by, full_df)
    y = outcome(df, measure)
    table = pd.crosstab(labels, y)
    table = table.loc[table.sum(axis=1) > 0]
    if table.shape[0] < 2 or table.shape[1] < 2:
        return {"name": "Not testable", "stat": None, "stat_label": None, "p": None,
                "reason": "Needs at least two groups and both outcomes in the selection"}
    chi2, p, dof, expected = chi2_contingency(table, correction=False)
    if (expected < 5).any():
        if table.shape == (2, 2):
            odds, p = fisher_exact(table.to_numpy())
            return {"name": "Fisher's exact test", "stat": float(odds),
                    "stat_label": "odds ratio", "p": float(p)}
        p = _freeman_halton_mc(labels, y)
        return {"name": "Fisher's exact test (Freeman–Halton, 10,000 Monte Carlo draws)",
                "stat": None, "stat_label": None, "p": p}
    return {"name": f"Chi-square test of independence (df = {dof})", "stat": float(chi2),
            "stat_label": "χ²", "p": float(p)}


def all_tests(df, measure, full_df):
    """Every feature attribute's test, with Holm adjustment across all 7."""
    tests = {a: association_test(df, a, measure, full_df) for a in ATTRIBUTES}
    testable = [a for a, t in tests.items() if t["p"] is not None]
    if testable:
        adj = multipletests([tests[a]["p"] for a in testable], method="holm")[1]
        for a, q in zip(testable, adj):
            tests[a]["p_holm"] = float(q)
    for t in tests.values():
        t.setdefault("p_holm", None)
        t["n_tests"] = len(testable)
    return tests


def segment_test(df, by, measure, full_df):
    """Test for `by`, with Holm adjustment across all 7 feature attributes."""
    return all_tests(df, measure, full_df)[by]


def age_histogram(df):
    lo = int(df["Age"].min()) if len(df) else 0
    lo -= lo % HIST_BIN
    hi = int(df["Age"].max()) if len(df) else 0
    y = outcome(df, "output")
    bins = []
    for start in range(lo, hi + 1, HIST_BIN):
        sel = df["Age"].between(start, start + HIST_BIN - 1)
        bins.append({"bin": f"{start}–{start + HIST_BIN - 1}", "yes": int(y[sel].sum()),
                     "no": int((1 - y[sel]).sum())})
    return bins


def heatmap(df, by, by2, measure, full_df):
    l1, levels1 = grouping(df, by, full_df)
    l2, levels2 = grouping(df, by2, full_df)
    y = outcome(df, measure)
    cells = []
    for a in levels1:
        for b in levels2:
            sel = (l1 == a) & (l2 == b)
            n = int(sel.sum())
            cells.append({"x": a, "y": b, "n": n,
                          "rate": float(y[sel].mean()) if n >= 5 else None})
    return {"x_levels": levels1, "y_levels": levels2, "cells": cells}


def findings(n, positive_rate, by_occupation, by_income):
    out = [{"text": f"{positive_rate * 100:.1f}% of respondents in this selection say Yes "
                    f"(n = {n})", "ref": "outcome"}]
    for rows, label, ref in [(by_occupation, "occupation", "by_occupation"),
                             (by_income, "income band", "by_income")]:
        big = [r for r in rows if not r["small"]]
        if len(big) < 2:
            continue
        hi = max(big, key=lambda r: r["rate"])
        lo = min(big, key=lambda r: r["rate"])
        out.append({"text": f"{hi['level']} has the highest Yes rate by {label}: "
                            f"{hi['rate'] * 100:.1f}% (n = {hi['n']})", "ref": ref})
        out.append({"text": f"{lo['level']} has the lowest Yes rate by {label}: "
                            f"{lo['rate'] * 100:.1f}% (n = {lo['n']})", "ref": ref})
    return out[:5]


# ---------------------------------------------------------------------------
# Dashboard: one payload for the immersive home page
# ---------------------------------------------------------------------------
def _rate(s):
    return float(s.mean()) if len(s) else None


def distribution(df, col, full_df):
    """Count, Yes count and Yes rate for every level of `col` (levels from the full data)."""
    levels = tm.ORDINAL.get(col) or sorted(full_df[col].unique().tolist())
    y = outcome(df, "output")
    rows = []
    for lv in levels:
        sel = df[col] == lv
        n = int(sel.sum())
        rows.append({"level": str(lv), "n": n, "yes": int(y[sel].sum()),
                     "rate": float(y[sel].mean()) if n else None})
    return rows


def dashboard(df, full_df):
    y, fb = outcome(df, "output"), outcome(df, "feedback")
    y_all, fb_all = outcome(full_df, "output"), outcome(full_df, "feedback")
    lo, hi = int(full_df["Age"].min()), int(full_df["Age"].max())
    by_age = []
    for a in range(lo, hi + 1):
        sel = df["Age"] == a
        by_age.append({"age": a, "n": int(sel.sum()), "yes": int(y[sel].sum()),
                       "positive": int(fb[sel].sum())})
    pins = (df.assign(_y=y).groupby("Pin code")
            .agg(n=("_y", "size"), yes=("_y", "sum"))
            .sort_values(["n", "yes"], ascending=False).head(5))
    cols = ["Gender", "Marital Status", "Occupation", "Monthly Income",
            "Educational Qualifications", "Family size", "Customer Type", "Feedback", "Output"]
    return {
        "n": len(df), "n_all": len(full_df),
        "kpis": {
            "yes_rate": {"value": _rate(y), "all": _rate(y_all)},
            "feedback_rate": {"value": _rate(fb), "all": _rate(fb_all)},
            "median_age": {"value": float(df["Age"].median()) if len(df) else None,
                           "all": float(full_df["Age"].median())},
        },
        "by_age": by_age,
        "dist": {c: distribution(df, c, full_df) for c in cols},
        "top_pins": [{"pin": int(p), "n": int(r.n), "yes": int(r.yes), "rate": r.yes / r.n}
                     for p, r in pins.iterrows()],
    }


ID_LIKE = {"Pin code"}       # numeric codes summarised as categories


def profile(df, dictionary):
    """Per-column summary of the current selection, merged with the data dictionary."""
    out = []
    for d in dictionary:
        col = d["column"].strip()
        if col not in df.columns:            # the dropped unnamed column
            out.append({**d, "unique": None, "summary": None, "top": None})
            continue
        s = df[col]
        item = {**d, "unique": int(s.nunique())}
        if pd.api.types.is_numeric_dtype(s) and col not in ID_LIKE:
            q = s.quantile([0.25, 0.5, 0.75]) if len(s) else None
            item["summary"] = None if q is None else {
                "min": float(s.min()), "q1": float(q[0.25]), "median": float(q[0.5]),
                "mean": float(s.mean()), "q3": float(q[0.75]), "max": float(s.max()),
                "std": float(s.std()) if len(s) > 1 else 0.0}
            item["top"] = None
        else:
            counts = s.astype(str).value_counts()
            order = tm.ORDINAL.get(col)
            if order:
                counts = counts.reindex(order).fillna(0).astype(int)
            item["summary"] = None
            item["top"] = [{"level": str(k), "n": int(v)} for k, v in counts.head(8).items()]
        out.append(item)
    return out
