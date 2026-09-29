import { describe, expect, it } from "vitest";
import { executeAnalysis } from "@/lib/analysis/execute";
import detailRequest from "./fixtures/requests/detail.json";
import { plan, salesCsv } from "./helpers";

describe("detail", () => {
  it("filters, selects, sorts, and limits", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: detailRequest.plan,
    });

    expect(result.columns).toEqual([
      { name: "product", type: "string" },
      { name: "revenue", type: "number" },
      { name: "order_date", type: "date" },
    ]);
    expect(result.truncated).toBe(true);
    expect(result.rows).toEqual([
      { product: "Sensor", revenue: 250, order_date: "2024-12-12" },
      { product: "Widget", revenue: 200, order_date: "2025-01-20" },
      { product: "Widget", revenue: 100, order_date: "2024-01-15" },
    ]);
  });

  it("sorts ascending when asked", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "detail",
        filters: [{ column: "product", op: "eq", value: "Cable" }],
        select: ["order_date", "revenue"],
        sortBy: "revenue",
        sortDirection: "asc",
        limit: 2,
      }),
    });

    expect(result.rows).toEqual([
      { order_date: "2025-09-09", revenue: 15 },
      { order_date: "2024-04-04", revenue: 25 },
    ]);
  });
});
