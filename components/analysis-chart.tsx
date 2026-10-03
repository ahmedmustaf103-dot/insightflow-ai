import type { ChartSpec, AnalysisResult } from "@/lib/analysis/types";
import { formatValue, resultHeader } from "@/lib/analysis/present";
import { ResultTable } from "@/components/result-table";

type Point = { label: string; value: number };

export function AnalysisChart({ chart, result }: { chart: ChartSpec; result: AnalysisResult }) {
  if (result.rowCount === 0) return null;
  if (chart.type === "table") return <ResultTable result={result} />;

  const points = pointsFrom(chart, result);
  if (points.length === 0) return <ResultTable result={result} />;
  if (chart.type === "bar") {
    return <BarChart points={points} measure={chart.y} label={`Bar chart of ${resultHeader(chart.y)} by ${resultHeader(chart.x)}`} />;
  }
  return <LineChart points={points} measure={chart.y} label={`Line chart of ${resultHeader(chart.y)} over ${resultHeader(chart.x)}`} />;
}

function BarChart({ points, measure, label }: { points: Point[]; measure: string; label: string }) {
  const max = Math.max(...points.map((point) => point.value), 0);
  return (
    <div role="img" aria-label={label} className="space-y-3">
      {points.map((point) => {
        const width = max === 0 ? 0 : Math.max(4, (point.value / max) * 100);
        return (
          <div key={point.label} className="grid grid-cols-[minmax(4.5rem,7rem)_1fr_auto] items-center gap-3">
            <span className="truncate text-sm font-medium">{point.label}</span>
            <span className="h-2.5 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
            </span>
            <span className="text-sm tabular-nums text-muted">{formatValue(measure, point.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function LineChart({ points, measure, label }: { points: Point[]; measure: string; label: string }) {
  const width = 640;
  const height = 280;
  const pad = { top: 16, right: 12, bottom: 36, left: 12 };
  const min = Math.min(...points.map((point) => point.value));
  const max = Math.max(...points.map((point) => point.value));
  const span = max - min || 1;
  const coords = points.map((point, index) => {
    const x = pad.left + (index * (width - pad.left - pad.right)) / Math.max(points.length - 1, 1);
    const y = pad.top + ((max - point.value) / span) * (height - pad.top - pad.bottom);
    return { ...point, x, y };
  });
  const path = coords.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full text-accent">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.5" />
      {coords.map((point) => (
        <g key={`${point.label}-${point.x}`}>
          <circle cx={point.x} cy={point.y} r="4" fill="currentColor" />
          <text x={point.x} y={height - 12} textAnchor="middle" className="fill-muted text-[11px]">
            {point.label}
          </text>
          <text x={point.x} y={point.y - 10} textAnchor="middle" className="fill-ink text-[11px]">
            {formatValue(measure, point.value)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function pointsFrom(chart: Extract<ChartSpec, { type: "bar" | "line" }>, result: AnalysisResult): Point[] {
  return result.rows.flatMap((row) => {
    const value = row[chart.y];
    const label = row[chart.x];
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    return [{ label: label === null || label === undefined ? "—" : String(label), value }];
  });
}
