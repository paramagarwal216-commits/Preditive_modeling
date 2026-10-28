"""
Generate the Power BI Project (FoodOrdering.pbip) from the exported CSV tables.

Run after export_data.py:
    .venv\\Scripts\\python.exe ..\\powerbi\\build_pbip.py
Then open powerbi/FoodOrdering.pbip in Power BI Desktop.
"""

import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
NAME = "FoodOrdering"
SM, RP = HERE / f"{NAME}.SemanticModel", HERE / f"{NAME}.Report"

# ---------------------------------------------------------------------------
# Semantic model
# ---------------------------------------------------------------------------
# table name -> (csv file, {column: type}); types: int64 | double | string
TABLES = {
    "Respondents": ("respondents.csv", {
        "Respondent ID": "int64", "Age": "int64", "Gender": "string", "Marital Status": "string",
        "Occupation": "string", "Monthly Income": "string", "Educational Qualifications": "string",
        "Family size": "int64", "Customer Type": "string", "latitude": "double", "longitude": "double",
        "Pin code": "int64", "Output": "string", "Feedback": "string", "Income Order": "int64",
        "Education Order": "int64", "Age Band": "string", "Says Yes": "int64", "Positive Feedback": "int64"}),
    "Model Scores": ("model_scores.csv", {
        "Model": "string", "Model Order": "int64", "Metric": "string", "Mean": "double",
        "CI Low": "double", "CI High": "double", "Folds": "int64", "Is Default": "int64"}),
    "Fold Scores": ("fold_scores.csv", {"Model": "string", "Fold": "int64", "ROC-AUC": "double"}),
    "Feature Importance": ("feature_importance.csv", {
        "Model": "string", "Feature": "string", "Mean Abs SHAP": "double", "Importance Share": "double",
        "LR Coefficient": "double"}),
    "Confusion": ("confusion.csv", {"Model": "string", "Actual": "string", "Predicted": "string", "Count": "int64"}),
    "Association Tests": ("association_tests.csv", {
        "Attribute": "string", "Test": "string", "Statistic": "double", "p": "double", "Holm p": "double",
        "Significant (5%)": "string"}),
    "Data Dictionary": ("data_dictionary.csv", {
        "Column": "string", "Type": "string", "Role": "string", "Missing": "int64", "Levels": "string", "Note": "string"}),
}
SORT_BY = {("Respondents", "Monthly Income"): "Income Order",
           ("Respondents", "Educational Qualifications"): "Education Order",
           ("Model Scores", "Model"): "Model Order"}
FORMATS = {"latitude": "0.0000", "longitude": "0.0000", "Mean": "0.000", "CI Low": "0.000", "CI High": "0.000",
           "ROC-AUC": "0.000", "Mean Abs SHAP": "0.0000", "Importance Share": "0.0%", "LR Coefficient": "0.000",
           "Statistic": "0.00", "p": "0.0000", "Holm p": "0.0000"}

MEASURES = {
    "Respondents": [
        ("Respondents", "COUNTROWS ( Respondents )", "#,0"),
        ("Say Yes", "SUM ( Respondents[Says Yes] )", "#,0"),
        ("Yes Rate", "DIVIDE ( [Say Yes], [Respondents] )", "0.0%"),
        ("Positive Feedback Rate", "DIVIDE ( SUM ( Respondents[Positive Feedback] ), [Respondents] )", "0.0%"),
        ("Average Age", "AVERAGE ( Respondents[Age] )", "0.0"),
        ("Average Family Size", "AVERAGE ( Respondents[Family size] )", "0.0"),
        ("Yes Rate vs All", "[Yes Rate] - CALCULATE ( [Yes Rate], ALL ( Respondents ) )", "+0.0%;-0.0%;0.0%"),
        ("Avg Latitude", "AVERAGE ( Respondents[latitude] )", "0.0000"),
        ("Avg Longitude", "AVERAGE ( Respondents[longitude] )", "0.0000"),
    ],
    "Model Scores": [
        ("Score", "MAX ( 'Model Scores'[Mean] )", "0.000"),
        ("ROC-AUC Score", "CALCULATE ( MAX ( 'Model Scores'[Mean] ), 'Model Scores'[Metric] = \"ROC-AUC\" )", "0.000"),
        ("Default Model", "CALCULATE ( MAX ( 'Model Scores'[Model] ), 'Model Scores'[Is Default] = 1 )", None),
    ],
    "Fold Scores": [("Fold ROC-AUC", "AVERAGE ( 'Fold Scores'[ROC-AUC] )", "0.000")],
    "Feature Importance": [("Importance", "SUM ( 'Feature Importance'[Importance Share] )", "0.0%")],
    "Confusion": [("Predictions", "SUM ( Confusion[Count] )", "#,0")],
}

