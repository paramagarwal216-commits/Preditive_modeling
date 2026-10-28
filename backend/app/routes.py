"""All API endpoints (spec Section 4)."""

import asyncio
import json
import queue
from typing import Literal, Optional

import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field

from . import analytics as an
from . import training
from .state import BASE, state, tm

BASE_DIR = BASE.parent                         # project root (backend's parent)

router = APIRouter(prefix="/api")


class Filters(BaseModel):
    age: Optional[list[float]] = None
    family: Optional[list[float]] = None
    gender: Optional[list[str]] = None
    marital: Optional[list[str]] = None
    occupation: Optional[list[str]] = None
    income: Optional[list[str]] = None
    education: Optional[list[str]] = None
    customer: Optional[list[str]] = None      # descriptive only, never a model input
    feedback: Optional[list[str]] = None      # descriptive only, never a model input


class FilterBody(BaseModel):
    filters: Filters = Field(default_factory=Filters)


class SegmentBody(FilterBody):
    by: Literal["age", "family", "gender", "marital", "occupation", "income", "education"]
    measure: Literal["output", "feedback"] = "output"
    by2: Optional[Literal["age", "family", "gender", "marital", "occupation", "income",
                          "education"]] = None


class RowsBody(FilterBody):
    view: Literal["raw", "clean"] = "clean"
    page: int = 1
    size: int = 25
    sort: Optional[str] = None          # "column:asc" | "column:desc"


class TrainBody(BaseModel):
    models: list[str]


class PredictBody(BaseModel):
    model: Literal["logistic_regression", "random_forest", "xgboost"]
    profile: dict
    threshold: float = 0.5
    tree: Optional[int] = None


def _records(df):
    return json.loads(df.to_json(orient="records"))


def _filtered(body):
    return an.apply_filters(state.df, body.filters.model_dump(exclude_none=True))


def _levels():
    # Descriptive columns are included for filters; profile validation only reads features.
    return {c: tm.ORDINAL[c] if c in tm.ORDINAL else sorted(state.df[c].unique().tolist())
            for c in tm.NOMINAL + list(tm.ORDINAL) + ["Customer Type", "Feedback"]}


def _ranges():
    return {c: [float(state.df[c].min()), float(state.df[c].max())] for c in tm.NUMERIC}


@router.get("/meta")
def meta():
    raw = state.raw
    return {
        "rows_raw": len(raw), "rows_clean": len(state.df),
        "columns": state.columns(),
        "levels": _levels(), "numeric_ranges": _ranges(),
        "features": tm.FEATURES,
        # Starting profile for the Predictor: median numbers, most common levels.
        "profile_defaults": {c: (int(state.df[c].median()) if c in tm.NUMERIC
                                 else state.df[c].mode().iloc[0]) for c in tm.FEATURES},
        "clean_log": state.clean_log, "target_gate": state.gate,
        "default_model": state.default_model, "default_reason": state.default_reason,
        "file": "onlinefoods.csv",
    }


@router.post("/overview")
def overview(body: FilterBody):
    df = _filtered(body)
    y = an.outcome(df, "output")
    n = len(df)
    by_occ = an.group_rate(df, "occupation", "output", state.df)
    by_inc = an.group_rate(df, "income", "output", state.df)
    raw = state.raw
    missing_pct = float(raw.isna().to_numpy().mean() * 100)
    rate = float(y.mean()) if n else None
    return {
        "kpis": {"n": n, "positive_rate": rate,
                 "duplicates_removed": state.clean_log["exact_duplicates"],
                 "missing_pct": missing_pct, "rows_raw": len(raw)},
        "outcome": [{"label": "Yes", "n": int(y.sum())}, {"label": "No", "n": int(n - y.sum())}],
        "by_occupation": by_occ, "by_income": by_inc,
        "findings": an.findings(n, rate, by_occ, by_inc) if n else [],
    }


