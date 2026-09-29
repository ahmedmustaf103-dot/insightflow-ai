import { AnalysisFailure } from "@/lib/analysis/errors";
import { resolveLimits, type AnalysisLimits } from "@/lib/analysis/limits";
import {
  analysisErrorSchema,
  analysisPlanSchema,
  analysisResultSchema,
  type AnalysisPlan,
  type AnalysisResult,
} from "@/lib/analysis/types";
import { runPythonScript } from "@/lib/python/run";

export async function executeAnalysis(input: {
  csvPath: string;
  plan: unknown;
  limits?: Partial<AnalysisLimits>;
}): Promise<AnalysisResult> {
  const limits = resolveLimits(input.limits);
  const plan = parsePlan(input.plan);

  if (plan.limit > limits.maxResultRows) {
    throw new AnalysisFailure({
      stage: "execute",
      message: `Result limit ${plan.limit} exceeds the configured maximum of ${limits.maxResultRows} rows.`,
      details: {
        code: "result_limit",
        limit: plan.limit,
        maxResultRows: limits.maxResultRows,
      },
    });
  }

  const response = await runPythonScript(
    "execute.py",
    {
      csvPath: input.csvPath,
      plan,
      maxRows: limits.maxRows,
      maxResultRows: limits.maxResultRows,
    },
    "execute",
  );

  return readResult(response, limits.maxResultRows);
}

function parsePlan(plan: unknown): AnalysisPlan {
  const parsed = analysisPlanSchema.safeParse(plan);
  if (!parsed.success) {
    throw new AnalysisFailure({
      stage: "validate-plan",
      message: "Analysis plan is invalid.",
      details: { issues: parsed.error.issues },
    });
  }

  return parsed.data;
}

function readResult(response: unknown, maxResultRows: number): AnalysisResult {
  if (!response || typeof response !== "object" || !("ok" in response)) {
    throw new AnalysisFailure({
      stage: "execute",
      message: "Python returned an unreadable result.",
      details: { code: "invalid_response" },
    });
  }

  if (response.ok === false && "error" in response) {
    const error = analysisErrorSchema.safeParse(response.error);
    if (!error.success) {
      throw new AnalysisFailure({
        stage: "execute",
        message: "Python returned an invalid error.",
        details: { code: "invalid_response" },
      });
    }
    throw new AnalysisFailure(error.data);
  }

  if (response.ok !== true || !("result" in response)) {
    throw new AnalysisFailure({
      stage: "execute",
      message: "Python returned an unreadable result.",
      details: { code: "invalid_response" },
    });
  }

  const parsed = analysisResultSchema.safeParse(response.result);
  if (!parsed.success) {
    throw new AnalysisFailure({
      stage: "validate-result",
      message: "Analysis result did not match the contract.",
      details: { issues: parsed.error.issues },
    });
  }

  const result = parsed.data;
  if (result.rowCount !== result.rows.length) {
    throw new AnalysisFailure({
      stage: "validate-result",
      message: "Analysis result row count does not match the returned rows.",
      details: { code: "row_count_mismatch" },
    });
  }

  if (result.rowCount > maxResultRows) {
    throw new AnalysisFailure({
      stage: "validate-result",
      message: `Analysis result exceeds the configured maximum of ${maxResultRows} rows.`,
      details: { code: "result_limit", maxResultRows },
    });
  }

  const columnNames = result.columns.map((column) => column.name);
  for (const row of result.rows) {
    const keys = Object.keys(row);
    if (keys.length !== columnNames.length || keys.some((key) => !columnNames.includes(key))) {
      throw new AnalysisFailure({
        stage: "validate-result",
        message: "Analysis result rows do not match the declared columns.",
        details: { code: "column_mismatch" },
      });
    }

    for (const value of Object.values(row)) {
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new AnalysisFailure({
          stage: "validate-result",
          message: "Analysis result contains a non-finite number.",
          details: { code: "non_finite" },
        });
      }
    }
  }

  return result;
}
