import { api, pct, useApi } from "../api";
import { Card } from "../components/Card";
import { Chart, rateBarsOption, rateTable } from "../components/Chart";
import { Kpi } from "../components/Kpi";
import { Page } from "../components/Shell";
import { Guard } from "../components/States";
import { useFilters } from "../filters";
import { tokens } from "../theme";

const REF_TITLE: Record<string, string> = {
  outcome: "Outcome split", by_occupation: "Yes rate by occupation", by_income: "Yes rate by income",
};

export default function Overview() {
  const { filters, filterKey, toggleLevel, meta } = useFilters();
  const q = useApi(() => api.overview(filters), filterKey);
  const d = q.data;
  const empty = d ? d.kpis.n === 0 : undefined;
  const source = "Source: onlinefoods.csv, cleaned";
  const yes = d?.outcome.find((o) => o.label === "Yes")?.n ?? 0;

  return (
    <Page title="Overview" question="Who is in the data, and what share say Yes?" filters>
      <Kpi label="Respondents" value={d?.kpis.n} format={(v) => Math.round(v).toString()}
        note={`of ${meta?.rows_clean} after cleaning`} />
      <Kpi label="Yes rate" value={d?.kpis.positive_rate} format={(v) => pct(v)}
        note={d ? `${yes} of n = ${d.kpis.n} say Yes` : ""} />
      <Kpi label="Duplicates removed" value={d?.kpis.duplicates_removed} format={(v) => Math.round(v).toString()}
        note={`exact duplicate rows of ${d?.kpis.rows_raw ?? "—"} raw`} />
      <Kpi label="Missing cells" value={d?.kpis.missing_pct} format={(v) => `${v.toFixed(1)}%`}
        note="share of all cells in the raw file" />

      <Card id="outcome" span={4} title="Outcome split" subtitle="What share of respondents say Yes vs No?"
        note={`n = ${d?.kpis.n ?? "—"} · ${source}`} tableToggle>
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => {
            const n = d!.kpis.n;
            return (
              <>
              <Chart height={64}
                table={{ columns: ["Output", "n", "Share"], rows: d!.outcome.map((o) => [o.label, o.n, pct(o.n / n)]) }}
                option={{
                  grid: { left: 0, right: 0, top: 8, bottom: 8, containLabel: false },
                  tooltip: { trigger: "item", formatter: (p: any) => `${p.seriesName}: ${pct(p.value / n)} (n = ${p.value})` },
                  xAxis: { type: "value", max: n, show: false },
                  yAxis: { type: "category", data: ["Output"], show: false },
                  series: d!.outcome.map((o) => ({
                    type: "bar", stack: "all", name: o.label, data: [o.n], barWidth: 40,
                    itemStyle: { color: o.label === "Yes" ? tokens.accent : tokens.neutralBar },
                  })),
                }} />
              <ul className="mt-2 space-y-1 text-body">
                {d!.outcome.map((o) => (
                  <li key={o.label} className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: o.label === "Yes" ? tokens.accent : tokens.neutralBar }} aria-hidden />
                    <span className="text-ink">{o.label}</span>
                    <span className="ml-auto font-semibold text-ink">{pct(o.n / n)}</span>
                    <span className="w-16 text-right text-cap text-ink-2">n = {o.n}</span>
                  </li>
                ))}
              </ul>
              </>
            );
          }}
        </Guard>
      </Card>

      <Card id="by_occupation" span={4} title="Yes rate by occupation" subtitle="Does the Yes rate differ by occupation? Click a bar to filter."
        note={`Whiskers: Wilson 95% interval · grey = n < 10 · ${source}`} tableToggle>
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => <Chart option={rateBarsOption(d!.by_occupation, filters.occupation)} table={rateTable(d!.by_occupation)}
            onClick={(p) => p.name && toggleLevel("occupation", p.name)} />}
        </Guard>
      </Card>

      <Card id="by_income" span={4} title="Yes rate by income" subtitle="Does the Yes rate differ across income bands? Click a bar to filter."
        note={`Bands ordered low to high · Wilson 95% interval · ${source}`} tableToggle>
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => <Chart option={rateBarsOption(d!.by_income, filters.income)} table={rateTable(d!.by_income)}
            onClick={(p) => p.name && toggleLevel("income", p.name)} />}
        </Guard>
      </Card>

      <Card span={12} title="Findings" subtitle="What stands out in the current selection?"
        note="Generated from the computed values above; groups with n < 10 are excluded. Associations only.">
        <Guard loading={q.loading} error={q.error} empty={empty}>
          {() => (
            <ul className="space-y-1.5">
              {d!.findings.map((f) => (
                <li key={f.text} className="max-w-prose text-body text-ink">
                  {f.text}{" "}
                  <a href={`#${f.ref}`} className="text-cap text-accent underline"
                    onClick={(e) => { e.preventDefault(); document.getElementById(f.ref)?.scrollIntoView({ behavior: "smooth", block: "center" }); }}>
                    {REF_TITLE[f.ref]}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Guard>
      </Card>
    </Page>
  );
}
