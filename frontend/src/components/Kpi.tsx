import { useEffect, useRef, useState } from "react";
import { spanClass } from "./Card";
import { reducedMotion } from "./Chart";

let counted = false;   // values count up once per app load, never on filter changes

export function Kpi({ label, value, format, note }: {
  label: string; value: number | null | undefined; format: (v: number) => string; note: string;
}) {
  const [shown, setShown] = useState<number | null>(counted || reducedMotion() ? value ?? null : 0);
  const raf = useRef(0);
  useEffect(() => {
    if (value == null) { setShown(null); return; }
    if (counted || reducedMotion()) { setShown(value); return; }
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / 600);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf.current = requestAnimationFrame(step);
      else counted = true;
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return (
    <section className={`${spanClass(3)} card-rise card-lift glass px-5 py-4`}>
      <h2 className="text-cap text-ink-2">{label}</h2>
      <p className="text-kpi text-ink">{shown == null ? "—" : format(shown)}</p>
      <p className="text-cap text-ink-3">{note}</p>
    </section>
  );
}
