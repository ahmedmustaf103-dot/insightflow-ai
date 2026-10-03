import type { AnalysisPlan, AnalysisResult, ColumnType, Filter } from "@/lib/analysis/types";

export type Fact = {
  label: string;
  value: string;
};

const TYPE_LABELS: Record<ColumnType, string> = {
  string: "Text",
  number: "Number",
  date: "Date",
  boolean: "Boolean",
  unknown: "Unknown",
};

const OPERATIONS: Record<AnalysisPlan["operation"], string> = {
  aggregate: "Aggregate",
  trend: "Trend",
  detail: "Detail",
};

export function columnLabel(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

export function typeLabel(type: ColumnType): string {
  return TYPE_LABELS[type];
}

export function resultHeader(name: string): string {
  if (name === "count") return "Count";
  if (name === "period") return "Period";
  const metric = /^(?:sum|mean|min|max|count)_(.+)$/.exec(name);
  return columnLabel(metric?.[1] ?? name);
}

export function formatValue(columnName: string, value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatNumber(columnName, value);
  }
  return String(value);
}

export function presentWarning(warning: string): string {
  const ambiguous = /^Column '([^']+)' uses ambiguous day\/month dates/.exec(warning);
  if (ambiguous?.[1]) {
    return `${columnLabel(ambiguous[1])} has ambiguous dates, so it is excluded from time analysis.`;
  }
  const mixed = /^Column '([^']+)' has mixed value types/.exec(warning);
  if (mixed?.[1]) {
    return `${columnLabel(mixed[1])} has mixed value types, so it is excluded from calculations.`;
  }
  return warning;
}

export function evidenceFacts(plan: AnalysisPlan): Fact[] {
  return planFacts(plan).filter((fact) => fact.label !== "Sort" && fact.label !== "Limit");
}

export function planFacts(plan: AnalysisPlan): Fact[] {
  const facts: Fact[] = [{ label: "Operation", value: OPERATIONS[plan.operation] }];

  for (const filter of plan.filters) {
    facts.push({ label: "Filter", value: formatFilter(filter) });
  }

  if (plan.groupBy.length > 0) {
    facts.push({ label: "Group by", value: plan.groupBy.map(columnLabel).join(", ") });
  }

  if (plan.operation === "trend" && plan.timeColumn && plan.grain) {
    facts.push({
      label: "Time",
      value: `${columnLabel(plan.timeColumn)} by ${plan.grain}`,
    });
  }

  if (plan.metrics.length > 0) {
    facts.push({
      label: "Metric",
      value: plan.metrics
        .map((metric) =>
          metric.column ? `${metric.agg.toUpperCase()}(${columnLabel(metric.column)})` : metric.agg.toUpperCase(),
        )
        .join(", "),
    });
  }

  if (plan.operation === "detail" && plan.select.length > 0) {
    facts.push({ label: "Columns", value: plan.select.map(columnLabel).join(", ") });
  }

  if (plan.sortBy) {
    const direction = plan.sortDirection === "asc" ? "↑" : "↓";
    facts.push({ label: "Sort", value: `${resultHeader(plan.sortBy)} ${direction}` });
  }

  facts.push({ label: "Limit", value: String(plan.limit) });
  return facts;
}

export function isEmptyResult(result: AnalysisResult): boolean {
  return result.rowCount === 0;
}

function formatFilter(filter: Filter): string {
  const column = columnLabel(filter.column);
  if (filter.op === "between" && Array.isArray(filter.value) && filter.value.length === 2) {
    const [start, end] = filter.value;
    if (typeof start === "string" && typeof end === "string") {
      const year = /^(\d{4})-01-01$/.exec(start);
      const endYear = /^(\d{4})-12-31$/.exec(end);
      if (year?.[1] && year[1] === endYear?.[1]) {
        return `${column} → ${year[1]}`;
      }
    }
    return `${column} between ${String(start)} and ${String(end)}`;
  }

  const ops: Record<Filter["op"], string> = {
    eq: "is",
    neq: "is not",
    gt: ">",
    gte: "≥",
    lt: "<",
    lte: "≤",
    in: "in",
    between: "between",
  };
  const value = Array.isArray(filter.value) ? filter.value.map(String).join(", ") : String(filter.value);
  return `${column} ${ops[filter.op]} ${value}`;
}

function formatNumber(columnName: string, value: number): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  if (isMoneyColumn(columnName)) {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: digits }).format(value);
}

function isMoneyColumn(columnName: string): boolean {
  const base = columnName.replace(/^(?:sum|mean|min|max|count)_/, "");
  return /revenue|price|cost|amount|sales/.test(base);
}
