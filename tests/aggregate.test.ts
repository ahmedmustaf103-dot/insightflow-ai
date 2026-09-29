import { describe, expect, it } from "vitest";
import { executeAnalysis } from "@/lib/analysis/execute";
import { analysisPlanSchema, createEvidence } from "@/lib/analysis/types";
import aggregateRequest from "./fixtures/requests/aggregate.json";
import { plan, salesCsv } from "./helpers";

describe("aggregate", () => {
  it("sums 2025 revenue by product", async () => {
    const analysisPlan = analysisPlanSchema.parse(aggregateRequest.plan);
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: analysisPlan,
    });

    expect(result.truncated).toBe(false);
    expect(result.columns.map((column) => column.name)).toEqual(["product", "sum_revenue"]);
    expect(result.rows).toEqual([
      { product: "Sensor", sum_revenue: 500 },
      { product: "Gadget", sum_revenue: 340 },
      { product: "Widget", sum_revenue: 325 },
      { product: "Gizmo", sum_revenue: 180 },
      { product: "Cable", sum_revenue: 60 },
    ]);

    const evidence = createEvidence({
      datasetId: "sales-demo",
      question: "Which products generated the most revenue in 2025?",
      plan: analysisPlan,
      result,
      engine: "pandas",
    });
    expect(evidence.engine).toBe("pandas");
    expect(evidence.result.rowCount).toBe(5);
  });

  it("averages revenue for one product", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "aggregate",
        filters: [{ column: "product", op: "eq", value: "Widget" }],
        groupBy: ["product"],
        metrics: [{ column: "revenue", agg: "mean" }],
      }),
    });

    expect(result.rows).toEqual([{ product: "Widget", mean_revenue: 115 }]);
  });

  it("counts rows, including a column count that skips nulls", async () => {
    const rows = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "aggregate",
        metrics: [{ agg: "count" }],
      }),
    });
    const quantities = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "aggregate",
        metrics: [{ column: "quantity", agg: "count" }],
      }),
    });

    expect(rows.rows).toEqual([{ count: 22 }]);
    expect(quantities.rows).toEqual([{ count_quantity: 21 }]);
  });

  it("groups, sorts, filters, and limits", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "aggregate",
        filters: [{ column: "revenue", op: "gte", value: 200 }],
        groupBy: ["product"],
        metrics: [
          { column: "revenue", agg: "sum" },
          { column: "revenue", agg: "min" },
          { column: "revenue", agg: "max" },
        ],
        sortBy: "sum_revenue",
        sortDirection: "desc",
        limit: 2,
      }),
    });

    expect(result.truncated).toBe(true);
    expect(result.rowCount).toBe(2);
    expect(result.rows).toEqual([
      { product: "Sensor", sum_revenue: 1150, min_revenue: 250, max_revenue: 500 },
      { product: "Gadget", sum_revenue: 300, min_revenue: 300, max_revenue: 300 },
    ]);
  });

  it("filters with in and returns an empty grouped result", async () => {
    const northAndSouth = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "aggregate",
        filters: [{ column: "region", op: "in", value: ["North", "South"] }],
        metrics: [{ agg: "count" }],
      }),
    });
    const empty = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "aggregate",
        filters: [{ column: "product", op: "eq", value: "Missing" }],
        groupBy: ["product"],
        metrics: [{ column: "revenue", agg: "sum" }],
      }),
    });

    expect(northAndSouth.rows).toEqual([{ count: 12 }]);
    expect(empty).toMatchObject({ rowCount: 0, rows: [], truncated: false });
  });
});
