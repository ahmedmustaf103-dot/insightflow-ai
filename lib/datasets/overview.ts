import { executeAnalysis } from "@/lib/analysis/execute";
import { DEFAULT_LIMITS } from "@/lib/analysis/limits";
import { columnLabel, formatValue } from "@/lib/analysis/present";
import type { AnalysisPlan, AnalysisResult, ColumnProfile, DatasetProfile } from "@/lib/analysis/types";
import { validateAnalysisPlan } from "@/lib/analysis/validate-plan";
import type { DashboardOverview, OverviewCard } from "@/lib/datasets/overview-types";
import { loadDataset, uploadRoot } from "@/lib/datasets/store";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function buildDashboardOverview(datasetId: string, root = uploadRoot()): Promise<DashboardOverview> {
  const stored = await loadDataset(datasetId, root);
  const { profile } = stored;
  const metric = profile.columns.find((column) => column.type === "number");
  const secondary = profile.columns.find((column) => column.type === "number" && column.name !== metric?.name);
  const dimension = profile.columns.find((column) => column.type === "string");
  const date = profile.columns.find((column) => column.type === "date");
  const year = latestYear(date);

  const cards: OverviewCard[] = [
    {
      label: "Records",
      value: profile.rowCount.toLocaleString("en-GB"),
      tone: "amber",
    },
  ];

  let yearly: AnalysisResult | null = null;
  if (metric && date) {
    yearly = await tryExecute(
      stored.csvPath,
      profile,
      plan({
        operation: "trend",
        metrics: metricsFor(metric, secondary),
        timeColumn: date.name,
        grain: "year",
        limit: 20,
      }),
    );
  }

  const metricName = metric ? `sum_${metric.name}` : "";
  const yearlyRows = yearly?.rows ?? [];
  const total = metric ? sumColumn(yearlyRows, metricName) : null;
  if (metric && total !== null) {
    const delta = yearDelta(yearlyRows, metricName);
    cards.push({
      label: `Total ${columnLabel(metric.name)}`,
      value: formatValue(metric.name, total),
      detail: delta ? `${delta.label} vs last year` : undefined,
      positive: delta?.positive,
      tone: "blue",
    });
  }

  if (dimension) {
    cards.push({
      label: columnLabel(dimension.name),
      value: dimension.distinctCount.toLocaleString("en-GB"),
      tone: "violet",
    });
  }

  if (secondary && yearly) {
    const quantity = sumColumn(yearly.rows, `sum_${secondary.name}`);
    if (quantity !== null) {
      cards.push({
        label: `Total ${columnLabel(secondary.name)}`,
        value: formatValue(secondary.name, quantity),
        tone: "teal",
      });
    }
  }

  if (!metric) {
    cards.push({
      label: "Columns",
      value: String(profile.columns.length),
      tone: "blue",
    });
  }

  const trendResult =
    metric && date && year
      ? await tryExecute(
          stored.csvPath,
          profile,
          plan({
            operation: "trend",
            filters: [{ column: date.name, op: "between", value: [`${year}-01-01`, `${year}-12-31`] }],
            metrics: [{ column: metric.name, agg: "sum" }],
            timeColumn: date.name,
            grain: "month",
            limit: 12,
          }),
        )
      : null;

  const ranking =
    metric && dimension
      ? await tryExecute(
          stored.csvPath,
          profile,
          plan({
            operation: "aggregate",
            filters:
              date && year
                ? [{ column: date.name, op: "between", value: [`${year}-01-01`, `${year}-12-31`] }]
                : [],
            groupBy: [dimension.name],
            metrics: metricsFor(metric, secondary),
            sortBy: metricName,
            sortDirection: "desc",
            limit: 5,
          }),
        )
      : null;

  const trendDelta = yearDelta(yearlyRows, metricName);

  return {
    cards: cards.slice(0, 4),
    trend:
      metric && trendResult
        ? {
            title: `Overall ${columnLabel(metric.name).toLowerCase()}`,
            period: year ? String(year) : "All time",
            total: formatValue(metric.name, sumColumn(trendResult.rows, metricName) ?? 0),
            delta: trendDelta?.label,
            positive: trendDelta?.positive,
            measure: metricName,
            result: fillMonths(trendResult, year, metricName),
          }
        : null,
    ranking:
      ranking && dimension
        ? {
            title: `Best selling`,
            period: year ? String(year) : "All time",
            result: ranking,
          }
        : null,
  };
}

function metricsFor(metric: ColumnProfile, secondary: ColumnProfile | undefined): AnalysisPlan["metrics"] {
  const metrics: AnalysisPlan["metrics"] = [{ column: metric.name, agg: "sum" }];
  if (secondary) metrics.push({ column: secondary.name, agg: "sum" });
  return metrics;
}

function plan(overrides: Partial<AnalysisPlan> & Pick<AnalysisPlan, "operation">): AnalysisPlan {
  return {
    filters: [],
    groupBy: [],
    metrics: [],
    select: [],
    limit: 20,
    rationale: "Overview of the loaded dataset.",
    ...overrides,
  };
}

async function tryExecute(csvPath: string, profile: DatasetProfile, next: AnalysisPlan): Promise<AnalysisResult | null> {
  try {
    validateAnalysisPlan(next, profile, DEFAULT_LIMITS);
    return await executeAnalysis({ csvPath, plan: next });
  } catch {
    return null;
  }
}

function latestYear(date: ColumnProfile | undefined): string | null {
  if (!date || typeof date.max !== "string") return null;
  const year = /^(\d{4})/.exec(date.max)?.[1];
  return year ?? null;
}

function sumColumn(rows: AnalysisResult["rows"], name: string): number | null {
  if (!name || rows.length === 0) return null;
  let total = 0;
  for (const row of rows) {
    const value = row[name];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function yearDelta(rows: AnalysisResult["rows"], name: string): { label: string; positive: boolean } | null {
  if (rows.length < 2) return null;
  const previous = rows[rows.length - 2]?.[name];
  const current = rows[rows.length - 1]?.[name];
  if (typeof previous !== "number" || typeof current !== "number" || previous === 0) return null;
  const change = Math.round(((current - previous) / Math.abs(previous)) * 100);
  return { label: `${change > 0 ? "+" : ""}${change}%`, positive: change >= 0 };
}

function fillMonths(result: AnalysisResult, year: string | null, measure: string): AnalysisResult {
  if (!year) return result;
  const byPeriod = new Map(result.rows.map((row) => [String(row.period), row]));
  const rows = MONTHS.map((_, index) => {
    const period = `${year}-${String(index + 1).padStart(2, "0")}`;
    return byPeriod.get(period) ?? { period, [measure]: 0 };
  });
  return { ...result, rows, rowCount: rows.length, truncated: false };
}
