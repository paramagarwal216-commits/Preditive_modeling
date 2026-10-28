import { useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { FilterBar, FilterChips, useFilters } from "../filters";
import { ALGO_NAME } from "../theme";
import { ErrorState, Loading } from "./States";

// Sidebar icons: 16 px, 1.5 px stroke, inline SVG.
const ICONS: Record<string, ReactNode> = {
  dashboard: <><rect x="2.5" y="2.5" width="4.5" height="6" rx="1" /><rect x="9" y="2.5" width="4.5" height="3.5" rx="1" /><rect x="9" y="8" width="4.5" height="5.5" rx="1" /><rect x="2.5" y="10.5" width="4.5" height="3" rx="1" /></>,
  report: <><path d="M4 2.5h5.5L12 5v8.5H4z" /><path d="M6 7.5h4M6 10h4" /></>,
  overview: <path d="M2 13h12M4 11V7M8 11V3M12 11V9" />,
  segments: <path d="M3 4h10M3 8h6M3 12h8" />,
  geography: <><circle cx="8" cy="7" r="2" /><path d="M8 14s-4.5-4-4.5-7a4.5 4.5 0 0 1 9 0c0 3-4.5 7-4.5 7z" /></>,
  models: <path d="M2 12l3-4 3 2 3-5 3 3" />,
  data: <><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M2.5 6.5h11M6.5 6.5V13" /></>,
};

const NAV = [
  ["/", "Dashboard", "dashboard"], ["/report", "Project Report", "report"], ["/overview", "Overview", "overview"], ["/segments", "Segments", "segments"], ["/geography", "Geography", "geography"],
  ["/models", "Models & Predictor", "models"], ["/data", "Data", "data"],
] as const;

function Icon({ name }: { name: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      {ICONS[name]}
    </svg>
  );
}

export function Shell() {
  const { meta, metaError, filters, filterKey, reset } = useFilters();
  const { search, pathname } = useLocation();
  const [exporting, setExporting] = useState(false);
  const hasFilters = filterKey !== "{}";

  const doExport = async () => {
    setExporting(true);
    try {
      const blob = await api.exportCsv(filters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "onlinefoods_filtered.csv"; a.click();
      URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  return (
    <div className="flex min-h-screen">
      <nav className="glass-strong sticky top-0 z-[1150] flex h-screen w-16 shrink-0 flex-col border-r lg:w-sidebar" aria-label="Main">
        <div className="flex h-14 items-center border-b border-white/10 px-5 text-card">
          <span className="text-gradient hidden text-[16px] font-semibold lg:inline">Food Ordering</span>
          <span className="lg:hidden" aria-hidden>FO</span>
        </div>
        <ul className="flex-1 space-y-0.5 p-2">
          {NAV.map(([to, label, icon]) => (
            <li key={to}>
              <NavLink to={{ pathname: to, search }} end={to === "/"} title={label}
                className={({ isActive }) => `flex items-center gap-3 rounded-[14px] px-3 py-2 text-body ${isActive ? "clay clay-violet font-semibold" : "text-ink-2 hover:bg-white/5 hover:text-ink"}`}>
                <Icon name={icon} /><span className="hidden lg:inline">{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        {meta && (
          <div className="hidden border-t border-white/10 px-5 py-3 text-cap text-ink-2 lg:block">
            Model: <span className="text-ink">{ALGO_NAME[meta.default_model]}</span>
          </div>
        )}
      </nav>
      <div className="min-w-0 flex-1">
        <header className="glass-strong sticky top-0 z-[1100] flex min-h-14 flex-wrap items-center gap-2 border-b px-4 py-2 lg:px-6">
          <span className="text-cap text-ink-2">
            {meta ? `${meta.file} · ${meta.rows_raw} rows` : "onlinefoods.csv"}
          </span>
          <FilterChips />
          <div className="ml-auto flex gap-2">
            <button onClick={reset} disabled={!hasFilters}
              className="glass-inset rounded-full px-3 py-1 text-cap text-ink-2 enabled:hover:text-ink disabled:opacity-50">Reset</button>
            <button onClick={doExport} disabled={exporting}
              className="clay clay-pink rounded-full px-3 py-1 text-cap font-semibold">Export</button>
          </div>
        </header>
        <main key={pathname} className="page-fade mx-auto max-w-content px-4 py-6 lg:px-6">
          {metaError ? <ErrorState message={metaError} /> : meta ? <Outlet /> : <Loading />}
        </main>
      </div>
    </div>
  );
}

/** Page header: title, the question it answers, and (pages 1–3) the filter bar. */
export function Page({ title, question, filters, children }: {
  title: string; question: string; filters?: boolean; children: ReactNode;
}) {
  const { meta } = useFilters();
  return (
    <>
      <h1 className="text-title text-ink">{title}</h1>
      <p className="mb-4 max-w-prose text-body text-ink-2">{question}</p>
      {filters && <FilterBar />}
      {meta && <div className="grid grid-cols-12 gap-4">{children}</div>}
    </>
  );
}
