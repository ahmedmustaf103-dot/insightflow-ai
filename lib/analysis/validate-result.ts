import { AnalysisFailure } from "@/lib/analysis/errors";
import { isIsoDate, metricOutputName } from "@/lib/analysis/validate-plan";
import {
  analysisResultSchema,
  type AnalysisPlan,
  type AnalysisResult,
  type ColumnType,
  type DatasetProfile,
} from "@/lib/analysis/types";

export function expectedResultColumns(
  plan: AnalysisPlan,
  profile: DatasetProfile,
): Array<{ name: string; type: ColumnType }> {
  const types = new Map(profile.columns.map((column) => [column.name, column.type]));
  const metrics = plan.metrics.map((metric) => ({
    name: metricOutputName(metric),
    type: "number" as const,
  }));

  if (plan.operation === "detail") {
    return plan.select.map((name) => ({ name, type: types.get(name) ?? "unknown" }));
  }

  if (plan.operation === "trend") {
    return [{ name: "period", type: "string" }, ...metrics];
  }

  return [...plan.groupBy.map((name) => ({ name, type: types.get(name) ?? "unknown" })), ...metrics];
}

export function validateAnalysisResult(
  result: unknown,
  context: {
    plan: AnalysisPlan;
    profile: DatasetProfile;
    maxResultRows: number;
  },
): AnalysisResult {
  const parsed = analysisResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new AnalysisFailure({
      stage: "validate-result",
      message: "Analysis result did not match the contract.",
      details: { code: "invalid_result", issues: parsed.error.issues },
    });
  }

  const value = parsed.data;
  if (value.rowCount !== value.rows.length) {
    throw new AnalysisFailure({
      stage: "validate-result",
      message: "Analysis result row count does not match the returned rows.",
      details: { code: "row_count_mismatch", rowCount: value.rowCount, actual: value.rows.length },
    });
  }

  if (value.rowCount > context.maxResultRows) {
    throw new AnalysisFailure({
      stage: "validate-result",
      message: `Analysis result exceeds the configured maximum of ${context.maxResultRows} rows.`,
      details: { code: "result_limit", maxResultRows: context.maxResultRows },
    });
  }

  const expected = expectedResultColumns(context.plan, context.profile);
  const actual = value.columns.map((column) => `${column.name}:${column.type}`);
  const expectedKey = expected.map((column) => `${column.name}:${column.type}`);
  if (actual.length !== expectedKey.length || actual.some((column, index) => column !== expectedKey[index])) {
    throw new AnalysisFailure({
      stage: "validate-result",
      message: "Analysis result columns do not match the validated plan.",
      details: { code: "unexpected_columns", expected, actual: value.columns },
    });
  }

  value.rows.forEach((row, index) => {
    const keys = Object.keys(row);
    if (keys.length !== expected.length || keys.some((key) => !expected.some((column) => column.name === key))) {
      throw new AnalysisFailure({
        stage: "validate-result",
        message: "Analysis result rows do not match the declared columns.",
        details: { code: "malformed_row", row: index },
      });
    }

    for (const column of expected) {
      if (!valueMatchesType(column.type, row[column.name])) {
        throw new AnalysisFailure({
          stage: "validate-result",
          message: `Column '${column.name}' contains a value that is not a ${column.type}.`,
          details: { code: "invalid_value", column: column.name, row: index },
        });
      }
    }
  });

  return value;
}

function valueMatchesType(type: ColumnType, value: string | number | boolean | null | undefined): boolean {
  if (value === null) {
    return true;
  }

  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "date") {
    return typeof value === "string" && isIsoDate(value);
  }
  return typeof value === "string";
}
