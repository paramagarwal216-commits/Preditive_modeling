import { createContext, useContext, useState, type ReactNode } from "react";

const SPAN: Record<number, string> = {
  3: "col-span-12 sm:col-span-6 lg:col-span-3",
  4: "col-span-12 lg:col-span-4",
  6: "col-span-12 lg:col-span-6",
  8: "col-span-12 lg:col-span-8",
  12: "col-span-12",
};
export const spanClass = (n: number) => SPAN[n] ?? "col-span-12";

const TableView = createContext(false);
export const useTableView = () => useContext(TableView);

/** Every card: title, one-line question, body, footer note with n and source. */
export function Card({ title, subtitle, note, span = 12, cols, id, actions, tableToggle, children }: {
  title: string; subtitle: string; note?: ReactNode; span?: number; id?: string;
  /** Full responsive col-span classes; overrides `span` when given. */
  cols?: string;
  actions?: ReactNode; tableToggle?: boolean; children: ReactNode;
}) {
  const [table, setTable] = useState(false);
  return (
    <section id={id} className={`${cols ?? spanClass(span)} card-rise card-lift glass flex min-w-0 flex-col p-5`}>
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-card text-ink">{title}</h2>
          <p className="max-w-prose text-cap text-ink-2">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {tableToggle && (
            <div className="glass-inset inline-flex gap-0.5 p-0.5 text-cap" role="group" aria-label="View as">
              {["Chart", "Table"].map((v) => (
                <button key={v} aria-pressed={table === (v === "Table")}
                  onClick={() => setTable(v === "Table")}
                  className={`rounded-full px-2.5 py-0.5 ${table === (v === "Table") ? "clay clay-violet" : "text-ink-2"}`}>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>
      <TableView.Provider value={table}>
        <div className="min-w-0 flex-1">{children}</div>
      </TableView.Provider>
      {note && <footer className="mt-3 border-t border-line pt-2 text-cap text-ink-3">{note}</footer>}
    </section>
  );
}
