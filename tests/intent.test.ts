import { describe, expect, it, vi } from "vitest";
import { executeAnalysis } from "@/lib/analysis/execute";
import { AnalysisFailure } from "@/lib/analysis/errors";
import { preserveIntent } from "@/lib/analysis/intent";
import { orchestrateAnalysis } from "@/lib/analysis/orchestrate";
import type { DatasetProfile } from "@/lib/analysis/types";
import { PLAN_SYSTEM, REPAIR_SYSTEM } from "@/lib/ai/prompts";
import {
  MockLLMProvider,
  MONTHLY_TREND_QUESTION,
  REVENUE_QUESTION,
  UNKNOWN_COLUMN_QUESTION,
} from "@/lib/ai/mock";
import { failureOf, plan, salesCsv } from "./helpers";

const profile: DatasetProfile = {
  datasetId: "sales-demo",
  fileName: "sales.csv",
  rowCount: 22,
  warnings: [],
  columns: [
    { name: "product", type: "string", nullable: false, nullCount: 0, distinctCount: 5, sampleValues: ["Widget", "Gadget", "Gizmo"] },
    { name: "revenue", type: "number", nullable: false, nullCount: 0, distinctCount: 12, sampleValues: ["100", "150", "200"] },
    { name: "order_date", type: "date", nullable: false, nullCount: 0, distinctCount: 20, sampleValues: ["2024-01-15"] },
    { name: "quantity", type: "number", nullable: true, nullCount: 1, distinctCount: 6, sampleValues: ["2", "3", "4"] },
    { name: "region", type: "string", nullable: true, nullCount: 1, distinctCount: 4, sampleValues: ["North", "South", "East"] },
    { name: "cost", type: "number", nullable: false, nullCount: 0, distinctCount: 4, sampleValues: ["4", "6"] },
    { name: "entered_on", type: "unknown", nullable: false, nullCount: 0, distinctCount: 4, sampleValues: [] },
  ],
};

const revenueByProduct = plan({
  operation: "aggregate",
  groupBy: ["product"],
  metrics: [{ column: "revenue", agg: "sum" }],
  sortBy: "sum_revenue",
  sortDirection: "desc",
  rationale: "Sum revenue by product.",
});

const request = { csvPath: salesCsv, datasetId: "sales-demo", fileName: "sales.csv" };

describe("preserveIntent", () => {
  it("rejects a missing metric instead of accepting a substitute", () => {
    const failure = intentFailure("What is total profit by product?", revenueByProduct);
    expect(failure.error).toMatchObject({
      stage: "validate-plan",
      message: "The requested metric 'profit' is not available in this dataset.",
      details: { code: "unsupported_request", role: "metric", concept: "profit" },
    });
  });

  it("rejects profit by region and the highest profit", () => {
    expect(intentFailure("Show profit by region.", revenueByProduct).error.details).toMatchObject({
      concept: "profit",
    });
    expect(intentFailure("Which products had the highest profit?", revenueByProduct).error.details).toMatchObject({
      concept: "profit",
    });
  });

  it("rejects a missing dimension instead of grouping by another column", () => {
    const failure = intentFailure("Show revenue by customer.", revenueByProduct);
    expect(failure.error.details).toMatchObject({ code: "unsupported_request", role: "dimension", concept: "customer" });
  });

  it("rejects a missing filter field instead of using region", () => {
    const failure = intentFailure(
      "Show revenue for customers in London.",
      plan({
        operation: "aggregate",
        metrics: [{ column: "revenue", agg: "sum" }],
        filters: [{ column: "region", op: "eq", value: "North" }],
        rationale: "Sum revenue for a region.",
      }),
    );
    expect(failure.error.details).toMatchObject({ code: "unsupported_request", role: "filter", concept: "customers" });
  });

  it("rejects sales when the dataset has revenue", () => {
    expect(intentFailure("Show sales by customer.", revenueByProduct).error.details).toMatchObject({
      role: "metric",
      concept: "sales",
    });
  });

  it("rejects profit when revenue and cost both exist", () => {
    expect(intentFailure("What was profit?", revenueByProduct).error.details).toMatchObject({
      role: "metric",
      concept: "profit",
    });
    expect(intentFailure("What was our profit?", revenueByProduct).error.message).toContain("profit");
  });

  it("rejects a named date field that is not in the dataset", () => {
    expect(intentFailure("How did revenue change by ship date?", revenueByProduct).error.details).toMatchObject({
      concept: "ship date",
    });
  });

  it("rejects a plan that drops the requested year", () => {
    const failure = intentFailure(REVENUE_QUESTION, revenueByProduct);
    expect(failure.error.details).toMatchObject({ code: "intent_mismatch" });
    expect(failure.error.message).toContain("2025");
  });

  it("accepts the revenue and monthly questions when the plan matches them", () => {
    expect(() =>
      preserveIntent(
        REVENUE_QUESTION,
        plan({
          operation: "aggregate",
          groupBy: ["product"],
          metrics: [{ column: "revenue", agg: "sum" }],
          filters: [{ column: "order_date", op: "between", value: ["2025-01-01", "2025-12-31"] }],
          sortBy: "sum_revenue",
          sortDirection: "desc",
          rationale: "Sum revenue by product for 2025.",
        }),
        profile,
      ),
    ).not.toThrow();

    expect(() =>
      preserveIntent(
        MONTHLY_TREND_QUESTION,
        plan({
          operation: "trend",
          metrics: [{ column: "revenue", agg: "sum" }],
          timeColumn: "order_date",
          grain: "month",
          filters: [{ column: "order_date", op: "between", value: ["2025-01-01", "2025-12-31"] }],
          rationale: "Sum revenue by month for 2025.",
        }),
        profile,
      ),
    ).not.toThrow();
  });

  it("accepts a filter value that is not one of the profile samples", () => {
    expect(() =>
      preserveIntent(
        "Which orders were placed in the Central region?",
        plan({
          operation: "detail",
          select: ["product", "revenue", "region"],
          filters: [{ column: "region", op: "eq", value: "Central" }],
          sortBy: "revenue",
          sortDirection: "desc",
          rationale: "List orders whose region is Central.",
        }),
        profile,
      ),
    ).not.toThrow();
  });
});

