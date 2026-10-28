import { useMemo, useState } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMapEvents } from "react-leaflet";
import { api, pct, useApi, type Geo, type Pin } from "../api";
import { Card } from "../components/Card";
import { Page } from "../components/Shell";
import { Guard } from "../components/States";
import { useFilters } from "../filters";
import { tealScale, tokens } from "../theme";

const source = "Source: onlinefoods.csv, cleaned";

function ZoomWatch({ onZoom }: { onZoom: (z: number) => void }) {
  useMapEvents({ zoomend: (e) => onZoom(e.target.getZoom()) });
  return null;
}

function GeoMap({ geo }: { geo: Geo }) {
  const [zoom, setZoom] = useState(12);
  const center = useMemo<[number, number]>(() => {
    const n = geo.pins.reduce((s, p) => s + p.n, 0) || 1;
    return [geo.pins.reduce((s, p) => s + p.lat * p.n, 0) / n, geo.pins.reduce((s, p) => s + p.lon * p.n, 0) / n];
  }, [geo]);
  const maxN = Math.max(1, ...geo.pins.map((p) => p.n));
  return (
    <>
      <MapContainer center={center} zoom={12} style={{ height: 460, width: "100%", borderRadius: 4 }} scrollWheelZoom={false}>
        {/* CARTO Positron now needs an API key; OSM tiles are greyed in CSS to match it. */}
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <ZoomWatch onZoom={setZoom} />
        {zoom >= 14
          ? geo.points.map((p, i) => (
            <CircleMarker key={i} center={[p.lat, p.lon]} radius={4}
              pathOptions={{ color: tokens.surface, weight: 1, fillColor: p.y ? tokens.accent : tokens.neutralBar, fillOpacity: 1 }}>
              <Tooltip>{p.y ? "Yes" : "No"} (location jittered ±0.005°)</Tooltip>
            </CircleMarker>
          ))
          : geo.pins.map((p) => (
            <CircleMarker key={p.pin} center={[p.lat, p.lon]} radius={4 + 14 * Math.sqrt(p.n / maxN)}
              pathOptions={{ color: tokens.accent, weight: 1, fillColor: tealScale(p.rate), fillOpacity: 0.85 }}>
              <Tooltip>
                <b>{p.pin}</b><br />Yes rate {pct(p.rate)} ({p.positive} of n = {p.n})
              </Tooltip>
            </CircleMarker>
          ))}
      </MapContainer>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-cap text-ink-2">
        <span>Yes rate</span>
        <span className="inline-flex" aria-hidden>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => <span key={t} className="inline-block h-2 w-5" style={{ background: tealScale(t) }} />)}
        </span>
        <span>0% → 100% · circle area ∝ n · zoom to 14+ for individual (jittered) respondents</span>
      </div>
    </>
  );
}

type SortKey = "pin" | "n" | "rate";

function PinTable({ pins }: { pins: Pin[] }) {
  const [sort, setSort] = useState<{ k: SortKey; desc: boolean }>({ k: "n", desc: true });
  const rows = [...pins].sort((a, b) => (sort.desc ? -1 : 1) * (a[sort.k] - b[sort.k]));
  const th = (k: SortKey, label: string) => (
    <th className="border-b border-line px-2 py-1.5 text-left font-semibold text-ink-2">
      <button onClick={() => setSort({ k, desc: sort.k === k ? !sort.desc : true })} className="hover:text-ink">
        {label}{sort.k === k ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  return (
    <div className="max-h-[480px] overflow-auto">
      <table className="w-full border-collapse text-cap">
        <thead className="sticky top-0 bg-raised/90 backdrop-blur"><tr>{th("pin", "Pin")}{th("n", "n")}{th("rate", "Yes rate")}
          <th className="border-b border-line px-2 py-1.5 text-left font-semibold text-ink-2">95% CI</th></tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.pin} className={`border-b border-line last:border-0 ${p.n < 10 ? "text-ink-3" : "text-ink"}`}>
              <td className="px-2 py-1 font-mono">{p.pin}</td><td className="px-2 py-1">{p.n}</td>
              <td className="px-2 py-1">{pct(p.rate)}</td><td className="whitespace-nowrap px-2 py-1">{pct(p.ci_low, 0)}–{pct(p.ci_high, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Geography() {
  const { filters, filterKey } = useFilters();
  const q = useApi(() => api.geo(filters), filterKey);
  const g = q.data;
  const n = g?.quality.valid ?? 0;
  const empty = g ? g.quality.valid + g.quality.invalid === 0 : undefined;
  const weak = g && g.quality.pins_n5 < 10;

  return (
    <Page title="Geography" question="Where are respondents, and does Yes vary by area?" filters>
      {weak ? (
        <Card span={12} title="Location quality" subtitle="Is there enough location data to compare areas?"
          note={`Valid = coordinates inside the Bangalore area · ${source}`}>
          <p className="max-w-prose text-body text-ink">
            Only {g!.quality.pins_n5} pin codes have 5 or more respondents in this selection, which is too few to compare areas.
            {" "}{g!.quality.valid} rows have valid coordinates and {g!.quality.invalid} do not, across {g!.quality.pins} pin codes.
          </p>
        </Card>
      ) : (
        <>
          <Card span={8} title="Respondents by pin code" subtitle="Where do respondents live, and how does the Yes rate vary by area?"
            note={`One circle per pin code (median location) · n = ${n} with valid coordinates, ${g?.quality.invalid ?? "—"} invalid · ${source}`}>
            <Guard loading={q.loading} error={q.error} empty={empty}>{() => <GeoMap geo={g!} />}</Guard>
          </Card>
          <Card span={4} title="Pin codes" subtitle="Which pin codes have the most respondents?"
            note={`${g?.quality.pins ?? "—"} pin codes, ${g?.quality.pins_n5 ?? "—"} with n ≥ 5 · grey = n < 10 · Wilson 95% interval`}>
            <Guard loading={q.loading} error={q.error} empty={empty}>{() => <PinTable pins={g!.pins} />}</Guard>
          </Card>
        </>
      )}
    </Page>
  );
}