@router.post("/dashboard")
def dashboard(body: FilterBody):
    df = _filtered(body)
    out = an.dashboard(df, state.df)
    default = state.default_model
    out["profile"] = an.profile(df, state.columns())
    out["models"] = {
        "default_model": default, "default_reason": state.default_reason,
        "roc_auc": {m: state.cv_results[m]["roc_auc"] for m in state.cv_results},
        "fold_auc": state.fold_auc.get(default, []),
        "n_folds": state.cv_results[default]["n_outer_folds"],
    }
    out["source"] = {
        "name": "Online Food Ordering Dataset (Kaggle, srisyra02)",
        "file": "onlinefoods.csv", "place": "Bangalore, India",
        "rows_raw": len(state.raw), "rows_clean": len(state.df),
        "columns_raw": len(state.raw.columns), "duplicates": state.clean_log["exact_duplicates"],
        "missing_cells": int(state.raw.isna().to_numpy().sum()),
        "target": tm.TARGET, "positive_class": tm.POSITIVE_CLASS, "features": tm.FEATURES,
        "loaded_at": state.loaded_at,
    }
    return out


_report_cache = {}


@router.get("/report")
def report():
    """Everything the teacher-facing Project Report page needs, on the full cleaned data."""
    key = id(state.cv_results)                 # recompute after a retrain swaps results
    if key not in _report_cache:
        df = state.df
        tests = an.all_tests(df, "output", df)
        groups = {a: an.group_rate(df, a, "output", df) for a in an.ATTRIBUTES}
        cv = {m: {k: v for k, v in r.items() if k != "best_params_per_fold"} for m, r in state.cv_results.items()}
        models = {}
        for m, e in state.explanations.items():
            models[m] = {"top_features": list(e["mean_abs_shap"].items())[:5],
                         "coefficients": list(e.get("coefficients", {}).items())[:5],
                         "confusion": state.oof[m]["confusion"], "oof_roc_auc": state.oof[m]["roc_auc"]}
        y = an.outcome(df, "output")
        _report_cache.clear()
        _report_cache[key] = {
            "overall": {"n": len(df), "yes": int(y.sum()), "rate": float(y.mean())},
            "tests": tests, "groups": groups, "cv_results": cv, "models": models,
            "default_model": state.default_model, "default_reason": state.default_reason,
            "clean_log": state.clean_log, "target_gate": state.gate,
            "features": tm.FEATURES, "rows_raw": len(state.raw),
            "powerbi_path": str((BASE_DIR / "powerbi" / "FoodOrdering.pbip").resolve()),
        }
    return _report_cache[key]


@router.post("/segments")
def segments(body: SegmentBody):
    df = _filtered(body)
    out = {"rows": an.group_rate(df, body.by, body.measure, state.df),
           "overall": {"n": len(df),
                       "rate": float(an.outcome(df, body.measure).mean()) if len(df) else None},
           "test": an.segment_test(df, body.by, body.measure, state.df) if len(df) else None,
           "age_hist": an.age_histogram(df) if len(df) else []}
    if body.by2 and body.by2 != body.by:
        out["heatmap"] = an.heatmap(df, body.by, body.by2, body.measure, state.df)
    return out


BANGALORE = {"lat": (12.7, 13.3), "lon": (77.3, 77.9)}


@router.post("/geo")
def geo(body: FilterBody):
    df = _filtered(body)
    valid = (df["latitude"].between(*BANGALORE["lat"])
             & df["longitude"].between(*BANGALORE["lon"]))
    d = df[valid]
    y = an.outcome(d, "output")
    pins = []
    for pin, g in d.groupby("Pin code"):
        k, n = int(y[g.index].sum()), len(g)
        lo, hi = an.wilson(k, n)
        pins.append({"pin": int(pin), "n": n, "positive": k, "rate": k / n,
                     "ci_low": lo, "ci_high": hi,
                     "lat": float(g["latitude"].median()), "lon": float(g["longitude"].median())})
    rng = np.random.default_rng(42)
    jitter = rng.uniform(-0.005, 0.005, size=(len(d), 2))
    points = [{"lat": float(a + j[0]), "lon": float(b + j[1]), "y": int(v)}
              for a, b, v, j in zip(d["latitude"], d["longitude"], y, jitter)]
    return {"pins": pins, "points": points,
            "quality": {"valid": int(valid.sum()), "invalid": int((~valid).sum()),
                        "pins": len(pins), "pins_n5": sum(p["n"] >= 5 for p in pins)}}