M_TYPE = {"int64": "Int64.Type", "double": "type number", "string": "type text"}


def m_expr(file, cols):
    types = ", ".join(f'{{"{c}", {M_TYPE[t]}}}' for c, t in cols.items())
    return [
        "let",
        f'    Source = Csv.Document(File.Contents(DataFolder & "{file}"), [Delimiter = ",", Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),',
        "    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),",
        f"    Typed = Table.TransformColumnTypes(Promoted, {{{types}}}, \"en-US\")",
        "in",
        "    Typed",
    ]


def model_bim():
    tables = []
    for t, (file, cols) in TABLES.items():
        columns = []
        for c, typ in cols.items():
            col = {"name": c, "dataType": typ, "sourceColumn": c, "summarizeBy": "none"}
            if (t, c) in SORT_BY:
                col["sortByColumn"] = SORT_BY[(t, c)]
            if c in FORMATS:
                col["formatString"] = FORMATS[c]
            if c.endswith("Order") or c in ("Says Yes", "Positive Feedback", "Is Default", "Respondent ID"):
                col["isHidden"] = True
            columns.append(col)
        table = {"name": t, "columns": columns,
                 "partitions": [{"name": t, "mode": "import", "source": {"type": "m", "expression": m_expr(file, cols)}}]}
        if t in MEASURES:
            table["measures"] = [{"name": n, "expression": e, **({"formatString": f} if f else {})}
                                 for n, e, f in MEASURES[t]]
        tables.append(table)
    folder = str(DATA) + "\\"
    return {
        "compatibilityLevel": 1550,
        "model": {
            "culture": "en-US",
            "dataAccessOptions": {"legacyRedirects": True, "returnErrorValuesAsNull": True},
            "defaultPowerBIDataSourceVersion": "powerBI_V3",
            "sourceQueryCulture": "en-US",
            "tables": tables,
            "expressions": [{
                "name": "DataFolder", "kind": "m",
                "expression": [f'"{folder}" meta [IsParameterQuery = true, Type = "Text", IsParameterQueryRequired = true]'],
            }],
            "annotations": [{"name": "PBI_QueryOrder", "value": json.dumps(["DataFolder", *TABLES])}],
        },
    }


# ---------------------------------------------------------------------------
# Report (PBIR-legacy report.json)
# ---------------------------------------------------------------------------
def lit(v):
    return {"expr": {"Literal": {"Value": v}}}


class Page:
    def __init__(self, name, title):
        self.name, self.title, self.visuals, self.z = name, title, [], 0

    def add(self, cfg_visual, x, y, w, h):
        self.z += 1
        vid = f"{self.name}_v{self.z}"
        cfg = {"name": vid, "layouts": [{"id": 0, "position": {"x": x, "y": y, "z": self.z * 1000, "width": w, "height": h}}],
               "singleVisual": cfg_visual}
        self.visuals.append({"x": x, "y": y, "z": self.z * 1000, "width": w, "height": h,
                             "config": json.dumps(cfg), "filters": "[]"})

    def section(self, idx):
        return {"name": self.name, "displayName": self.title, "displayOption": 1, "width": 1280, "height": 720,
                "ordinal": idx, "config": "{}", "filters": "[]", "visualContainers": self.visuals}


