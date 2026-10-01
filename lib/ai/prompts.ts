import { DEFAULT_LIMITS } from "@/lib/analysis/limits";
import type { AnalysisPlan, AnalysisResult, DatasetProfile } from "@/lib/analysis/types";

export const PLAN_SYSTEM = `You are planning an analysis, not answering the question.

Return only a structured AnalysisPlan. Do not calculate values. Do not put numerical answers, totals, averages, or currency amounts in the plan. The rationale describes the operation and must not state a computed result.

Never invent columns. Use only columns present in the supplied dataset profile.

Use only these operations, and choose the simplest one that fits the question:
- aggregate for grouped or overall metrics. Set metrics. Leave select empty. Do not set timeColumn or grain.
- trend for time-series questions. Set timeColumn, grain (year, quarter, or month), and metrics. Leave groupBy and select empty.
- detail for record-level questions. Set select. Leave metrics and groupBy empty. Do not set timeColumn or grain.

Respect column types from the profile. sum, mean, min, and max require a numeric column. count may omit the column to count rows. groupBy, select, and timeColumn require a known column type. timeColumn must be a date column.

Use filters when the question specifies a date, region, product, or other value. Date filters use YYYY-MM-DD. A calendar year on a date column is a between filter from YYYY-01-01 to YYYY-12-31.

Metric output names are count, or the form agg_column such as sum_revenue. sortBy must be a groupBy column, the trend period column, a selected column, or a metric output name.
limit is an integer from 1 to ${DEFAULT_LIMITS.maxResultRows}.
Omit optional fields instead of sending null.`;

export const REPAIR_SYSTEM = `${PLAN_SYSTEM}

The previous plan was rejected. Return a corrected AnalysisPlan that fixes every validation error. Do not repeat the rejected plan.`;

export const EXPLANATION_SYSTEM = `Answer the user's question using only the supplied AnalysisResult. Do not calculate new values. Do not introduce numerical values that are not present in the result. If the result is empty, explicitly state that no matching records were found.

Copy category labels and metric values from the result rows. Do not restate numbers from the question, including years, unless that exact value is a result cell. Keep the answer concise. Do not produce a chart specification.`;

export function planPrompt(question: string, profile: DatasetProfile): string {
  return [
    `Question:\n${question}`,
    `Dataset profile:\n${JSON.stringify(profile, null, 2)}`,
    "Return the AnalysisPlan only.",
  ].join("\n\n");
}

export function repairPrompt(input: {
  question: string;
  profile: DatasetProfile;
  invalidPlan: unknown;
  errors: unknown;
}): string {
  return [
    `Question:\n${input.question}`,
    `Dataset profile:\n${JSON.stringify(input.profile, null, 2)}`,
    `Rejected plan:\n${JSON.stringify(input.invalidPlan, null, 2)}`,
    `Validation errors:\n${JSON.stringify(input.errors, null, 2)}`,
    "Return a corrected AnalysisPlan only.",
  ].join("\n\n");
}

export function explanationPrompt(input: {
  question: string;
  plan: AnalysisPlan;
  result: AnalysisResult;
}): string {
  return [
    `Question:\n${input.question}`,
    `Validated plan:\n${JSON.stringify(input.plan, null, 2)}`,
    `Validated result:\n${JSON.stringify(input.result, null, 2)}`,
  ].join("\n\n");
}
