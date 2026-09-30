import { describe, expect, it } from "vitest";
import { deriveChartSpec } from "@/lib/charts/spec";
import { analysisResponseSchema, type AnalysisPlan, type AnalysisResult } from "@/lib/analysis/types";
import { plan } from "./helpers";

const rows = (result: Partial<AnalysisResult> & Pick<AnalysisResult, "columns" | "rows">): AnalysisResult => ({
  rowCount: result.rows.length,
  truncated: false,
  ...result,
});

describe("chart spec", () => {
  it("uses a bar for one category and one metric", () => {
    const analysisPlan = plan({
      operation: "aggregate",
      groupBy: ["product"],
      metrics: [{ column: "revenue", agg: "sum" }],
    });
    const result = rows({
      columns: [
        { name: "product", type: "string" },
        { name: "sum_revenue", type: "number" },
      ],
      rows: [{ product: "Sensor", sum_revenue: 500 }],
    });

    expect(deriveChartSpec(analysisPlan, result)).toEqual({
      type: "bar",
      x: "product",
      y: "sum_revenue",
    });
  });

  it("uses a line for a trend", () => {
    const analysisPlan: AnalysisPlan = plan({
      operation: "trend",
      metrics: [{ column: "revenue", agg: "sum" }],
      timeColumn: "order_date",
      grain: "year",
    });
    const result = rows({
      columns: [
        { name: "period", type: "string" },
        { name: "sum_revenue", type: "number" },
      ],
      rows: [{ period: "2025", sum_revenue: 1405 }],
    });

    expect(deriveChartSpec(analysisPlan, result)).toEqual({
      type: "line",
      x: "period",
      y: "sum_revenue",
    });
  });

  it("uses a table for detail rows and builds a response envelope", () => {
    const analysisPlan = plan({
      operation: "detail",
      select: ["product", "revenue"],
    });
    const result = rows({
      columns: [
        { name: "product", type: "string" },
        { name: "revenue", type: "number" },
      ],
      rows: [{ product: "Cable", revenue: 15 }],
    });

    expect(deriveChartSpec(analysisPlan, result)).toEqual({ type: "table" });
    expect(
      analysisResponseSchema.parse({
        answer: "Cable revenue is 15.",
        evidence: {
          datasetId: "sales-demo",
          question: "Show cable revenue.",
          plan: analysisPlan,
          result,
          engine: "pandas",
        },
        chart: { type: "table" },
        warnings: [],
      }).chart,
    ).toEqual({ type: "table" });
  });

  it("uses a table when the result is empty or has more than one metric", () => {
    const grouped = plan({
      operation: "aggregate",
      groupBy: ["product"],
      metrics: [
        { column: "revenue", agg: "sum" },
        { column: "revenue", agg: "mean" },
      ],
    });
    const twoMetrics = rows({
      columns: [
        { name: "product", type: "string" },
        { name: "sum_revenue", type: "number" },
        { name: "mean_revenue", type: "number" },
      ],
      rows: [{ product: "Sensor", sum_revenue: 500, mean_revenue: 250 }],
    });
    const empty = rows({
      columns: [
        { name: "product", type: "string" },
        { name: "sum_revenue", type: "number" },
      ],
      rows: [],
    });

    expect(deriveChartSpec(grouped, twoMetrics)).toEqual({ type: "table" });
    expect(
      deriveChartSpec(
        plan({
          operation: "aggregate",
          groupBy: ["product"],
          metrics: [{ column: "revenue", agg: "sum" }],
        }),
        empty,
      ),
    ).toEqual({ type: "table" });
  });
});
