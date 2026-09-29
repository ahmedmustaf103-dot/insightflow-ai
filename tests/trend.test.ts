import { describe, expect, it } from "vitest";
import { executeAnalysis } from "@/lib/analysis/execute";
import monthRequest from "./fixtures/requests/trend-month.json";
import yearRequest from "./fixtures/requests/trend-year.json";
import { plan, salesCsv } from "./helpers";

describe("trend", () => {
  it("aggregates revenue by year", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: yearRequest.plan,
    });

    expect(result.columns.map((column) => [column.name, column.type])).toEqual([
      ["period", "string"],
      ["sum_revenue", "number"],
    ]);
    expect(result.rows).toEqual([
      { period: "2024", sum_revenue: 1415 },
      { period: "2025", sum_revenue: 1405 },
    ]);
  });

  it("aggregates revenue by month", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: monthRequest.plan,
    });

    expect(result.rows).toEqual([
      { period: "2025-01", sum_revenue: 200 },
      { period: "2025-02", sum_revenue: 300 },
      { period: "2025-03", sum_revenue: 50 },
      { period: "2025-04", sum_revenue: 45 },
      { period: "2025-05", sum_revenue: 110 },
      { period: "2025-06", sum_revenue: 400 },
      { period: "2025-07", sum_revenue: 100 },
      { period: "2025-08", sum_revenue: 40 },
      { period: "2025-09", sum_revenue: 15 },
      { period: "2025-11", sum_revenue: 75 },
      { period: "2025-12", sum_revenue: 70 },
    ]);
  });

  it("aggregates revenue by quarter", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "trend",
        filters: [{ column: "order_date", op: "between", value: ["2024-01-01", "2024-12-31"] }],
        metrics: [{ column: "revenue", agg: "sum" }],
        timeColumn: "order_date",
        grain: "quarter",
      }),
    });

    expect(result.rows).toEqual([
      { period: "2024-Q1", sum_revenue: 250 },
      { period: "2024-Q2", sum_revenue: 675 },
      { period: "2024-Q3", sum_revenue: 120 },
      { period: "2024-Q4", sum_revenue: 370 },
    ]);
  });
});
