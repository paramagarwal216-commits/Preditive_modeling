"""Live retraining (fast mode) in a background thread, streamed as Server-Sent Events."""

import queue
import threading
import uuid

from .state import state, tm

FAST_REPEATS, FAST_N_ITER = 2, 8          # same as train_models.py --fast
ORDER = ["majority_baseline", "logistic_regression", "random_forest", "xgboost"]

jobs = {}
_lock = threading.Lock()


def running():
    return any(j["status"] == "running" for j in jobs.values())


def start(models):
    names = [m for m in ORDER if m in models]
    job = uuid.uuid4().hex[:12]
    q = queue.Queue()
    jobs[job] = {"status": "running", "queue": q}
    threading.Thread(target=_run, args=(job, names, q), daemon=True).start()
    return job


def _run(job, names, q):
    try:
        with _lock:
            specs = tm.make_models(state.y)
            results = dict(state.cv_results)
            folds = dict(state.fold_auc)
            for name in names:
                pipe, space = specs[name]
                summary, aucs = tm.evaluate_model(
                    name, pipe, space, state.X, state.y, FAST_REPEATS, FAST_N_ITER,
                    on_fold=lambda e: q.put({"event": "fold", "data": e}))
                results[name] = summary
                folds[name] = [round(a, 4) for a in aucs]
                q.put({"event": "model_done", "data": {"model": name, "summary": summary}})
            default, reason = tm.pick_default(results)
            # The scoreboard now shows this run's cross-validation results.
            state.cv_results, state.fold_auc = results, folds
            state.default_model, state.default_reason = default, reason
            q.put({"event": "done", "data": {"default_model": default, "reason": reason}})
        jobs[job]["status"] = "done"
    except Exception as exc:  # surfaced to the client as an error event
        jobs[job]["status"] = "error"
        q.put({"event": "error", "data": {"message": str(exc)}})
