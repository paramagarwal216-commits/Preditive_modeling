// Global filters, kept in the URL query string so any view can be shared.
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, useApi, type Filters, type Meta } from "./api";

export type ListKey = "gender" | "marital" | "occupation" | "income" | "education" | "customer" | "feedback";
export type RangeKey = "age" | "family";

export const LIST_KEYS: { key: ListKey; label: string; column: string }[] = [
  { key: "gender", label: "Gender", column: "Gender" },
  { key: "marital", label: "Marital", column: "Marital Status" },
  { key: "occupation", label: "Occupation", column: "Occupation" },
  { key: "income", label: "Income", column: "Monthly Income" },
  { key: "education", label: "Education", column: "Educational Qualifications" },
  { key: "customer", label: "Customer type", column: "Customer Type" },
  { key: "feedback", label: "Feedback", column: "Feedback" },
];
export const RANGE_KEYS: { key: RangeKey; label: string; column: string }[] = [
  { key: "age", label: "Age", column: "Age" },
  { key: "family", label: "Family size", column: "Family size" },
];
export const ATTRIBUTE_LABEL: Record<string, string> = Object.fromEntries(
  [...RANGE_KEYS, ...LIST_KEYS].map((k) => [k.key, k.label]),
);

function parse(sp: URLSearchParams): Filters {
  const f: Filters = {};
  for (const { key } of RANGE_KEYS) {
    const m = sp.get(key)?.match(/^(\d+)-(\d+)$/);
    if (m) f[key] = [Number(m[1]), Number(m[2])];
  }
  for (const { key } of LIST_KEYS) {
    const v = sp.getAll(key);
    if (v.length) f[key] = v;
  }
  return f;
}

function serialise(f: Filters, keep: URLSearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  // Keep page-level params (e.g. segment "by") that are not filters.
  keep.forEach((v, k) => { if (!(k in ATTRIBUTE_LABEL)) sp.append(k, v); });
  for (const { key } of RANGE_KEYS) { const r = f[key]; if (r) sp.set(key, `${r[0]}-${r[1]}`); }
  for (const { key } of LIST_KEYS) f[key]?.forEach((v) => sp.append(key, v));
  return sp;
}

type Ctx = {
  meta?: Meta; metaError?: string;
  filters: Filters; filterKey: string;
  setRange: (k: RangeKey, r: [number, number] | undefined) => void;
  setList: (k: ListKey, v: string[]) => void;
  toggleLevel: (k: ListKey, level: string) => void;
  remove: (k: keyof Filters, level?: string) => void;
  reset: () => void;
};

const FilterContext = createContext<Ctx | null>(null);

export function FilterProvider({ children }: { children: ReactNode }) {
  const [sp, setSp] = useSearchParams();
  const meta = useApi(api.meta, "meta");
  const filters = useMemo(() => parse(sp), [sp]);
  const filterKey = JSON.stringify(filters);

  const update = (f: Filters) => setSp(serialise(f, sp), { replace: false });
  const ctx: Ctx = {
    meta: meta.data, metaError: meta.error, filters, filterKey,
    setRange: (k, r) => {
      const range = meta.data?.numeric_ranges[RANGE_KEYS.find((x) => x.key === k)!.column];
      const full = r && range && r[0] <= range[0] && r[1] >= range[1];
      update({ ...filters, [k]: full ? undefined : r });
    },
    setList: (k, v) => update({ ...filters, [k]: v.length ? v : undefined }),
    toggleLevel: (k, level) => {
      const cur = filters[k] ?? [];
      const next = cur.includes(level) ? cur.filter((x) => x !== level) : [...cur, level];
      update({ ...filters, [k]: next.length ? next : undefined });
    },
    remove: (k, level) => {
      const cur = filters[k];
      if (level && Array.isArray(cur) && typeof cur[0] === "string") {
        const next = (cur as string[]).filter((x) => x !== level);
        update({ ...filters, [k]: next.length ? next : undefined });
      } else update({ ...filters, [k]: undefined });
    },
    reset: () => update({}),
  };
  return <FilterContext.Provider value={ctx}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const c = useContext(FilterContext);
  if (!c) throw new Error("useFilters outside FilterProvider");
  return c;
}

