import { AnalysisFailure } from "@/lib/analysis/errors";
import type { AnalysisLimits } from "@/lib/analysis/limits";
import type { AnalysisPlan, ColumnProfile, DatasetProfile, Filter, Metric } from "@/lib/analysis/types";

const NUMERIC_AGGREGATIONS = new Set<Metric["agg"]>(["sum", "mean", "min", "max"]);

export function metricOutputName(metric: Metric): string {
  if (metric.agg === "count" && !metric.column) {
    return "count";
  }

  return `${metric.agg}_${metric.column}`;
}

export function validateAnalysisPlan(
  plan: AnalysisPlan,
  profile: DatasetProfile,
  limits: Pick<AnalysisLimits, "maxResultRows">,
): void {
  if (plan.limit > limits.maxResultRows) {
    throw failure(
      `Result limit ${plan.limit} exceeds the configured maximum of ${limits.maxResultRows} rows.`,
      { code: "result_limit", limit: plan.limit, maxResultRows: limits.maxResultRows },
    );
  }

  const columns = new Map(profile.columns.map((column) => [column.name, column]));

  if (plan.operation === "trend") {
    const timeColumn = requireColumn(columns, plan.timeColumn ?? "");
    if (timeColumn.type !== "date") {
      throw failure(`Column '${timeColumn.name}' is not a date column.`, {
        code: "invalid_time_column",
        column: timeColumn.name,
      });
    }
    if (!plan.grain) {
      throw failure("Trend requires a grain of year, quarter, or month.", { code: "invalid_operation" });
    }
  }

  for (const name of plan.groupBy) {
    assertUsableColumn(requireColumn(columns, name), "group");
  }

  for (const name of plan.select) {
    assertUsableColumn(requireColumn(columns, name), "select");
  }

  const metricNames = plan.metrics.map((metric) => {
    validateMetric(metric, columns);
    return metricOutputName(metric);
  });

  if (new Set(metricNames).size !== metricNames.length) {
    throw failure("Metric output names must be unique.", { code: "invalid_metric" });
  }

  const outputColumns = resultColumnNames(plan, metricNames);
  if (new Set(outputColumns).size !== outputColumns.length) {
    throw failure("Result column names must be unique.", { code: "invalid_metric" });
  }

  for (const filter of plan.filters) {
    validateFilter(filter, requireColumn(columns, filter.column));
  }

  if (plan.sortBy && !outputColumns.includes(plan.sortBy)) {
    throw failure(`Unknown column: ${plan.sortBy}.`, { code: "unknown_column", column: plan.sortBy });
  }
}

function resultColumnNames(plan: AnalysisPlan, metricNames: string[]): string[] {
  if (plan.operation === "detail") {
    return plan.select;
  }
  if (plan.operation === "trend") {
    return ["period", ...metricNames];
  }
  return [...plan.groupBy, ...metricNames];
}

function validateMetric(metric: Metric, columns: Map<string, ColumnProfile>): void {
  if (metric.agg !== "count" && !metric.column) {
    throw failure(`Aggregation '${metric.agg}' requires a column.`, { code: "invalid_metric", agg: metric.agg });
  }

  if (!metric.column) {
    return;
  }

  const column = requireColumn(columns, metric.column);
  if (column.type === "unknown") {
    throw failure(`Cannot aggregate unknown column '${column.name}'.`, {
      code: "invalid_metric",
      column: column.name,
    });
  }

  if (NUMERIC_AGGREGATIONS.has(metric.agg) && column.type !== "number") {
    throw failure(`Cannot ${metric.agg} non-numeric column '${column.name}'.`, {
      code: "invalid_metric",
      column: column.name,
      agg: metric.agg,
    });
  }
}

function validateFilter(filter: Filter, column: ColumnProfile): void {
  if (column.type === "unknown") {
    throw failure(`Cannot filter unknown column '${column.name}'.`, {
      code: "invalid_filter",
      column: column.name,
    });
  }

  if (column.type === "string" && !["eq", "neq", "in"].includes(filter.op)) {
    throw failure(`Operator '${filter.op}' is not valid for string column '${column.name}'.`, {
      code: "invalid_filter",
      column: column.name,
      op: filter.op,
    });
  }

  if (column.type === "boolean" && !["eq", "neq"].includes(filter.op)) {
    throw failure(`Operator '${filter.op}' is not valid for boolean column '${column.name}'.`, {
      code: "invalid_filter",
      column: column.name,
      op: filter.op,
    });
  }

  if (filter.op === "between") {
    if (!Array.isArray(filter.value) || filter.value.length !== 2) {
      throw failure(`Between filter for '${column.name}' requires two values.`, {
        code: "invalid_filter",
        column: column.name,
      });
    }
    filter.value.forEach((value) => assertFilterScalar(value, column, filter.op));
    return;
  }

  if (filter.op === "in") {
    if (!Array.isArray(filter.value) || filter.value.length === 0) {
      throw failure(`In filter for '${column.name}' requires a non-empty list.`, {
        code: "invalid_filter",
        column: column.name,
      });
    }
    filter.value.forEach((value) => assertFilterScalar(value, column, filter.op));
    return;
  }

  if (Array.isArray(filter.value)) {
    throw failure(`Filter value for '${column.name}' must be a single value.`, {
      code: "invalid_filter",
      column: column.name,
    });
  }

  assertFilterScalar(filter.value, column, filter.op);
}

function assertFilterScalar(value: string | number | boolean, column: ColumnProfile, op: Filter["op"]): void {
  if (column.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw failure(`Filter value for '${column.name}' must be a finite number.`, {
        code: "invalid_filter",
        column: column.name,
        op,
      });
    }
    return;
  }

  if (column.type === "string") {
    if (typeof value !== "string") {
      throw failure(`Filter value for '${column.name}' must be a string.`, {
        code: "invalid_filter",
        column: column.name,
        op,
      });
    }
    return;
  }

  if (column.type === "boolean") {
    if (typeof value !== "boolean") {
      throw failure(`Filter value for '${column.name}' must be true or false.`, {
        code: "invalid_filter",
        column: column.name,
        op,
      });
    }
    return;
  }

  if (typeof value !== "string" || !isIsoDate(value)) {
    throw failure(`Filter value for '${column.name}' must be an ISO date (YYYY-MM-DD).`, {
      code: "invalid_filter",
      column: column.name,
      op,
    });
  }
}

function assertUsableColumn(column: ColumnProfile, use: "group" | "select"): void {
  if (column.type !== "unknown") {
    return;
  }

  throw failure(`Cannot ${use} unknown column '${column.name}'.`, {
    code: "invalid_column",
    column: column.name,
  });
}

function requireColumn(columns: Map<string, ColumnProfile>, name: string): ColumnProfile {
  const column = columns.get(name);
  if (!column) {
    throw failure(`Unknown column: ${name || "(missing)"}.`, { code: "unknown_column", column: name });
  }
  return column;
}

export function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function failure(message: string, details: Record<string, unknown>): AnalysisFailure {
  return new AnalysisFailure({ stage: "validate-plan", message, details });
}
