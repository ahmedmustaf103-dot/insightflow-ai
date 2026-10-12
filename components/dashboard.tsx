import type { ChartSpec } from "@/lib/analysis/types";
import type { DashboardOverview, OverviewCard } from "@/lib/datasets/overview-types";
import { AnalysisChart } from "@/components/analysis-chart";
import { ResultTable } from "@/components/result-table";

export function Dashboard({ overview }: { overview: DashboardOverview }) {
  return (
    <div className="flex flex-col gap-5">
      {overview.trend ? (
        <section className="rounded-3xl border border-line bg-card px-5 py-5 shadow-sm sm:px-6" aria-labelledby="trend-heading">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="trend-heading" className="text-sm font-medium text-muted">
                {overview.trend.title}
              </h2>
              <p className="mt-2 flex items-center gap-3 text-3xl font-semibold tracking-tight">
                {overview.trend.total}
                {overview.trend.delta ? <Delta label={overview.trend.delta} positive={overview.trend.positive === true} /> : null}
              </p>
            </div>
            <p className="text-sm text-muted">{overview.trend.period}</p>
          </div>
          <div className="mt-4">
            <AnalysisChart
              chart={{ type: "line", x: "period", y: overview.trend.measure } satisfies ChartSpec}
              result={overview.trend.result}
            />
          </div>
        </section>
      ) : null}
      {overview.ranking ? (
        <section className="rounded-3xl border border-line bg-card px-5 py-5 shadow-sm sm:px-6" aria-labelledby="ranking-heading">
          <div className="flex items-center justify-between gap-4">
            <h2 id="ranking-heading" className="text-lg font-semibold tracking-tight">
              {overview.ranking.title}
            </h2>
            <p className="text-sm text-muted">{overview.ranking.period}</p>
          </div>
          <div className="mt-2">
            <ResultTable result={overview.ranking.result} />
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function MetricRow({ cards }: { cards: OverviewCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <article key={card.label} className="rounded-3xl border border-line bg-card px-4 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <MetricIcon tone={card.tone} />
            <p className="text-sm text-muted">{card.label}</p>
          </div>
          <p className="mt-4 text-2xl font-semibold tracking-tight">{card.value}</p>
          {card.detail ? (
            <p className={`mt-1 text-xs font-medium ${card.positive ? "text-positive" : "text-danger"}`}>{card.detail}</p>
          ) : (
            <p className="mt-1 text-xs text-muted">From this dataset</p>
          )}
        </article>
      ))}
    </div>
  );
}

function Delta({ label, positive }: { label: string; positive: boolean }) {
  return (
    <span className={`rounded-full px-2 py-1 text-xs font-medium ${positive ? "bg-positive-bg text-positive" : "bg-danger-bg text-danger"}`}>
      {label}
    </span>
  );
}

function MetricIcon({ tone }: { tone: OverviewCard["tone"] }) {
  const tones = {
    amber: "bg-amber-100 text-amber-600",
    blue: "bg-blue-100 text-accent",
    violet: "bg-violet-100 text-violet-600",
    teal: "bg-teal-100 text-teal-600",
  };
  return (
    <span className={`grid h-9 w-9 place-items-center rounded-xl ${tones[tone]}`} aria-hidden="true">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 16.5 9 11l3 3 8-8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M16 6h4v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