/** Active filters as removable chips (top bar). */
export function FilterChips() {
  const { filters, remove } = useFilters();
  const chips: { k: keyof Filters; level?: string; text: string }[] = [];
  for (const { key, label } of RANGE_KEYS) {
    const r = filters[key];
    if (r) chips.push({ k: key, text: `${label}: ${r[0]}–${r[1]}` });
  }
  for (const { key, label } of LIST_KEYS) {
    filters[key]?.forEach((v) => chips.push({ k: key, level: v, text: `${label}: ${v}` }));
  }
  return (
    <>
      {chips.map((c) => (
        <button
          key={c.text}
          onClick={() => remove(c.k, c.level)}
          className="clay clay-violet inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-cap"
          aria-label={`Remove filter ${c.text}`}
        >
          {c.text} <span aria-hidden>×</span>
        </button>
      ))}
    </>
  );
}

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, close]);
  return ref;
}

const triggerCls = "glass-inset inline-flex items-center gap-1 rounded-full px-3 py-1 text-body text-ink hover:border-pink";

function MultiSelect({ k, label, levels }: { k: ListKey; label: string; levels: string[] }) {
  const { filters, toggleLevel, setList } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const sel = filters[k] ?? [];
  return (
    <div className="relative" ref={ref}>
      <button className={triggerCls} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}{sel.length > 0 && <span className="text-accent">· {sel.length}</span>}
        <span aria-hidden className="text-ink-3">▾</span>
      </button>
      {open && (
        <div className="glass glass-strong absolute left-0 z-[1000] mt-1 min-w-[200px] p-2">
          {levels.map((lv) => (
            <label key={lv} className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 text-body hover:bg-bg">
              <input type="checkbox" className="accent-accent" checked={sel.includes(lv)} onChange={() => toggleLevel(k, lv)} />
              {lv}
            </label>
          ))}
          {sel.length > 0 && (
            <button className="mt-1 px-1 text-cap text-ink-2 underline" onClick={() => setList(k, [])}>Clear</button>
          )}
        </div>
      )}
    </div>
  );
}

export function RangeInput({ min, max, value, onChange, label }: {
  min: number; max: number; value: [number, number]; onChange: (v: [number, number]) => void; label: string;
}) {
  const span = max - min || 1;
  return (
    <div className="range2" role="group" aria-label={label}>
      <div className="track" />
      <div className="fill" style={{ left: `${((value[0] - min) / span) * 100}%`, right: `${100 - ((value[1] - min) / span) * 100}%` }} />
      <input type="range" min={min} max={max} value={value[0]} aria-label={`${label} minimum`}
        onChange={(e) => onChange([Math.min(Number(e.target.value), value[1]), value[1]])} />
      <input type="range" min={min} max={max} value={value[1]} aria-label={`${label} maximum`}
        onChange={(e) => onChange([value[0], Math.max(Number(e.target.value), value[0])])} />
    </div>
  );
}

function RangeFilter({ k, label, column }: { k: RangeKey; label: string; column: string }) {
  const { filters, setRange, meta } = useFilters();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, () => setOpen(false));
  const [lo, hi] = meta!.numeric_ranges[column];
  const applied = filters[k];
  const [draft, setDraft] = useState<[number, number]>(applied ?? [lo, hi]);
  useEffect(() => setDraft(applied ?? [lo, hi]), [applied?.[0], applied?.[1], lo, hi]); // eslint-disable-line
  // Commit after the thumb settles, so dragging does not fire a request per step.
  useEffect(() => {
    if (draft[0] === (applied?.[0] ?? lo) && draft[1] === (applied?.[1] ?? hi)) return;
    const t = setTimeout(() => setRange(k, draft), 300);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line
  return (
    <div className="relative" ref={ref}>
      <button className={triggerCls} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}{applied && <span className="text-accent">· {applied[0]}–{applied[1]}</span>}
        <span aria-hidden className="text-ink-3">▾</span>
      </button>
      {open && (
        <div className="glass glass-strong absolute left-0 z-[1000] mt-1 w-[240px] p-3">
          <div className="mb-2 flex justify-between text-cap text-ink-2"><span>{draft[0]}</span><span>{draft[1]}</span></div>
          <RangeInput min={lo} max={hi} value={draft} onChange={setDraft} label={label} />
        </div>
      )}
    </div>
  );
}

/** Filter bar shown on Overview, Segments and Geography. */
export function FilterBar() {
  const { meta } = useFilters();
  if (!meta) return null;
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <RangeFilter k="age" label="Age" column="Age" />
      {LIST_KEYS.map((l) => <MultiSelect key={l.key} k={l.key} label={l.label} levels={meta.levels[l.column]} />)}
      <RangeFilter k="family" label="Family size" column="Family size" />
    </div>
  );
}
