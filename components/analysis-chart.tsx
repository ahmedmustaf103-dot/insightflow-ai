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
  const height = 210;
  const pad = { top: 32, right: 16, bottom: 28, left: 8 };
  const max = Math.max(...points.map((point) => point.value), 0);
  const span = max || 1;
  const coords = points.map((point, index) => {
    const x = pad.left + (index * (width - pad.left - pad.right)) / Math.max(points.length - 1, 1);
    const y = pad.top + ((max - point.value) / span) * (height - pad.top - pad.bottom);
    return { ...point, x, y };
  });
  const line = smoothPath(coords);
  const area = `${line} L ${coords[coords.length - 1]?.x ?? pad.left} ${height - pad.bottom} L ${coords[0]?.x ?? pad.left} ${height - pad.bottom} Z`;
  const peak = coords.reduce((best, point) => (point.value > best.value ? point : best), coords[0]);
  const labelStep = coords.length > 12 ? 2 : 1;

  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${width} ${height}`} className="h-auto w-full text-accent">
      <defs>
        <linearGradient id="trend-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.18" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 0.5, 1].map((step) => {
        const y = pad.top + step * (height - pad.top - pad.bottom);
        return <line key={step} x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#e7edf5" />;
      })}
      {coords.length > 1 ? <path d={area} fill="url(#trend-fill)" /> : null}
      <path d={line} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      {coords.map((point, index) =>
        index % labelStep === 0 ? (
          <text key={`${point.label}-${point.x}`} x={point.x} y={height - 8} textAnchor="middle" className="fill-muted text-[11px]">
            {axisLabel(point.label)}
          </text>
        ) : null,
      )}
      {peak ? (
        <g>
          <circle cx={peak.x} cy={peak.y} r="5" fill="currentColor" />
          <circle cx={peak.x} cy={peak.y} r="9" fill="currentColor" opacity="0.15" />
          <g transform={`translate(${Math.min(peak.x, width - 78)}, ${Math.max(peak.y - 28, 4)})`}>
            <rect width="74" height="22" rx="11" fill="#1e293b" />
            <text x="37" y="15" textAnchor="middle" fill="#ffffff" fontSize="11">
              {formatValue(measure, peak.value)}
            </text>
          </g>
        </g>
      ) : null}
    </svg>
  );
}

function smoothPath(coords: Array<Point & { x: number; y: number }>): string {
  const first = coords[0];
  if (!first) return "";
  let path = `M ${first.x} ${first.y}`;
  for (let index = 0; index < coords.length - 1; index += 1) {
    const current = coords[index];
    const next = coords[index + 1];
    if (!current || !next) continue;
    const control = (current.x + next.x) / 2;
    path += ` C ${control} ${current.y}, ${control} ${next.y}, ${next.x} ${next.y}`;
  }
  return path;
}

function axisLabel(label: string): string {
  const month = /^(\d{4})-(\d{2})$/.exec(label);
  if (!month) return label;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return names[Number(month[2]) - 1] ?? label;
}

function pointsFrom(chart: Extract<ChartSpec, { type: "bar" | "line" }>, result: AnalysisResult): Point[] {
  return result.rows.flatMap((row) => {
    const value = row[chart.y];
    const label = row[chart.x];
    if (typeof value !== "number" || !Number.isFinite(value)) return [];
    return [{ label: label === null || label === undefined ? "—" : String(label), value }];
  });
}
