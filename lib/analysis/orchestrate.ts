import type { LLMProvider } from "@/lib/ai/provider";
import { deriveChartSpec } from "@/lib/charts/spec";
import { AnalysisFailure } from "@/lib/analysis/errors";
import { executeAnalysis as executeAnalysisDefault } from "@/lib/analysis/execute";
import { resolveLimits, type AnalysisLimits } from "@/lib/analysis/limits";
import { analysisPlanSchema, type AnalysisPlan, type AnalysisResponse } from "@/lib/analysis/types";
import { validateAnalysisPlan } from "@/lib/analysis/validate-plan";
import { validateAnalysisResult } from "@/lib/analysis/validate-result";
import { verifyClaims } from "@/lib/analysis/verify-claims";
import { profileDataset as profileDatasetDefault } from "@/lib/datasets/profile";

export type OrchestrateInput = {
  question: string;
  csvPath: string;
  datasetId: string;
  fileName: string;
  llm: LLMProvider;
  limits?: Partial<AnalysisLimits>;
  profileDataset?: typeof profileDatasetDefault;
  executeAnalysis?: typeof executeAnalysisDefault;
};

export async function orchestrateAnalysis(input: OrchestrateInput): Promise<AnalysisResponse> {
  const limits = resolveLimits(input.limits);
  const profile = await (input.profileDataset ?? profileDatasetDefault)({
    csvPath: input.csvPath,
    datasetId: input.datasetId,
    fileName: input.fileName,
    limits,
  });

  const plan = await createPlan(input.llm, input.question, profile);
  validateAnalysisPlan(plan, profile, limits);

  const executed = await (input.executeAnalysis ?? executeAnalysisDefault)({
    csvPath: input.csvPath,
    plan,
    limits,
  });
  const result = validateAnalysisResult(executed, {
    plan,
    profile,
    maxResultRows: limits.maxResultRows,
  });

  const answer = await createExplanation(input.llm, {
    question: input.question,
    plan,
    result,
  });
  verifyClaims({ answer, result, profile });

  return {
    answer,
    evidence: {
      datasetId: profile.datasetId,
      question: input.question,
      plan,
      result,
      engine: "pandas",
    },
    chart: deriveChartSpec(plan, result),
    warnings: profile.warnings,
  };
}

async function createPlan(
  llm: LLMProvider,
  question: string,
  profile: Awaited<ReturnType<typeof profileDatasetDefault>>,
): Promise<AnalysisPlan> {
  let raw: unknown;
  try {
    raw = await llm.createPlan({ question, profile });
  } catch (error) {
    if (error instanceof AnalysisFailure) {
      throw error;
    }
    throw new AnalysisFailure({
      stage: "plan",
      message: "The analysis plan could not be created.",
      details: { code: "plan_failed" },
    });
  }

  const parsed = analysisPlanSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AnalysisFailure({
      stage: "plan",
      message: "The analysis plan did not match the required shape.",
      details: { code: "invalid_plan", issues: parsed.error.issues },
    });
  }

  return parsed.data;
}

async function createExplanation(
  llm: LLMProvider,
  input: { question: string; plan: AnalysisPlan; result: AnalysisResponse["evidence"]["result"] },
): Promise<string> {
  let answer: string;
  try {
    answer = await llm.explain(input);
  } catch (error) {
    if (error instanceof AnalysisFailure) {
      throw error;
    }
    throw new AnalysisFailure({
      stage: "explain",
      message: "The explanation could not be created.",
      details: { code: "explain_failed" },
    });
  }

  if (!answer.trim()) {
    throw new AnalysisFailure({
      stage: "explain",
      message: "The explanation was empty.",
      details: { code: "empty_explanation" },
    });
  }

  return answer;
}
