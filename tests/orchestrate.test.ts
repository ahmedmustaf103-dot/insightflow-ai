import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_REGION_QUESTION,
  MockLLMProvider,
  MONTHLY_TREND_QUESTION,
  REVENUE_QUESTION,
  STRING_SUM_QUESTION,
  UNKNOWN_COLUMN_QUESTION,
} from "@/lib/ai/mock";
import type { ExplainInput, LLMProvider } from "@/lib/ai/provider";
import { orchestrateAnalysis } from "@/lib/analysis/orchestrate";
import { executeAnalysis } from "@/lib/analysis/execute";
import { deriveChartSpec } from "@/lib/charts/spec";
import { failureOf, salesCsv } from "./helpers";

const request = {
  csvPath: salesCsv,
  datasetId: "sales-demo",
  fileName: "sales.csv",
};

describe("orchestrate", () => {
  it("answers the 2025 revenue question from the Pandas result", async () => {
    const llm = new MockLLMProvider();
    const seen: ExplainInput[] = [];
    const provider: LLMProvider = {
      id: llm.id,
      createPlan: (input) => llm.createPlan(input),
      repairPlan: (input) => llm.repairPlan(input),
      explain: async (input) => {
        seen.push(input);
        return llm.explain(input);
      },
    };

    const response = await orchestrateAnalysis({ ...request, question: REVENUE_QUESTION, llm: provider });

    expect(response.evidence.plan).toMatchObject({
      operation: "aggregate",
      groupBy: ["product"],
      metrics: [{ column: "revenue", agg: "sum" }],
      sortBy: "sum_revenue",
      sortDirection: "desc",
    });
    expect(response.evidence.plan.filters).toEqual([
      { column: "order_date", op: "between", value: ["2025-01-01", "2025-12-31"] },
    ]);
    expect(response.evidence.result.rows).toEqual([
      { product: "Sensor", sum_revenue: 500 },
      { product: "Gadget", sum_revenue: 340 },
      { product: "Widget", sum_revenue: 325 },
      { product: "Gizmo", sum_revenue: 180 },
      { product: "Cable", sum_revenue: 60 },
    ]);
    expect(response.answer).toContain("500");
    expect(response.answer).toContain("340");
    expect(response.answer).toContain("60");
    expect(response.chart).toEqual({ type: "bar", x: "product", y: "sum_revenue" });
    expect(response.chart).toEqual(deriveChartSpec(response.evidence.plan, response.evidence.result));
    expect(seen[0]).toEqual({
      question: REVENUE_QUESTION,
      plan: response.evidence.plan,
      result: response.evidence.result,
    });
    expect(response.evidence.engine).toBe("pandas");
  });

  it("answers the monthly trend with a line chart", async () => {
    const response = await orchestrateAnalysis({
      ...request,
      question: MONTHLY_TREND_QUESTION,
      llm: new MockLLMProvider(),
    });

    expect(response.evidence.plan).toMatchObject({
      operation: "trend",
      timeColumn: "order_date",
      grain: "month",
      metrics: [{ column: "revenue", agg: "sum" }],
    });
    expect(response.evidence.result.rows).toEqual([
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
    expect(response.answer).toContain("200");
    expect(response.answer).toContain("2025-01");
    expect(response.chart).toEqual({ type: "line", x: "period", y: "sum_revenue" });
  });

  it("does not execute Python when the plan uses an unknown column", async () => {
    const execute = vi.fn(executeAnalysis);
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: UNKNOWN_COLUMN_QUESTION,
        llm: new MockLLMProvider(),
        executeAnalysis: execute,
      }),
    );

    expect(failure.error).toMatchObject({
      stage: "validate-plan",
      details: { code: "unknown_column", column: "profit" },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute Python when the plan sums a string column", async () => {
    const execute = vi.fn(executeAnalysis);
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: STRING_SUM_QUESTION,
        llm: new MockLLMProvider(),
        executeAnalysis: execute,
      }),
    );

    expect(failure.error.details).toMatchObject({ code: "invalid_metric", column: "product" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute Python when the plan shape is invalid", async () => {
    const execute = vi.fn(executeAnalysis);
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: "ignored",
        llm: {
          id: "bad-shape",
          createPlan: async () => ({ operation: "aggregate", total: 999 }) as never,
          repairPlan: async () => ({ operation: "aggregate" }) as never,
          explain: async () => "unused",
        },
        executeAnalysis: execute,
      }),
    );

    expect(failure.error).toMatchObject({ stage: "plan", details: { code: "invalid_plan" } });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns an empty result without inventing figures", async () => {
    const response = await orchestrateAnalysis({
      ...request,
      question: EMPTY_REGION_QUESTION,
      llm: new MockLLMProvider(),
    });

    expect(response.evidence.result).toMatchObject({ rowCount: 0, rows: [], truncated: false });
    expect(response.answer).toBe("No matching records were found.");
    expect(response.chart).toEqual({ type: "table" });
  });

  it("rejects an explanation that invents a number", async () => {
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: REVENUE_QUESTION,
        llm: new MockLLMProvider({
          explain: async () => "Sensor generated 99999 in revenue.",
        }),
      }),
    );

    expect(failure.error).toMatchObject({
      stage: "verify-claims",
      details: { code: "ungrounded_claim", claims: ["99999"] },
    });
  });

  it("does not explain a result that fails validation", async () => {
    const explain = vi.fn(async () => "Sensor generated 500.");
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: REVENUE_QUESTION,
        llm: {
          id: "mock",
          createPlan: (input) => new MockLLMProvider().createPlan(input),
          repairPlan: (input) => new MockLLMProvider().repairPlan(input),
          explain,
        },
        executeAnalysis: async () => ({
          columns: [
            { name: "product", type: "string" },
            { name: "sum_revenue", type: "number" },
          ],
          rows: [{ product: "Sensor", sum_revenue: 500, leaked: true }],
          rowCount: 1,
          truncated: false,
        }),
      }),
    );

    expect(failure.error.stage).toBe("validate-result");
    expect(explain).not.toHaveBeenCalled();
  });
});
