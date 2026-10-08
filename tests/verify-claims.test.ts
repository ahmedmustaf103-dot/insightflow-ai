import { describe, expect, it } from "vitest";
import { verifyClaims } from "@/lib/analysis/verify-claims";
import type { AnalysisResult, DatasetProfile } from "@/lib/analysis/types";
import { failureOf } from "./helpers";

const profile: DatasetProfile = {
  datasetId: "sales-demo",
  fileName: "sales.csv",
  rowCount: 22,
  warnings: [],
  columns: [],
};

const result: AnalysisResult = {
  columns: [
    { name: "product", type: "string" },
    { name: "sum_revenue", type: "number" },
    { name: "share", type: "number" },
  ],
  rows: [
    { product: "Sensor", sum_revenue: 500, share: 0.5 },
    { product: "Gadget", sum_revenue: 1250.5, share: 0.25 },
  ],
  rowCount: 2,
  truncated: false,
};

describe("verify-claims", () => {
  it("accepts numbers that appear in the result", () => {
    expect(() => verifyClaims({ answer: "Sensor revenue was 500 and Gadget revenue was 1250.5.", result, profile })).not.toThrow();
  });

  it("accepts currency, thousands separators, and decimal formatting", () => {
    expect(() => verifyClaims({ answer: "Sensor generated £500.", result, profile })).not.toThrow();
    expect(() => verifyClaims({ answer: "Sensor generated £500.00 and Gadget generated £1,250.50.", result, profile })).not.toThrow();
    expect(() => verifyClaims({ answer: "Sensor revenue was 500.00.", result, profile })).not.toThrow();
  });

  it("accepts a value rounded to the decimals written in the answer", () => {
    const rounded: AnalysisResult = {
      columns: [{ name: "mean_revenue", type: "number" }],
      rows: [{ mean_revenue: 128.1818 }],
      rowCount: 1,
      truncated: false,
    };

    expect(() => verifyClaims({ answer: "Mean revenue was 128.18.", result: rounded, profile })).not.toThrow();
  });

  it("accepts percentages that match a ratio or the written percent", () => {
    expect(() => verifyClaims({ answer: "Sensor share was 50% and Gadget share was 25%.", result, profile })).not.toThrow();
  });

  it("accepts several claims and the dataset row count", () => {
    expect(() =>
      verifyClaims({
        answer: "Across 22 source rows, Sensor generated 500 and Gadget generated 1250.5.",
        result,
        profile,
      }),
    ).not.toThrow();
  });

  it("rejects a fabricated number", async () => {
    const failure = await failureOf(
      Promise.reject(capture(() => verifyClaims({ answer: "Sensor generated 99999.", result, profile }))),
    );

    expect(failure.error).toMatchObject({
      stage: "verify-claims",
      details: { code: "ungrounded_claim", claims: ["99999"] },
    });
  });

  it("rejects a percentage that does not match the result", async () => {
    const failure = await failureOf(
      Promise.reject(capture(() => verifyClaims({ answer: "Sensor share was 80%.", result, profile }))),
    );

    expect(failure.error.details).toMatchObject({ code: "ungrounded_claim", claims: ["80%"] });
  });

  it("accepts an empty result with no invented figures", () => {
    const empty: AnalysisResult = {
      columns: [
        { name: "product", type: "string" },
        { name: "sum_revenue", type: "number" },
      ],
      rows: [],
      rowCount: 0,
      truncated: false,
    };

    expect(() => verifyClaims({ answer: "No matching records were found.", result: empty, profile })).not.toThrow();
  });

  it("rejects a figure attached to an empty result", async () => {
    const empty: AnalysisResult = {
      columns: [{ name: "sum_revenue", type: "number" }],
      rows: [],
      rowCount: 0,
      truncated: false,
    };
    const failure = await failureOf(
      Promise.reject(capture(() => verifyClaims({ answer: "Revenue was 500.", result: empty, profile }))),
    );

    expect(failure.error.details).toMatchObject({ code: "ungrounded_claim", claims: ["500"] });
  });

  it("rejects when one of several claims is ungrounded", async () => {
    const failure = await failureOf(
      Promise.reject(
        capture(() => verifyClaims({ answer: "Sensor generated 500 and the adjusted total is 99999.", result, profile })),
      ),
    );

    expect(failure.error.details).toMatchObject({ code: "ungrounded_claim", claims: ["99999"] });
  });

  it("does not treat digits inside a result label as separate claims", () => {
    const monthly: AnalysisResult = {
      columns: [
        { name: "period", type: "string" },
        { name: "sum_revenue", type: "number" },
      ],
      rows: [{ period: "2025-01", sum_revenue: 200 }],
      rowCount: 1,
      truncated: false,
    };

    expect(() => verifyClaims({ answer: "period 2025-01, sum_revenue 200", result: monthly, profile })).not.toThrow();
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
  return new Error("Expected claim verification to fail.");
}
