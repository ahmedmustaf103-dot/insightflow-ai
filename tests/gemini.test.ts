import { describe, expect, it, vi } from "vitest";
import { GeminiLLMProvider, createGeminiProvider } from "@/lib/ai/gemini";
import {
  MockLLMProvider,
  REVENUE_QUESTION,
  STRING_SUM_QUESTION,
  UNKNOWN_COLUMN_QUESTION,
} from "@/lib/ai/mock";
import type { LLMProvider } from "@/lib/ai/provider";
import { executeAnalysis } from "@/lib/analysis/execute";
import { orchestrateAnalysis } from "@/lib/analysis/orchestrate";
import type { AnalysisResult, DatasetProfile } from "@/lib/analysis/types";
import { failureOf, salesCsv } from "./helpers";

const request = {
  csvPath: salesCsv,
  datasetId: "sales-demo",
  fileName: "sales.csv",
};

const profile = {} as DatasetProfile;

function answerFromPrompt(prompt: string): string {
  const marker = "Validated result:\n";
  const result = JSON.parse(prompt.slice(prompt.indexOf(marker) + marker.length)) as AnalysisResult;
  if (result.rowCount === 0) {
    return "No matching records were found.";
  }
  return result.rows
    .map((row) => result.columns.map((column) => `${column.name} ${String(row[column.name])}`).join(", "))
    .join(". ");
}

describe("Gemini provider", () => {
  it("keeps the mock provider as a working stand-in", async () => {
    const plan = await new MockLLMProvider().createPlan({
      question: REVENUE_QUESTION,
      profile,
    });

    expect(plan).toMatchObject({
      operation: "aggregate",
      groupBy: ["product"],
      metrics: [{ column: "revenue", agg: "sum" }],
    });
  });

  it("parses a structured plan from the model response", async () => {
    const expected = await new MockLLMProvider().createPlan({
      question: REVENUE_QUESTION,
      profile,
    });
    let system = "";
    const provider = createGeminiProvider({
      apiKey: "test-key",
      generatePlan: async (input) => {
        system = input.system;
        return { ...expected, timeColumn: null, grain: null };
      },
      generateExplanation: async () => "unused",
    });

    await expect(provider.createPlan({ question: REVENUE_QUESTION, profile })).resolves.toEqual(expected);
    expect(provider).toBeInstanceOf(GeminiLLMProvider);
    expect(provider.id).toBe("gemini");
    expect(system).toContain("You are planning an analysis, not answering the question.");
  });

  it("fails clearly when a live request has no API key", async () => {
    const provider = createGeminiProvider({ apiKey: "" });
    const failure = await failureOf(provider.createPlan({ question: REVENUE_QUESTION, profile }));

    expect(failure.error).toMatchObject({
      stage: "plan",
      message: "GEMINI_API_KEY is required for a live Gemini request.",
      details: { code: "missing_api_key" },
    });
  });

  it("rejects malformed structured output", async () => {
    const provider = createGeminiProvider({
      apiKey: "test-key",
      generatePlan: async () => ({ operation: "aggregate", total: 999 }),
    });
    const failure = await failureOf(provider.createPlan({ question: REVENUE_QUESTION, profile }));

    expect(failure.error).toMatchObject({
      stage: "plan",
      details: { code: "malformed_output" },
    });
  });
});

