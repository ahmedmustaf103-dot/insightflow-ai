import type { AnalysisPlan, AnalysisResult, DatasetProfile } from "@/lib/analysis/types";

export type CreatePlanInput = {
  question: string;
  profile: DatasetProfile;
};

export type ExplainInput = {
  question: string;
  plan: AnalysisPlan;
  result: AnalysisResult;
};

/**
 * The model proposes a plan and explains a result.
 * It does not receive the CSV and it does not calculate.
 */
export interface LLMProvider {
  readonly id: string;
  createPlan(input: CreatePlanInput): Promise<AnalysisPlan>;
  explain(input: ExplainInput): Promise<string>;
}
