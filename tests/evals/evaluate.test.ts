import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { executeAnalysis } from "@/lib/analysis/execute";
import { AnalysisFailure } from "@/lib/analysis/errors";
import { orchestrateAnalysis } from "@/lib/analysis/orchestrate";
import type { AnalysisResponse, DatasetProfile } from "@/lib/analysis/types";
import { MockLLMProvider } from "@/lib/ai/mock";
import { profileDataset } from "@/lib/datasets/profile";
import { salesCsv } from "../helpers";
import { evaluationCases, type EvalCase } from "./cases";

const metricsCsv = path.join(process.cwd(), "tests/fixtures/metrics.csv");

let salesProfile: DatasetProfile;
let metricsProfile: DatasetProfile;

beforeAll(async () => {
  salesProfile = await profileDataset({
    csvPath: salesCsv,
    datasetId: "sales-eval",
    fileName: "sales.csv",
  });
  metricsProfile = await profileDataset({
    csvPath: metricsCsv,
    datasetId: "metrics-eval",
    fileName: "metrics.csv",
  });
});

describe("evaluation", () => {
  it("runs the InsightFlow evaluation suite", async () => {
    const results: CaseResult[] = [];
    for (const evalCase of evaluationCases) {
      results.push(await runCase(evalCase));
    }

    const report = formatReport(results);
    console.log(`\n${report}\n`);
    expect(results.filter((result) => !result.passed).map((result) => result.detail), report).toEqual([]);
  }, 90_000);
});

type CaseResult = {
  passed: boolean;
  detail: string;
  plan: boolean;
  intent: boolean;
  result: boolean;
  claims: boolean;
  chart: boolean;
};

async function runCase(evalCase: EvalCase): Promise<CaseResult> {
  let executed = false;
  const dataset = evalCase.dataset === "sales" ? salesProfile : metricsProfile;
  try {
    const response = await orchestrateAnalysis({
      question: evalCase.question,
      csvPath: evalCase.dataset === "sales" ? salesCsv : metricsCsv,
      datasetId: dataset.datasetId,
      fileName: dataset.fileName,
      llm: new MockLLMProvider({
        plans: { [evalCase.question]: evalCase.plan },
        explain: evalCase.explain ? async () => evalCase.explain ?? "" : undefined,
      }),
      profileDataset: async () => dataset,
      executeAnalysis: async (input) => {
        executed = true;
        if (!evalCase.executes) {
          throw new Error(`Python executed for ${evalCase.id}`);
        }
        return executeAnalysis(input);
      },
    });
    return scoreAccepted(evalCase, response, executed);
  } catch (error) {
    return scoreRejected(evalCase, error, executed);
  }
}

function scoreAccepted(evalCase: EvalCase, response: AnalysisResponse, executed: boolean): CaseResult {
  const scores = blank(evalCase.id);
  if (evalCase.outcome !== "accepted") {
    return fail(scores, `${evalCase.id} was accepted`);
  }
  scores.plan = response.evidence.plan.operation === evalCase.operation;
  scores.intent = evalCase.columns.every((column) => planUses(response.evidence.plan, column));
  scores.result = typeof response.evidence.result.rowCount === "number";
  scores.claims = response.answer.length > 0;
  scores.chart = displayedChart(response) === evalCase.chart;
  if (!executed) scores.plan = false;
  return finish(scores);
}

function scoreRejected(evalCase: EvalCase, error: unknown, executed: boolean): CaseResult {
  const scores = blank(evalCase.id);
  if (!(error instanceof AnalysisFailure)) {
    return fail(scores, `${evalCase.id} threw ${error instanceof Error ? error.message : "a non-analysis error"}`);
  }
  if (evalCase.outcome !== "rejected") {
    return fail(scores, `${evalCase.id} rejected at ${error.error.stage}: ${error.error.message}`);
  }

  const code = detailCode(error);
  scores.plan = evalCase.executes ? executed : !executed;
  scores.intent = !executed || evalCase.executes;
  scores.result = error.error.stage !== "validate-result";
  scores.claims = evalCase.errorCode === "ungrounded_claim" ? code === "ungrounded_claim" : error.error.stage !== "verify-claims";
  scores.chart = true;
  if (evalCase.errorCode && code !== evalCase.errorCode) {
    scores.intent = false;
    scores.detail = `${evalCase.id} rejected with ${code ?? "no code"}: ${error.error.message}`;
  }
  if (evalCase.executes !== executed) {
    scores.plan = false;
    scores.detail = `${evalCase.id} python executed=${executed}`;
  }
  return finish(scores);
}

function blank(id: string): CaseResult {
  return { passed: false, detail: id, plan: false, intent: false, result: false, claims: false, chart: false };
}

function fail(scores: CaseResult, detail: string): CaseResult {
  scores.detail = detail;
  scores.passed = false;
  return scores;
}

function finish(scores: CaseResult): CaseResult {
  scores.passed = scores.plan && scores.intent && scores.result && scores.claims && scores.chart;
  return scores;
}

function displayedChart(response: AnalysisResponse): EvalCase["chart"] {
  if (response.evidence.result.rowCount === 0) return "none";
  return response.chart.type;
}

function planUses(plan: AnalysisResponse["evidence"]["plan"], column: string): boolean {
  return (
    plan.groupBy.includes(column) ||
    plan.select.includes(column) ||
    plan.timeColumn === column ||
    plan.metrics.some((metric) => metric.column === column) ||
    plan.filters.some((filter) => filter.column === column)
  );
}

function detailCode(error: AnalysisFailure): string | undefined {
  const details = error.error.details;
  if (!details || typeof details !== "object" || Array.isArray(details) || !("code" in details)) return undefined;
  return typeof details.code === "string" ? details.code : undefined;
}

function formatReport(results: CaseResult[]): string {
  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const line = (label: string, key: keyof Pick<CaseResult, "plan" | "intent" | "result" | "claims" | "chart">) => {
    const count = results.filter((result) => result[key]).length;
    return `${label.padEnd(21)}${count}/${total}`;
  };

  return [
    "InsightFlow Evaluation",
    "",
    `Cases: ${total}`,
    `Passed: ${passed}`,
    `Failed: ${total - passed}`,
    "",
    line("Plan accuracy:", "plan"),
    line("Intent preservation:", "intent"),
    line("Result validation:", "result"),
    line("Claim verification:", "claims"),
    line("Chart selection:", "chart"),
    "",
    ...results.filter((result) => !result.passed).map((result) => result.detail),
  ].join("\n");
}