def visual(vtype, roles, title=None, order=None, objects=None):
    """roles: {role: [(entity, property, 'col'|'measure'), ...]}; order: (entity, prop, kind, desc)."""
    aliases, frm, select, proj = {}, [], [], {}

    def src(entity):
        if entity not in aliases:
            aliases[entity] = f"t{len(aliases)}"
            frm.append({"Name": aliases[entity], "Entity": entity, "Type": 0})
        return {"SourceRef": {"Source": aliases[entity]}}

    def field(entity, prop, kind):
        key = "Measure" if kind == "measure" else "Column"
        return {key: {"Expression": src(entity), "Property": prop}}

    seen = set()
    for role, fields in roles.items():
        proj[role] = []
        for entity, prop, kind in fields:
            ref = f"{entity}.{prop}"
            if ref not in seen:
                select.append({**field(entity, prop, kind), "Name": ref})
                seen.add(ref)
            proj[role].append({"queryRef": ref, **({"active": True} if role == "Category" else {})})
    q = {"Version": 2, "From": frm, "Select": select}
    if order:
        e, p, k, desc = order
        q["OrderBy"] = [{"Direction": 2 if desc else 1, "Expression": field(e, p, k)}]
    sv = {"visualType": vtype, "projections": proj, "prototypeQuery": q, "drillFilterOtherVisuals": True}
    objects = dict(objects or {})
    if vtype in ("clusteredBarChart", "clusteredColumnChart"):
        objects.setdefault("labels", [{"properties": {"show": lit("true")}}])      # value on every bar
    if vtype == "pivotTable":                                                     # totals of means are meaningless
        objects.setdefault("subTotals", [{"properties": {"rowSubtotals": lit("false"), "columnSubtotals": lit("false")}}])
    if objects:
        sv["objects"] = objects
    if title and vtype != "slicer":                                               # slicers already show a header
        sv["vcObjects"] = {"title": [{"properties": {"show": lit("true"), "text": lit(f"'{title}'")}}]}
    return sv


def textbox(paragraphs):
    """paragraphs: list of (text, size_pt, bold)."""
    paras = [{"textRuns": [{"value": t, "textStyle": {"fontSize": f"{s}pt", **({"fontWeight": "bold"} if b else {})}}]}
             for t, s, b in paragraphs]
    return {"visualType": "textbox", "drillFilterOtherVisuals": True,
            "objects": {"general": [{"properties": {"paragraphs": paras}}]}}


R, MS = "Respondents", "Model Scores"


def m(e, p):
    return (e, p, "measure")


def c(e, p):
    return (e, p, "col")


def scores():
    with open(DATA / "model_scores.csv", newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["Metric"] == "ROC-AUC"]
    return {r["Model"]: r for r in rows}


