import { describe, expect, it } from "vitest";
import { validateAnalysisResult } from "@/lib/analysis/validate-result";
import type { AnalysisResult, DatasetProfile } from "@/lib/analysis/types";
import { failureOf, plan } from "./helpers";

const profile: DatasetProfile = {
  datasetId: "sales-demo",
  fileName: "sales.csv",
  rowCount: 22,
  warnings: [],
  columns: [
    { name: "product", type: "string", nullable: false, nullCount: 0, distinctCount: 5, sampleValues: ["Widget"] },
    { name: "revenue", type: "number", nullable: false, nullCount: 0, distinctCount: 5, sampleValues: ["100"], min: 10, max: 500 },
  ],
};

const aggregatePlan = plan({
  operation: "aggregate",
  groupBy: ["product"],
  metrics: [{ column: "revenue", agg: "sum" }],
});

describe("validate-result", () => {
  it("accepts an empty result", () => {
    const result = validateAnalysisResult(
      {
        columns: [
          { name: "product", type: "string" },
          { name: "sum_revenue", type: "number" },
        ],
        rows: [],
        rowCount: 0,
        truncated: false,
      },
      { plan: aggregatePlan, profile, maxResultRows: 100 },
    );

    expect(result.rowCount).toBe(0);
  });

  it("rejects malformed rows, unexpected fields, and non-finite numbers", async () => {
    const extra = await failureOf(
      Promise.resolve().then(() =>
        validateAnalysisResult(rowResult({ product: "Sensor", sum_revenue: 500, leaked: 1 }), {
          plan: aggregatePlan,
          profile,
          maxResultRows: 100,
        }),
      ),
    );
    const infinite = await failureOf(
      Promise.resolve().then(() =>
        validateAnalysisResult(rowResult({ product: "Sensor", sum_revenue: Number.POSITIVE_INFINITY }), {
          plan: aggregatePlan,
          profile,
          maxResultRows: 100,
        }),
      ),
    );
    const mismatch = await failureOf(
      Promise.resolve().then(() =>
        validateAnalysisResult(
          {
            columns: [
              { name: "product", type: "string" },
              { name: "sum_revenue", type: "number" },
            ],
            rows: [{ product: "Sensor", sum_revenue: 500 }],
            rowCount: 2,
            truncated: false,
          },
          { plan: aggregatePlan, profile, maxResultRows: 100 },
        ),
      ),
    );

    expect(extra.error.details).toMatchObject({ code: "malformed_row" });
    expect(infinite.error.stage).toBe("validate-result");
    expect(mismatch.error.details).toMatchObject({ code: "row_count_mismatch" });
  });

  it("rejects a result larger than the configured maximum", async () => {
    const failure = await failureOf(
      Promise.resolve().then(() =>
        validateAnalysisResult(rowResult({ product: "Sensor", sum_revenue: 500 }), {
          plan: aggregatePlan,
          profile,
          maxResultRows: 0,
        }),
      ),
    );

    expect(failure.error.details).toMatchObject({ code: "result_limit" });
  });
});

function rowResult(row: Record<string, string | number | boolean | null>): AnalysisResult {
  return {
    columns: [
      { name: "product", type: "string" },
      { name: "sum_revenue", type: "number" },
    ],
    rows: [row],
    rowCount: 1,
    truncated: false,
  };
}
