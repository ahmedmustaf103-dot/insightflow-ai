import type { AnalysisPlan, AnalysisResult, ChartSpec } from "@/lib/analysis/types";

export function deriveChartSpec(plan: AnalysisPlan, result: AnalysisResult): ChartSpec {
  const numericColumns = result.columns.filter((column) => column.type === "number");
  if (result.rowCount === 0 || numericColumns.length === 0) {
    return { type: "table" };
  }

  const measure = numericColumns[0];
  if (!measure) {
    return { type: "table" };
  }

  if (plan.operation === "trend") {
    const period = result.columns.find((column) => column.name === "period");
    if (period) {
      return { type: "line", x: period.name, y: measure.name };
    }
  }

  if (plan.operation === "aggregate" && plan.groupBy.length === 1 && numericColumns.length === 1) {
    const dimension = result.columns.find((column) => column.name === plan.groupBy[0]);
    if (dimension) {
      return { type: "bar", x: dimension.name, y: measure.name };
    }
  }

  return { type: "table" };
}
