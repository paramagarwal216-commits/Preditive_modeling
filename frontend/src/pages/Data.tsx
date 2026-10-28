import { useState } from "react";
import { api, pct, useApi } from "../api";
import { Card } from "../components/Card";
import { DataTable } from "../components/Chart";
import { Page } from "../components/Shell";
import { Guard } from "../components/States";
import { useFilters } from "../filters";

const SIZE = 25;

function Badge({ ok, text }: { ok: boolean; text?: string }) {
  return (
    <span className={`inline-block rounded-sm border px-1.5 text-cap ${ok ? "border-good text-good" : "border-warn text-warn"}`}>
      {text ?? (ok ? "pass" : "warn")}
    </span>
  );
}

export default function Data() {
  const { meta, filters, filterKey } = useFilters();
  const [view, setView] = useState<"raw" | "clean">("clean");
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<string | undefined>();
  const q = useApi(() => api.rows(filters, view, page, SIZE, sort), filterKey + view + page + sort);
  const m = meta!;
  const log = m.clean_log;
  const gate = m.target_gate;
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / SIZE)) : 1;

  const sortBy = (c: string) => {
    setSort(sort === `${c}:asc` ? `${c}:desc` : `${c}:asc`);
    setPage(1);
  };

  const topAuc = Object.entries(gate.single_feature_auc).sort((a, b) => b[1] - a[1]);

  return (
    <Page title="Data" question="What is in the file, what was cleaned, is the target valid?">
      <Card span={12} title={view === "raw" ? "Raw rows" : "Clean rows"}
        subtitle="What does each respondent's record look like? Click a column header to sort."
        note={`${q.data?.total ?? "—"} rows match the current filters · missing cells tinted · Source: onlinefoods.csv${view === "clean" ? ", cleaned" : " as read"}`}
        actions={
          <div className="glass-inset inline-flex gap-0.5 p-0.5 text-cap" role="group" aria-label="Rows view">
            {(["raw", "clean"] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => { setView(v); setPage(1); setSort(undefined); }}
                className={`rounded-full px-2.5 py-0.5 ${view === v ? "clay clay-violet rounded-full" : "text-ink-2"}`}>
                {v === "raw" ? "Raw" : "Clean"}
              </button>
            ))}
          </div>
        }>
        <Guard loading={q.loading} error={q.error} empty={q.data ? q.data.total === 0 : undefined}>
          {() => (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-cap">
                  <thead>
                    <tr>
                      {q.data!.columns.map((c) => (
                        <th key={c} className="whitespace-nowrap border-b border-line px-2 py-1.5 text-left font-semibold text-ink-2">
                          <button onClick={() => sortBy(c)} className="hover:text-ink">
                            {c}{sort?.startsWith(`${c}:`) ? (sort.endsWith("asc") ? " ↑" : " ↓") : ""}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {q.data!.rows.map((r, i) => (
                      <tr key={i} className="border-b border-line last:border-0">
                        {q.data!.columns.map((c) => (
                          <td key={c} className={`whitespace-nowrap px-2 py-1 ${r[c] == null ? "bg-warn/[0.12]" : ""}`}>
                            {r[c] == null ? <span className="text-ink-3">missing</span> : String(r[c])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex items-center gap-3 text-cap text-ink-2">
                <button disabled={page === 1} onClick={() => setPage(page - 1)} className="glass-inset rounded-full px-3 py-0.5 disabled:opacity-40">‹ Prev</button>
                <span>Page {page} of {pages}</span>
                <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="glass-inset rounded-full px-3 py-0.5 disabled:opacity-40">Next ›</button>
              </div>
            </>
          )}
        </Guard>
      </Card>

      <Card span={6} title="Data dictionary" subtitle="What is each column, and how is it used?"
        note={`${m.columns.length} columns in the raw file · Source: onlinefoods.csv`}>
        <DataTable maxHeight={480} columns={["Column", "Type", "Role", "Levels", "Missing", "Note"]}
          rows={m.columns.map((c) => [
            <span className="font-mono">{c.column}</span>, c.type, c.role,
            c.levels ? c.levels.join(", ") : "—", c.missing, c.note,
          ])} />
      </Card>

      <Card span={3} title="Cleaning log" subtitle="Which rules changed the data?"
        note={`${log.raw_rows} raw → ${log.clean_rows} clean rows`}>
        <ul className="divide-y divide-line">
          {[
            ["Strip spaces from text and column names", "all text cells"],
            [`Drop unnamed column${log.unnamed_columns.length ? ` (${log.unnamed_columns.join(", ")})` : ""}`,
              `${log.unnamed_columns.length} column`],
            ["Remove exact duplicate rows", `${log.exact_duplicates} rows`],
            ["Drop rows missing a feature or the target", `${log.rows_dropped_missing} rows`],
          ].map(([rule, n]) => (
            <li key={rule} className="py-1.5">
              <p className="text-body text-ink">{rule}</p>
              <p className="text-cap text-ink-2">{n} affected</p>
            </li>
          ))}
        </ul>
        {log.unnamed_vs_output_agreement != null && (
          <p className="mt-2 text-cap text-ink-2">
            The unnamed column agrees with Output on {pct(log.unnamed_vs_output_agreement)} of rows, so it was dropped.
          </p>
        )}
      </Card>

      <Card span={3} title="Target gate" subtitle="Is Output a usable, leak-free target?"
        note={`Positive class = "${gate.positive_class}" · n = ${log.clean_rows}`}>
        <ul className="divide-y divide-line text-body">
          <li className="py-1.5">
            <p>Class counts</p>
            <p className="text-cap text-ink-2">{Object.entries(gate.class_counts).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
          </li>
          <li className="py-1.5">
            <p>Minority share {pct(gate.minority_share)}</p>
            <Badge ok={gate.minority_share >= 0.35} text={gate.minority_share >= 0.35 ? "pass" : "warn · models use class weights"} />
          </li>
          <li className="py-1.5">
            <p>Exact duplicates {log.exact_duplicates}</p>
            <Badge ok={log.exact_duplicates === 0} text={log.exact_duplicates === 0 ? "pass" : "warn · removed before training"} />
          </li>
          <li className="py-1.5">
            <p>Leak suspects: {gate.leak_suspects.length ? gate.leak_suspects.join(", ") : "none"}</p>
            <p className="text-cap text-ink-2">any single column with AUC &gt; 0.95</p>
            <Badge ok={gate.leak_suspects.length === 0} />
          </li>
        </ul>
        <p className="mb-1 mt-3 text-cap text-ink-2">Single-feature AUC</p>
        <DataTable maxHeight={180} columns={["Column", "AUC"]}
          rows={topAuc.map(([c, a]) => [<span className="font-mono">{c}</span>, a.toFixed(3)])} />
      </Card>
    </Page>
  );
}
