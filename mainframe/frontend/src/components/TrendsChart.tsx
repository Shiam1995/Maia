import { useState } from "react";
import type { TrendBucket } from "../lib/types";
import { shortDate } from "../lib/format";

type Metric = {
  key: keyof Pick<
    TrendBucket,
    "calories" | "protein_g" | "carbs_g" | "fat_g" | "sugar_g" | "fibre_g"
  >;
  label: string;
  color: string;
  unit: string;
};

const METRICS: Metric[] = [
  { key: "calories", label: "Calories", color: "#7dd3fc", unit: "kcal" },
  { key: "protein_g", label: "Protein", color: "#86efac", unit: "g" },
  { key: "carbs_g", label: "Carbs", color: "#fcd34d", unit: "g" },
  { key: "fat_g", label: "Fat", color: "#fca5a5", unit: "g" },
  { key: "sugar_g", label: "Sugar", color: "#f0abfc", unit: "g" },
  { key: "fibre_g", label: "Fibre", color: "#a5b4fc", unit: "g" },
];

export default function TrendsChart({ buckets }: { buckets: TrendBucket[] }) {
  const [metric, setMetric] = useState<Metric>(METRICS[0]);

  const W = 640;
  const H = 220;
  const PAD = { top: 16, right: 12, bottom: 28, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const values = buckets.map((b) => b[metric.key]);
  const max = Math.max(1, ...values);
  const n = buckets.length;
  const barW = n > 0 ? Math.min(48, (innerW / n) * 0.7) : 0;
  const step = n > 0 ? innerW / n : 0;

  const ticks = 4;
  const gridLines = Array.from({ length: ticks + 1 }, (_, i) => (max / ticks) * i);

  return (
    <div className="card">
      <div className="chart-head">
        <h2 className="card-title">Trends</h2>
        <div className="metric-tabs">
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={`metric-tab ${metric.key === m.key ? "active" : ""}`}
              style={metric.key === m.key ? { borderColor: m.color, color: m.color } : {}}
              onClick={() => setMetric(m)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {n === 0 ? (
        <div className="empty">No data in this range yet.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img">
          {gridLines.map((g, i) => {
            const y = PAD.top + innerH - (g / max) * innerH;
            return (
              <g key={i}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y}
                  y2={y}
                  className="grid"
                />
                <text x={PAD.left - 6} y={y + 3} className="axis" textAnchor="end">
                  {Math.round(g)}
                </text>
              </g>
            );
          })}
          {buckets.map((b, i) => {
            const v = b[metric.key];
            const h = (v / max) * innerH;
            const x = PAD.left + step * i + (step - barW) / 2;
            const y = PAD.top + innerH - h;
            const showLabel = n <= 16 || i % Math.ceil(n / 16) === 0;
            return (
              <g key={b.period}>
                <rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(0, h)}
                  rx={3}
                  fill={metric.color}
                  opacity={0.85}
                >
                  <title>{`${shortDate(b.period)}: ${v.toFixed(0)} ${metric.unit}`}</title>
                </rect>
                {showLabel && (
                  <text
                    x={x + barW / 2}
                    y={H - 8}
                    className="axis"
                    textAnchor="middle"
                  >
                    {shortDate(b.period)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
