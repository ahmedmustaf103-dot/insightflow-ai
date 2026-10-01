import { describe, expect, it } from "vitest";
import { createGeminiProvider } from "@/lib/ai/gemini";
import { orchestrateAnalysis } from "@/lib/analysis/orchestrate";
import { salesCsv } from "../helpers";

const hasApiKey = Boolean(process.env.GEMINI_API_KEY?.trim());

describe.skipIf(!hasApiKey)("live Gemini revenue question", () => {
  it("plans, calculates, and explains the 2025 product revenue ranking", async () => {
    const response = await orchestrateAnalysis({
      csvPath: salesCsv,
      datasetId: "sales-demo",
      fileName: "sales.csv",
      question: "Which products generated the most revenue in 2025?",
      llm: createGeminiProvider(),
    });

    expect(response.evidence.plan.operation).toBe("aggregate");
    expect(response.evidence.plan.groupBy).toEqual(["product"]);
    expect(response.evidence.plan.metrics).toEqual([{ column: "revenue", agg: "sum" }]);
    expect(response.evidence.plan.sortDirection).toBe("desc");
    expect(response.evidence.plan.filters.some((filter) => filter.column === "order_date")).toBe(true);
    expect(response.evidence.result.rows).toEqual([
      { product: "Sensor", sum_revenue: 500 },
      { product: "Gadget", sum_revenue: 340 },
      { product: "Widget", sum_revenue: 325 },
      { product: "Gizmo", sum_revenue: 180 },
      { product: "Cable", sum_revenue: 60 },
    ]);
    expect(response.evidence.engine).toBe("pandas");
    expect(response.chart).toEqual({ type: "bar", x: "product", y: "sum_revenue" });
    expect(response.answer.trim().length).toBeGreaterThan(0);
  });
});
