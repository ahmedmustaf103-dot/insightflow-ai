import { describe, expect, it } from "vitest";
import { validateAnalysisPlan } from "@/lib/analysis/validate-plan";
import type { AnalysisPlan, DatasetProfile } from "@/lib/analysis/types";
import { failureOf, plan } from "./helpers";

const limits = { maxResultRows: 100 };

const profile: DatasetProfile = {
  datasetId: "sales-demo",
  fileName: "sales.csv",
  rowCount: 22,
  warnings: [],
  columns: [
    { name: "product", type: "string", nullable: false, nullCount: 0, distinctCount: 5, sampleValues: ["Widget"] },
    { name: "revenue", type: "number", nullable: false, nullCount: 0, distinctCount: 10, sampleValues: ["100"], min: 10, max: 500 },
    { name: "order_date", type: "date", nullable: false, nullCount: 0, distinctCount: 10, sampleValues: ["2025-01-20"], min: "2024-01-02", max: "2025-12-01" },
    { name: "region", type: "string", nullable: true, nullCount: 1, distinctCount: 4, sampleValues: ["North"] },
    { name: "active", type: "boolean", nullable: false, nullCount: 0, distinctCount: 2, sampleValues: ["true"] },
    { name: "entered_on", type: "unknown", nullable: false, nullCount: 0, distinctCount: 2, sampleValues: ["01/02/2024"] },
  ],
};

function check(analysisPlan: AnalysisPlan) {
  validateAnalysisPlan(analysisPlan, profile, limits);
}

describe("validate-plan", () => {
  it("accepts summing a numeric column by a category", () => {
    expect(() =>
      check(
        plan({
          operation: "aggregate",
          groupBy: ["product"],
          metrics: [{ column: "revenue", agg: "sum" }],
          sortBy: "sum_revenue",
          sortDirection: "desc",
        }),
      ),
    ).not.toThrow();
  });

  it("rejects summing a string column", async () => {
    const failure = await failureOf(
      Promise.reject(
        capture(() =>
          check(
            plan({
              operation: "aggregate",
              metrics: [{ column: "product", agg: "sum" }],
            }),
          ),
        ),
      ),
    );

    expect(failure.error).toMatchObject({
      stage: "validate-plan",
      details: { code: "invalid_metric", column: "product", agg: "sum" },
    });
  });

  it("rejects an unknown column", async () => {
    const failure = await failureOf(
      Promise.reject(
        capture(() =>
          check(
            plan({
              operation: "aggregate",
              metrics: [{ column: "profit", agg: "sum" }],
            }),
          ),
        ),
      ),
    );

    expect(failure.error.details).toMatchObject({ code: "unknown_column", column: "profit" });
  });

  it("rejects a trend that does not use a date column", async () => {
    const failure = await failureOf(
      Promise.reject(
        capture(() =>
          check(
            plan({
              operation: "trend",
              metrics: [{ column: "revenue", agg: "sum" }],
              timeColumn: "region",
              grain: "month",
            }),
          ),
        ),
      ),
    );

    expect(failure.error.details).toMatchObject({ code: "invalid_time_column", column: "region" });
  });

  it("rejects an invalid date filter and a limit above the cap", async () => {
    const date = await failureOf(
      Promise.reject(
        capture(() =>
          check(
            plan({
              operation: "aggregate",
              filters: [{ column: "order_date", op: "eq", value: "2025-02-31" }],
              metrics: [{ column: "revenue", agg: "sum" }],
            }),
          ),
        ),
      ),
    );
    const limit = await failureOf(
      Promise.reject(
        capture(() =>
          check(
            plan({
              operation: "detail",
              select: ["product"],
              limit: 101,
            }),
          ),
        ),
      ),
    );

    expect(date.error.details).toMatchObject({ code: "invalid_filter", column: "order_date" });
    expect(limit.error.details).toMatchObject({ code: "result_limit", limit: 101, maxResultRows: 100 });
  });

  it("rejects ordered comparisons on strings and filters on unknown columns", async () => {
    const comparison = await failureOf(
      Promise.reject(
        capture(() =>
          check(
            plan({
              operation: "detail",
              filters: [{ column: "product", op: "gt", value: "Widget" }],
              select: ["product"],
            }),
          ),
        ),
      ),
    );
    const unknown = await failureOf(
      Promise.reject(
        capture(() =>
          check(
            plan({
              operation: "aggregate",
              groupBy: ["entered_on"],
              metrics: [{ column: "revenue", agg: "sum" }],
            }),
          ),
        ),
      ),
    );

    expect(comparison.error.details).toMatchObject({ code: "invalid_filter", column: "product" });
    expect(unknown.error.details).toMatchObject({ code: "invalid_column", column: "entered_on" });
  });
});

function capture(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  return new Error("Expected validation to fail.");
}
