import { AnalysisFailure } from "@/lib/analysis/errors";
import { orchestrateAnalysis } from "@/lib/analysis/orchestrate";
import type { AnalysisResponse } from "@/lib/analysis/types";
import type { LLMProvider } from "@/lib/ai/provider";
import { loadDataset, uploadRoot } from "@/lib/datasets/store";

const MAX_QUESTION_LENGTH = 500;

export async function askDataset(input: {
  datasetId: string;
  question: string;
  llm: LLMProvider;
  root?: string;
}): Promise<AnalysisResponse> {
  const question = input.question.trim();
  if (!question || question.length > MAX_QUESTION_LENGTH) {
    throw new AnalysisFailure({
      stage: "plan",
      message: "Enter a question about this dataset.",
      details: { code: "invalid_question" },
    });
  }

  const stored = await loadDataset(input.datasetId, input.root ?? uploadRoot());
  return orchestrateAnalysis({
    question,
    csvPath: stored.csvPath,
    datasetId: stored.profile.datasetId,
    fileName: stored.profile.fileName,
    llm: input.llm,
    profileDataset: async () => stored.profile,
  });
}
