import path from "node:path";
import { AnalysisFailure } from "@/lib/analysis/errors";
import type { AnalysisPlan } from "@/lib/analysis/types";

export const salesCsv = path.join(process.cwd(), "tests/fixtures/sales.csv");

export function plan(overrides: Partial<AnalysisPlan> & Pick<AnalysisPlan, "operation">): AnalysisPlan {
  return {
    filters: [],
    groupBy: [],
    metrics: [],
    select: [],
    limit: 20,
    rationale: "fixture",
    ...overrides,
  };
}

export async function failureOf(run: Promise<unknown>): Promise<AnalysisFailure> {
  try {
    await run;
  } catch (error) {
    if (error instanceof AnalysisFailure) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected analysis to fail.");
}