describe("Gemini planning and repair", () => {
  it("sends a valid plan to validation and then to Pandas", async () => {
    const revenuePlan = await new MockLLMProvider().createPlan({
      question: REVENUE_QUESTION,
      profile,
    });
    const prompts: string[] = [];
    const provider = createGeminiProvider({
      apiKey: "test-key",
      generatePlan: async (input) => {
        prompts.push(input.prompt);
        return revenuePlan;
      },
      generateExplanation: async (input) => {
        prompts.push(input.prompt);
        return answerFromPrompt(input.prompt);
      },
    });

    const response = await orchestrateAnalysis({
      ...request,
      question: REVENUE_QUESTION,
      llm: provider,
    });

    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("product");
    expect(prompts[0]).not.toContain("product,revenue,order_date");
    expect(prompts[1]).toContain("sum_revenue");
    expect(prompts[1]).not.toContain("distinctCount");
    expect(response.evidence.result.rows[0]).toEqual({ product: "Sensor", sum_revenue: 500 });
    expect(response.chart).toEqual({ type: "bar", x: "product", y: "sum_revenue" });
  });

  it("rejects an unknown column after one repair", async () => {
    const unknownPlan = await new MockLLMProvider().createPlan({
      question: UNKNOWN_COLUMN_QUESTION,
      profile,
    });
    const execute = vi.fn(executeAnalysis);
    let planCalls = 0;
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: UNKNOWN_COLUMN_QUESTION,
        llm: createGeminiProvider({
          apiKey: "test-key",
          generatePlan: async () => {
            planCalls += 1;
            return unknownPlan;
          },
          generateExplanation: async () => "unused",
        }),
        executeAnalysis: execute,
      }),
    );

    expect(planCalls).toBe(2);
    expect(failure.error).toMatchObject({
      stage: "validate-plan",
      details: { code: "unknown_column", repairAttempted: true },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("rejects an invalid aggregation after one repair", async () => {
    const stringPlan = await new MockLLMProvider().createPlan({
      question: STRING_SUM_QUESTION,
      profile,
    });
    const execute = vi.fn(executeAnalysis);
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: STRING_SUM_QUESTION,
        llm: createGeminiProvider({
          apiKey: "test-key",
          generatePlan: async () => stringPlan,
          generateExplanation: async () => "unused",
        }),
        executeAnalysis: execute,
      }),
    );

    expect(failure.error).toMatchObject({
      stage: "validate-plan",
      details: { code: "invalid_metric", column: "product", repairAttempted: true },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("repairs the first invalid plan once and then calculates", async () => {
    const unknownPlan = await new MockLLMProvider().createPlan({
      question: UNKNOWN_COLUMN_QUESTION,
      profile,
    });
    const revenuePlan = await new MockLLMProvider().createPlan({
      question: REVENUE_QUESTION,
      profile,
    });
    let planCalls = 0;
    let explanations = 0;
    const response = await orchestrateAnalysis({
      ...request,
      question: REVENUE_QUESTION,
      llm: createGeminiProvider({
        apiKey: "test-key",
        generatePlan: async (input) => {
          planCalls += 1;
          if (planCalls === 1) {
            return unknownPlan;
          }
          expect(input.system).toContain("previous plan was rejected");
          expect(input.prompt).toContain("profit");
          return revenuePlan;
        },
        generateExplanation: async (input) => {
          explanations += 1;
          return answerFromPrompt(input.prompt);
        },
      }),
    });

    expect(planCalls).toBe(2);
    expect(explanations).toBe(1);
    expect(response.evidence.result.rows.map((row) => row.sum_revenue)).toEqual([500, 340, 325, 180, 60]);
  });

  it("stops after a second invalid plan and does not execute Python", async () => {
    const execute = vi.fn(executeAnalysis);
    let planCalls = 0;
    let explanations = 0;
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: "ignored",
        llm: createGeminiProvider({
          apiKey: "test-key",
          generatePlan: async () => {
            planCalls += 1;
            return { operation: "aggregate", total: planCalls };
          },
          generateExplanation: async () => {
            explanations += 1;
            return "unused";
          },
        }),
        executeAnalysis: execute,
      }),
    );

    expect(planCalls).toBe(2);
    expect(explanations).toBe(0);
    expect(execute).not.toHaveBeenCalled();
    expect(failure.error).toMatchObject({
      stage: "plan",
      details: { code: "invalid_plan", repairAttempted: true },
    });
  });

  it("does not repair a Gemini request failure", async () => {
    const execute = vi.fn(executeAnalysis);
    let planCalls = 0;
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: REVENUE_QUESTION,
        llm: createGeminiProvider({
          apiKey: "test-key",
          generatePlan: async () => {
            planCalls += 1;
            throw new Error("socket hang up");
          },
        }),
        executeAnalysis: execute,
      }),
    );

    expect(planCalls).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(failure.error).toMatchObject({
      stage: "plan",
      details: { code: "gemini_request_failed" },
    });
  });

  it("does not execute when the API key is missing", async () => {
    const execute = vi.fn(executeAnalysis);
    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: REVENUE_QUESTION,
        llm: createGeminiProvider({ apiKey: "" }),
        executeAnalysis: execute,
      }),
    );

    expect(failure.error.details).toMatchObject({ code: "missing_api_key" });
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("Gemini explanation", () => {
  it("explains only after a validated result and rejects a fabricated number", async () => {
    const revenuePlan = await new MockLLMProvider().createPlan({
      question: REVENUE_QUESTION,
      profile,
    });
    const seen: string[] = [];
    const provider: LLMProvider = createGeminiProvider({
      apiKey: "test-key",
      generatePlan: async () => revenuePlan,
      generateExplanation: async (input) => {
        seen.push(input.prompt);
        return "Sensor generated 99999 in revenue.";
      },
    });

    const failure = await failureOf(
      orchestrateAnalysis({
        ...request,
        question: REVENUE_QUESTION,
        llm: provider,
      }),
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('"sum_revenue": 500');
    expect(seen[0]).not.toContain("distinctCount");
    expect(failure.error).toMatchObject({
      stage: "verify-claims",
      details: { code: "ungrounded_claim", claims: ["99999"] },
    });
  });

  it("accepts numeric claims copied from the validated result", async () => {
    const revenuePlan = await new MockLLMProvider().createPlan({
      question: REVENUE_QUESTION,
      profile,
    });
    const response = await orchestrateAnalysis({
      ...request,
      question: REVENUE_QUESTION,
      llm: createGeminiProvider({
        apiKey: "test-key",
        generatePlan: async () => revenuePlan,
        generateExplanation: async (input) => answerFromPrompt(input.prompt),
      }),
    });

    expect(response.answer).toContain("500");
    expect(response.answer).toContain("Sensor");
    expect(response.evidence.result.rows[0]).toEqual({ product: "Sensor", sum_revenue: 500 });
  });
});