def report():
    s = scores()
    default = next(k for k, r in s.items() if r["Is Default"] == "1")
    folds = next(iter(s.values()))["Folds"]

    p1 = Page("ReportSection_overview", "1. Dataset overview")
    p1.add(textbox([("Online Food Ordering: who says Yes?", 20, True),
                    ("Kaggle survey of 388 people in Bangalore. 103 exact duplicates removed, so 285 respondents remain. "
                     "Output (Yes/No) is the target. Use the slicers on the left; every chart follows them.", 11, False)]),
           10, 5, 1260, 70)
    for i, (col, h) in enumerate([("Gender", 100), ("Occupation", 150), ("Customer Type", 110), ("Monthly Income", 180)]):
        y = [85, 195, 355, 475][i]
        p1.add(visual("slicer", {"Values": [c(R, col)]}, title=col), 10, y, 200, h)
    for i, (meas, ttl) in enumerate([("Respondents", "Respondents"), ("Yes Rate", "Say Yes"),
                                     ("Positive Feedback Rate", "Positive feedback"), ("Average Age", "Average age")]):
        p1.add(visual("card", {"Values": [m(R, meas)]}, title=ttl), 220 + i * 265, 85, 255, 110)
    p1.add(visual("donutChart", {"Category": [c(R, "Output")], "Y": [m(R, "Respondents")]}, "Output (Yes / No)"), 220, 205, 330, 250)
    p1.add(visual("clusteredBarChart", {"Category": [c(R, "Occupation")], "Y": [m(R, "Respondents")]},
                  "Respondents by occupation", order=(R, "Respondents", "measure", True)), 560, 205, 350, 250)
    p1.add(visual("clusteredColumnChart", {"Category": [c(R, "Monthly Income")], "Y": [m(R, "Yes Rate")]},
                  "Yes rate by monthly income"), 920, 205, 350, 250)
    p1.add(visual("donutChart", {"Category": [c(R, "Marital Status")], "Y": [m(R, "Respondents")]}, "Marital status"), 220, 465, 330, 250)
    p1.add(visual("lineClusteredColumnComboChart", {"Category": [c(R, "Age Band")], "Y": [m(R, "Respondents")], "Y2": [m(R, "Yes Rate")]},
                  "Respondents (columns) and Yes rate (line) by age band"), 560, 465, 710, 250)

    p2 = Page("ReportSection_segments", "2. Who says Yes")
    p2.add(textbox([("Which groups are more likely to say Yes?", 20, True),
                    ("Yes rate = share of a group that answered Yes. The table tests each attribute "
                     "(chi-square or Fisher's exact). Holm p corrects for testing 7 attributes; below 0.05 means "
                     "the attribute is associated with the answer. Association does not mean cause.", 11, False)]),
           10, 5, 1260, 80)
    for i, col in enumerate(["Occupation", "Marital Status", "Educational Qualifications"]):
        p2.add(visual("clusteredBarChart", {"Category": [c(R, col)], "Y": [m(R, "Yes Rate")]}, f"Yes rate by {col.lower()}",
                      order=(R, "Yes Rate", "measure", True)), 10 + i * 425, 95, 415, 260)
    p2.add(visual("clusteredColumnChart", {"Category": [c(R, "Family size")], "Y": [m(R, "Yes Rate")]}, "Yes rate by family size"),
           10, 365, 415, 350)
    p2.add(visual("tableEx", {"Values": [c("Association Tests", x) for x in
                                         ["Attribute", "Test", "p", "Holm p", "Significant (5%)"]]},
                  "Association tests (all 285 respondents)"), 435, 365, 835, 350)

    p3 = Page("ReportSection_geo", "3. Geography")
    p3.add(textbox([("Where do respondents live?", 20, True),
                    ("Each bubble is a pin code placed at its average latitude and longitude; bubble size = respondents. "
                     "Click a bubble or a row to filter the other visual.", 11, False)]), 10, 5, 1260, 70)
    p3.add(visual("scatterChart", {"Category": [c(R, "Pin code")], "X": [m(R, "Avg Longitude")], "Y": [m(R, "Avg Latitude")],
                                   "Size": [m(R, "Respondents")]}, "Pin codes on a longitude / latitude grid"), 10, 85, 820, 630)
    p3.add(visual("tableEx", {"Values": [c(R, "Pin code"), m(R, "Respondents"), m(R, "Yes Rate")]}, "Pin codes",
                  order=(R, "Respondents", "measure", True)), 840, 85, 430, 630)

    p4 = Page("ReportSection_models", "4. Model results")
    p4.add(textbox([("Can a model predict Yes from a person's profile?", 20, True),
                    (f"Three algorithms were trained on 7 inputs (age, family size, gender, marital status, occupation, income, education) "
                     f"and tested with nested cross-validation: {folds} held-out folds. ROC-AUC 0.5 = coin flip, 1.0 = perfect. "
                     f"Random Forest {float(s['Random Forest']['Mean']):.3f}, XGBoost {float(s['XGBoost']['Mean']):.3f}, "
                     f"Logistic Regression {float(s['Logistic Regression']['Mean']):.3f}, baseline {float(s['Baseline']['Mean']):.3f}. "
                     f"Default model: {default} (intervals overlap, so the simpler model is preferred).", 11, False)]),
           10, 5, 1260, 95)
    p4.add(visual("clusteredBarChart", {"Category": [c(MS, "Model")], "Y": [m(MS, "ROC-AUC Score")]}, "ROC-AUC by model (mean of folds)",
                  order=(MS, "ROC-AUC Score", "measure", True)), 10, 110, 400, 270)
    p4.add(visual("pivotTable", {"Rows": [c(MS, "Model")], "Columns": [c(MS, "Metric")], "Values": [m(MS, "Score")]},
                  "All metrics (mean over folds)"), 420, 110, 850, 270)
    p4.add(visual("lineChart", {"Category": [c("Fold Scores", "Fold")], "Series": [c("Fold Scores", "Model")],
                                "Y": [m("Fold Scores", "Fold ROC-AUC")]}, "ROC-AUC on each held-out fold"), 10, 390, 500, 325)
    p4.add(visual("clusteredBarChart", {"Category": [c("Feature Importance", "Feature")], "Series": [c("Feature Importance", "Model")],
                                        "Y": [m("Feature Importance", "Importance")]}, "Feature importance (share of mean |SHAP|)",
                  order=("Feature Importance", "Importance", "measure", True)), 520, 390, 420, 325)
    p4.add(visual("pivotTable", {"Rows": [c("Confusion", "Model"), c("Confusion", "Actual")], "Columns": [c("Confusion", "Predicted")],
                                 "Values": [m("Confusion", "Predictions")]}, "Confusion matrix at 0.5 (out-of-fold)"), 950, 390, 320, 325)

    p5 = Page("ReportSection_dictionary", "5. Data dictionary")
    p5.add(textbox([("What is in the file, and how was it cleaned?", 20, True),
                    ("Cleaning: spaces stripped from text, the unnamed last column dropped (it matched Output on every row), "
                     "103 exact duplicate rows removed, no missing values. Feedback is recorded after ordering, so it is never a model input. "
                     "Location columns are used for the map only.", 11, False)]), 10, 5, 1260, 80)
    p5.add(visual("tableEx", {"Values": [c("Data Dictionary", x) for x in ["Column", "Type", "Role", "Missing", "Levels", "Note"]]},
                  "Data dictionary"), 10, 95, 1260, 620)

    pages = [p1, p2, p3, p4, p5]
    cfg = {"version": "5.43", "themeCollection": {}, "activeSectionIndex": 0, "defaultDrillFilterOtherVisuals": True,
           "settings": {"useStylableVisualContainerHeader": True, "exportDataMode": 1}}
    return {"config": json.dumps(cfg), "layoutOptimization": 0, "filters": "[]",
            "sections": [p.section(i) for i, p in enumerate(pages)]}


def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2), encoding="utf-8")


def main():
    # Once Power BI Desktop saves the project it switches to its own definition/ folders (TMDL + PBIR).
    # Writing model.bim/report.json next to them would leave two conflicting definitions.
    if (SM / "definition").exists() or (RP / "definition").exists():
        raise SystemExit("FoodOrdering.pbip has been saved by Power BI Desktop (definition/ folders exist). "
                         "Edit it in Power BI, or delete both .SemanticModel and .Report folders to regenerate.")
    # Overwrite files in place: OneDrive can lock the folders, so they are never deleted.
    write(HERE / f"{NAME}.pbip", {"version": "1.0", "artifacts": [{"report": {"path": f"{NAME}.Report"}}],
                                  "settings": {"enableAutoRecovery": True}})
    write(SM / "definition.pbism", {"version": "1.0", "settings": {}})
    write(SM / "model.bim", model_bim())
    write(RP / "definition.pbir", {"version": "1.0", "datasetReference": {"byPath": {"path": f"../{NAME}.SemanticModel"},
                                                                         "byConnection": None}})
    write(RP / "report.json", report())
    print(f"wrote {HERE / (NAME + '.pbip')}")


if __name__ == "__main__":
    main()
