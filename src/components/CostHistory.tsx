import { useMemo } from "react";
import type { HistoryPoint } from "../lib/history";
import { toSeries } from "../lib/history";

const W = 168;
const H = 30;

/** Inline sparkline. No chart library: eight tiny paths do not justify the weight. */
function Spark({ values, open }: { values: number[]; open: boolean[] }) {
  if (values.length < 2) return <span className="muted">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * W;
  const y = (v: number) => H - ((v - min) / span) * (H - 4) - 2;

  const d = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  // Shade the stretches where the underlying market was open.
  const bands: Array<[number, number]> = [];
  let start: number | null = null;
  open.forEach((isOpen, i) => {
    if (isOpen && start === null) start = i;
    if (!isOpen && start !== null) { bands.push([start, i]); start = null; }
  });
  if (start !== null) bands.push([start, open.length - 1]);

  return (
    <svg width={W} height={H} className="spark" aria-hidden>
      {bands.map(([a, b], i) => (
        <rect key={i} x={x(a)} y={0} width={Math.max(x(b) - x(a), 1)} height={H} className="spark-open" />
      ))}
      <path d={d} fill="none" strokeWidth="1.5" className="spark-line" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2" className="spark-dot" />
    </svg>
  );
}

export default function CostHistory({
  points,
  sizeUsdc,
}: {
  points: HistoryPoint[];
  sizeUsdc: number;
}) {
  const series = useMemo(() => toSeries(points, sizeUsdc), [points, sizeUsdc]);

  if (series.length === 0) {
    return <p className="muted">No history recorded yet.</p>;
  }

  const span = points.length
    ? {
        from: new Date(Math.min(...points.map((p) => p.ts.getTime()))),
        to: new Date(Math.max(...points.map((p) => p.ts.getTime()))),
      }
    : null;
  const sawOpen = points.some((p) => p.marketOpen === true);

  return (
    <>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>Token</th>
              <th>Now</th>
              <th>Low</th>
              <th>High</th>
              <th>Swing</th>
              <th className="route-col" style={{ textAlign: "left", width: W + 20 }}>
                Cost at ${sizeUsdc.toLocaleString()} over time
              </th>
            </tr>
          </thead>
          <tbody>
            {series.map((s, i) => (
              <tr key={s.symbol} style={{ animationDelay: `${i * 45}ms` }}>
                <td data-label="Token" className="sym">{s.symbol}</td>
                <td data-label="Now" className={s.last < 15 ? "c2" : s.last < 40 ? "c3" : "c4"}>
                  {s.last.toFixed(1)}<span className="unit">bps</span>
                </td>
                <td data-label="Low" className="muted">{s.min.toFixed(1)}</td>
                <td data-label="High" className="muted">{s.max.toFixed(1)}</td>
                <td data-label="Swing" className={s.max - s.min > 30 ? "accent" : "muted"}>
                  {(s.max - s.min).toFixed(1)}
                </td>
                <td data-label="Over time" className="route">
                  <Spark
                    values={s.points.map((p) => p.roundTripBps)}
                    open={s.points.map((p) => p.marketOpen === true)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {span && (
        <p className="note" style={{ marginTop: ".8rem", marginBottom: 0 }}>
          {series[0].points.length} samples per token, {span.from.toISOString().slice(5, 16).replace("T", " ")} to{" "}
          {span.to.toISOString().slice(5, 16).replace("T", " ")} UTC.{" "}
          {sawOpen
            ? "Shaded stretches are when the underlying US market was open."
            : "The whole window so far is with the US market closed — xStocks kept trading throughout."}
        </p>
      )}
    </>
  );
}
