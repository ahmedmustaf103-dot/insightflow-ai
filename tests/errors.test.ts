import { describe, expect, it } from "vitest";
import { executeAnalysis } from "@/lib/analysis/execute";
import { runPythonScript } from "@/lib/python/run";
import { failureOf, plan, salesCsv } from "./helpers";

const limits = { maxRows: 50_000, maxResultRows: 100 };

describe("analysis errors", () => {
  it("rejects an unknown column", async () => {
    const failure = await failureOf(
      executeAnalysis({
        csvPath: salesCsv,
        plan: plan({
          operation: "aggregate",
          groupBy: ["sku"],
          metrics: [{ column: "revenue", agg: "sum" }],
        }),
      }),
    );

    expect(failure.error.stage).toBe("execute");
    expect(failure.error.details).toMatchObject({ code: "unknown_column", column: "sku" });
  });

  it("rejects an invalid operation before execution", async () => {
    const failure = await failureOf(
      executeAnalysis({
        csvPath: salesCsv,
        plan: plan({
          operation: "forecast" as "aggregate",
          metrics: [{ column: "revenue", agg: "sum" }],
        }),
      }),
    );

    expect(failure.error.stage).toBe("validate-plan");
  });

  it("rejects an invalid operation from Python", async () => {
    const response = await runPythonScript(
      "execute.py",
      {
        csvPath: salesCsv,
        maxRows: limits.maxRows,
        maxResultRows: limits.maxResultRows,
        plan: {
          operation: "forecast",
          filters: [],
          limit: 10,
        },
      },
      "execute",
    );

    expect(response).toMatchObject({
      ok: false,
      error: {
        stage: "execute",
        details: { code: "invalid_operation" },
      },
    });
  });

  it("rejects an invalid metric", async () => {
    const failure = await failureOf(
      executeAnalysis({
        csvPath: salesCsv,
        plan: plan({
          operation: "aggregate",
          metrics: [{ column: "product", agg: "sum" }],
        }),
      }),
    );

    expect(failure.error).toMatchObject({
      stage: "execute",
      details: { code: "invalid_metric", column: "product" },
    });
  });

  it("rejects a metric aggregation outside the catalog", async () => {
    const response = await runPythonScript(
      "execute.py",
      {
        csvPath: salesCsv,
        maxRows: limits.maxRows,
        maxResultRows: limits.maxResultRows,
        plan: {
          operation: "aggregate",
          filters: [],
          groupBy: [],
          metrics: [{ column: "revenue", agg: "median" }],
          select: [],
          limit: 10,
          rationale: "unsupported",
        },
      },
      "execute",
    );

    expect(response).toMatchObject({
      ok: false,
      error: { details: { code: "invalid_metric", agg: "median" } },
    });
  });

  it("rejects an invalid filter", async () => {
    const comparison = await failureOf(
      executeAnalysis({
        csvPath: salesCsv,
        plan: plan({
          operation: "detail",
          filters: [{ column: "product", op: "gt", value: "Widget" }],
          select: ["product"],
        }),
      }),
    );
    const between = await failureOf(
      executeAnalysis({
        csvPath: salesCsv,
        plan: plan({
          operation: "aggregate",
          filters: [{ column: "revenue", op: "between", value: [10] }],
          metrics: [{ column: "revenue", agg: "sum" }],
        }),
      }),
    );

    expect(comparison.error.details).toMatchObject({ code: "invalid_filter", column: "product" });
    expect(between.error.details).toMatchObject({ code: "invalid_filter", column: "revenue" });
  });

  it("returns an empty result instead of inventing rows", async () => {
    const result = await executeAnalysis({
      csvPath: salesCsv,
      plan: plan({
        operation: "detail",
        filters: [{ column: "region", op: "eq", value: "Central" }],
        select: ["product", "revenue"],
      }),
    });

    expect(result).toEqual({
      columns: [
        { name: "product", type: "string" },
        { name: "revenue", type: "number" },
      ],
      rows: [],
      rowCount: 0,
      truncated: false,
    });
  });

  it("rejects a result limit above the configured maximum", async () => {
    const failure = await failureOf(
      executeAnalysis({
        csvPath: salesCsv,
        plan: plan({
          operation: "detail",
          select: ["product"],
          limit: 25,
        }),
        limits: { maxResultRows: 10 },
      }),
    );

    expect(failure.error).toMatchObject({
      stage: "execute",
      details: { code: "result_limit", limit: 25, maxResultRows: 10 },
    });

    const response = await runPythonScript(
      "execute.py",
      {
        csvPath: salesCsv,
        maxRows: 50_000,
        maxResultRows: 10,
        plan: {
          operation: "detail",
          filters: [],
          groupBy: [],
          metrics: [],
          select: ["product"],
          limit: 25,
          rationale: "over the cap",
        },
      },
      "execute",
    );

    expect(response).toMatchObject({
      ok: false,
      error: { details: { code: "result_limit", limit: 25, maxResultRows: 10 } },
    });
  });
});
