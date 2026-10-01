import type { LLMProvider } from "@/lib/ai/provider";
import { deriveChartSpec } from "@/lib/charts/spec";
import { AnalysisFailure } from "@/lib/analysis/errors";
import { executeAnalysis as executeAnalysisDefault } from "@/lib/analysis/execute";
import { resolveLimits, type AnalysisLimits } from "@/lib/analysis/limits";
import {
  analysisPlanSchema,
  type AnalysisPlan,
  type AnalysisResponse,
  type DatasetProfile,
} from "@/lib/analysis/types";
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

type PlanAttempt =
  | { ok: true; plan: AnalysisPlan }
  | { ok: false; failure: AnalysisFailure; invalidPlan: unknown; errors: unknown };

export async function orchestrateAnalysis(input: OrchestrateInput): Promise<AnalysisResponse> {
  const limits = resolveLimits(input.limits);
  const profile = await (input.profileDataset ?? profileDatasetDefault)({
    csvPath: input.csvPath,
    datasetId: input.datasetId,
    fileName: input.fileName,
    limits,
  });

  const plan = await resolvePlan(input.llm, input.question, profile, limits);

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

async function resolvePlan(
  llm: LLMProvider,
  question: string,
  profile: DatasetProfile,
  limits: AnalysisLimits,
): Promise<AnalysisPlan> {
  const first = assess(await callForPlan(() => llm.createPlan({ question, profile })), profile, limits);
  if (first.ok) {
    return first.plan;
  }

  const repaired = assess(
    await callForPlan(() =>
      llm.repairPlan({
        question,
        profile,
        invalidPlan: first.invalidPlan,
        errors: first.errors,
      }),
    ),
    profile,
    limits,
  );
  if (repaired.ok) {
    return repaired.plan;
  }

  throw markFailedRepair(repaired.failure);
}

async function callForPlan(call: () => Promise<unknown>): Promise<unknown> {
  try {
    return await call();
  } catch (error) {
    if (isRepairablePlanError(error)) {
      return error.error.details.raw;
    }
    if (error instanceof AnalysisFailure) {
      throw error;
    }
    throw new AnalysisFailure({
      stage: "plan",
      message: "The analysis plan could not be created.",
      details: { code: "plan_failed" },
    });
  }
}

function assess(raw: unknown, profile: DatasetProfile, limits: AnalysisLimits): PlanAttempt {
  const parsed = analysisPlanSchema.safeParse(raw);
  if (!parsed.success) {
    const failure = new AnalysisFailure({
      stage: "plan",
      message: "The analysis plan did not match the required shape.",
      details: { code: "invalid_plan", issues: parsed.error.issues },
    });
    return { ok: false, failure, invalidPlan: raw, errors: failure.error };
  }

  try {
    validateAnalysisPlan(parsed.data, profile, limits);
  } catch (error) {
    if (error instanceof AnalysisFailure) {
      return {
        ok: false,
        failure: error,
        invalidPlan: parsed.data,
        errors: error.error,
      };
    }
    throw error;
  }

  return { ok: true, plan: parsed.data };
}

function isRepairablePlanError(
  error: unknown,
): error is AnalysisFailure & { error: { details: { raw: unknown } } } {
  if (!(error instanceof AnalysisFailure) || error.error.stage !== "plan") {
    return false;
  }
  const details = error.error.details;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return false;
  }
  const code = "code" in details ? details.code : undefined;
  return (code === "malformed_output" || code === "invalid_plan") && "raw" in details;
}

function markFailedRepair(failure: AnalysisFailure): AnalysisFailure {
  const details = failure.error.details;
  const nextDetails =
    details && typeof details === "object" && !Array.isArray(details)
      ? { ...details, repairAttempted: true }
      : { repairAttempted: true };
  return new AnalysisFailure({
    stage: failure.error.stage,
    message: `The repaired plan was rejected. ${failure.error.message}`,
    details: nextDetails,
  });
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
