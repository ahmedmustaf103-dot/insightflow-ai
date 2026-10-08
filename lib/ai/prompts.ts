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

Never substitute a requested metric with another metric.
Never substitute a requested column with a semantically similar column.
Never reinterpret the user's analytical intent to make the question answerable.
If the requested information cannot be represented using the dataset profile, name the unavailable column in the plan so validation can reject it. Do not invent a substitute.
Only use columns explicitly present in the dataset profile.
Do not assume revenue means sales.
Do not assume revenue means profit.
Do not infer a missing business concept from an unrelated column.
Do not calculate derived metrics. Profit is not revenue minus cost unless the dataset already contains the requested metric.

Metric output names are count, or the form agg_column such as sum_revenue. sortBy must be a groupBy column, the trend period column, a selected column, or a metric output name.
limit is an integer from 1 to ${DEFAULT_LIMITS.maxResultRows}.
Omit optional fields instead of sending null.`;

export const REPAIR_SYSTEM = `${PLAN_SYSTEM}

The previous plan was rejected. Return a corrected AnalysisPlan that fixes every validation error. Do not repeat the rejected plan.
Never substitute a requested metric, column, filter, or analytical intent with a different one to make the question answerable.
If the requested information is not in the dataset profile, keep the unavailable name in the corrected plan so validation can reject it.
This is the only repair. Do not turn an unsupported question into a different supported question.`;

export const EXPLANATION_SYSTEM = `Answer the user's question using only the supplied AnalysisResult. Do not calculate new values. Do not introduce numerical values that are not present in the result. If the result is empty, explicitly state that no matching records were found.

Copy category labels and metric values from the result rows. A number is allowed only when it appears as a numeric result cell or as the result row count.
Do not restate years, dates, or amounts from the question or the analysis plan. Plan dates such as 2025-01-01 are not result values. If you need to mention the filtered period, call it "the filtered period" and do not write the year.
Keep the answer concise. Do not produce a chart specification.`;

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