@router.post("/rows")
def rows(body: RowsBody):
    f = body.filters.model_dump(exclude_none=True)
    if body.view == "raw":
        idx = an.apply_filters(state.raw_stripped, f).index
        df = state.raw.loc[idx]
    else:
        df = an.apply_filters(state.df, f)
    if body.sort:
        col, _, direction = body.sort.rpartition(":")
        if col in df.columns:
            df = df.sort_values(col, ascending=direction != "desc", kind="stable")
    size = max(1, min(body.size, 200))
    start = (max(body.page, 1) - 1) * size
    return {"rows": _records(df.iloc[start:start + size]), "total": len(df),
            "columns": list(df.columns)}


@router.post("/export")
def export(body: FilterBody):
    csv = _filtered(body).to_csv(index=False)
    return Response(csv, media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="onlinefoods_filtered.csv"'})


@router.get("/models")
def models():
    return {"cv_results": state.cv_results, "fold_auc": state.fold_auc,
            "explanations": state.explanations, "oof": state.oof,
            "default_model": state.default_model, "default_reason": state.default_reason,
            "leak_suspects": state.gate["leak_suspects"]}


@router.post("/train")
def train(body: TrainBody):
    names = [m for m in body.models if m in training.ORDER]
    if not names:
        raise HTTPException(422, {"message": "Choose at least one model",
                                  "allowed": training.ORDER})
    if training.running():
        raise HTTPException(409, {"message": "A training job is already running"})
    return {"job": training.start(names)}


@router.get("/train/{job}/events")
async def train_events(job: str):
    if job not in training.jobs:
        raise HTTPException(404, {"message": "Unknown job"})
    q = training.jobs[job]["queue"]

    async def stream():
        idle = 0.0
        while True:
            try:
                ev = q.get_nowait()
            except queue.Empty:
                await asyncio.sleep(0.1)
                idle += 0.1
                if idle >= 15:
                    idle = 0.0
                    yield ": keep-alive\n\n"
                continue
            idle = 0.0
            yield f"event: {ev['event']}\ndata: {json.dumps(ev['data'], default=str)}\n\n"
            if ev["event"] in ("done", "error"):
                return

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _validate_profile(profile):
    errors = {}
    clean = {}
    ranges, levels = _ranges(), _levels()
    for col in tm.FEATURES:
        v = profile.get(col)
        if col in ranges:
            lo, hi = ranges[col]
            try:
                num = float(v)
            except (TypeError, ValueError):
                num = None
            if num is None or not (lo <= num <= hi) or num != int(num):
                errors[col] = {"got": v, "allowed": {"min": lo, "max": hi, "integer": True}}
            else:
                clean[col] = int(num)
        else:
            if v not in levels[col]:
                errors[col] = {"got": v, "allowed": levels[col]}
            else:
                clean[col] = v
    unknown = sorted(set(profile) - set(tm.FEATURES))
    if unknown:
        errors["_unknown_fields"] = {"got": unknown, "allowed": tm.FEATURES}
    if errors:
        raise HTTPException(422, {"message": "Invalid profile", "errors": errors})
    return clean


@router.post("/predict")
def predict(body: PredictBody):
    if not 0 < body.threshold < 1:
        raise HTTPException(422, {"message": "threshold must be between 0 and 1"})
    profile = _validate_profile(body.profile)
    pipe = state.models[body.model]
    one = tm.explain_one(pipe, state.background, profile)
    if body.model == "random_forest":
        n_trees = len(pipe.named_steps["model"].estimators_)
        walk = tm.rf_walkthrough(pipe, profile, show_tree=(body.tree or 0) % n_trees)
    else:
        walk = tm.WALKTHROUGHS[body.model](pipe, profile)
    p = one["probability_positive"]
    auc = state.cv_results[body.model]["roc_auc"]
    return {"model": body.model, "probability": p, "predicted": "Yes" if p >= body.threshold else "No",
            "threshold": body.threshold, "shap_top5": one["top_contributions"],
            "walkthrough": walk, "model_auc": auc, "n_train": len(state.df)}