describe("intent preservation during orchestration", () => {
  it("does not execute a substituted profit plan", async () => {
    const execute = vi.fn(executeAnalysis);
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: UNKNOWN_COLUMN_QUESTION,
        llm: new MockLLMProvider({ plans: { [UNKNOWN_COLUMN_QUESTION]: revenueByProduct } }),
        executeAnalysis: execute,
      }),
    );

    expect(failure.error).toMatchObject({
      stage: "validate-plan",
      details: { code: "unsupported_request", concept: "profit", repairAttempted: true },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not let the repair turn profit into revenue", async () => {
    const execute = vi.fn(executeAnalysis);
    const profitPlan = plan({
      operation: "aggregate",
      groupBy: ["product"],
      metrics: [{ column: "profit", agg: "sum" }],
      rationale: "Sum profit by product.",
    });
    let repairs = 0;
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: UNKNOWN_COLUMN_QUESTION,
        llm: {
          id: "repair-substitute",
          createPlan: async () => profitPlan,
          repairPlan: async () => {
            repairs += 1;
            return revenueByProduct;
          },
          explain: async () => "unused",
        },
        executeAnalysis: execute,
      }),
    );

    expect(repairs).toBe(1);
    expect(failure.error.details).toMatchObject({ code: "unsupported_request", concept: "profit" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("does not execute a missing dimension or a missing filter field", async () => {
    const execute = vi.fn(executeAnalysis);
    const customer = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: "Show revenue by customer.",
        llm: new MockLLMProvider({ plans: { "Show revenue by customer.": revenueByProduct } }),
        executeAnalysis: execute,
      }),
    );
    const london = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: "Show revenue for customers in London.",
        llm: new MockLLMProvider({
          plans: { "Show revenue for customers in London.": revenueByProduct },
        }),
        executeAnalysis: execute,
      }),
    );

    expect(customer.error.details).toMatchObject({ concept: "customer" });
    expect(london.error.details).toMatchObject({ role: "filter", concept: "customers" });
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes a valid revenue question and a valid monthly trend", async () => {
    const execute = vi.fn(executeAnalysis);
    const revenue = await orchestrateAnalysis({
      ...request,
      question: REVENUE_QUESTION,
      llm: new MockLLMProvider(),
      executeAnalysis: execute,
    });
    const trend = await orchestrateAnalysis({
      ...request,
      question: MONTHLY_TREND_QUESTION,
      llm: new MockLLMProvider(),
      executeAnalysis: execute,
    });

    expect(revenue.evidence.result.rows[0]).toEqual({ product: "Sensor", sum_revenue: 500 });
    expect(trend.chart).toEqual({ type: "line", x: "period", y: "sum_revenue" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("does not calculate profit from revenue and cost", async () => {
    const execute = vi.fn(executeAnalysis);
    const failure = await failureOf(
      orchestrateAnalysis({
        csvPath: `${process.cwd()}/tests/fixtures/metrics.csv`,
        datasetId: "metrics-demo",
        fileName: "metrics.csv",
        question: "What was profit?",
        llm: new MockLLMProvider({
          plans: {
            "What was profit?": plan({
              operation: "aggregate",
              metrics: [{ column: "revenue", agg: "sum" }],
              rationale: "Sum revenue.",
            }),
          },
        }),
        executeAnalysis: execute,
      }),
    );

    expect(failure.error.details).toMatchObject({ code: "unsupported_request", concept: "profit" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("planning prompt", () => {
  it("tells the model to refuse an unsupported question", () => {
    expect(PLAN_SYSTEM).toContain("Never substitute a requested metric");
    expect(PLAN_SYSTEM).toContain("Do not assume revenue means profit");
    expect(PLAN_SYSTEM).toContain("Do not assume revenue means sales");
    expect(REPAIR_SYSTEM).toContain("The previous plan was rejected");
    expect(REPAIR_SYSTEM).toContain("Do not turn an unsupported question into a different supported question");
  });
});

function intentFailure(question: string, analysisPlan: ReturnType<typeof plan>): AnalysisFailure {
  try {
    preserveIntent(question, analysisPlan, profile);
  } catch (error) {
    if (error instanceof AnalysisFailure) return error;
    throw error;
  }
  throw new Error("Expected intent preservation to reject the plan.");
}
