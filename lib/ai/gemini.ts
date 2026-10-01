import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { APICallError, generateObject, generateText, NoObjectGeneratedError } from "ai";
import { LoadAPIKeyError } from "@ai-sdk/provider";
import { AnalysisFailure } from "@/lib/analysis/errors";
import { analysisPlanSchema, type AnalysisPlan, type AnalysisStage } from "@/lib/analysis/types";
import { readGeminiEnv } from "@/lib/env";
import {
  EXPLANATION_SYSTEM,
  explanationPrompt,
  PLAN_SYSTEM,
  planPrompt,
  REPAIR_SYSTEM,
  repairPrompt,
} from "@/lib/ai/prompts";
import type { CreatePlanInput, ExplainInput, LLMProvider, RepairPlanInput } from "@/lib/ai/provider";

const REQUEST_TIMEOUT_MS = 30_000;

export type GeminiTextRequest = {
  system: string;
  prompt: string;
  model: string;
};

export type GeminiProviderOptions = {
  apiKey?: string;
  model?: string;
  generatePlan?: (input: GeminiTextRequest) => Promise<unknown>;
  generateExplanation?: (input: GeminiTextRequest) => Promise<string>;
};

const OPTIONAL_PLAN_KEYS = ["timeColumn", "grain", "sortBy", "sortDirection"] as const;

export class GeminiLLMProvider implements LLMProvider {
  readonly id = "gemini";
  private readonly apiKey: string | undefined;
  private readonly model: string;
  private readonly generatePlan?: GeminiProviderOptions["generatePlan"];
  private readonly generateExplanation?: GeminiProviderOptions["generateExplanation"];

  constructor(options: GeminiProviderOptions = {}) {
    const env = readGeminiEnv();
    this.apiKey = options.apiKey !== undefined ? options.apiKey : env.apiKey;
    this.model = options.model ?? env.model;
    this.generatePlan = options.generatePlan;
    this.generateExplanation = options.generateExplanation;
  }

  async createPlan(input: CreatePlanInput): Promise<AnalysisPlan> {
    const raw = await this.requestPlan(PLAN_SYSTEM, planPrompt(input.question, input.profile));
    return this.parsePlan(raw);
  }

  async repairPlan(input: RepairPlanInput): Promise<AnalysisPlan> {
    const raw = await this.requestPlan(REPAIR_SYSTEM, repairPrompt(input));
    return this.parsePlan(raw);
  }

  async explain(input: ExplainInput): Promise<string> {
    const request = {
      system: EXPLANATION_SYSTEM,
      prompt: explanationPrompt(input),
      model: this.model,
    };

    if (this.generateExplanation) {
      return this.generateExplanation(request);
    }

    try {
      const result = await generateText({
        model: this.languageModel("explain"),
        system: request.system,
        prompt: request.prompt,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return result.text;
    } catch (error) {
      throw this.mapRequestError(error, "explain");
    }
  }

  private async requestPlan(system: string, prompt: string): Promise<unknown> {
    const request = { system, prompt, model: this.model };

    if (this.generatePlan) {
      try {
        return await this.generatePlan(request);
      } catch (error) {
        throw this.mapRequestError(error, "plan");
      }
    }

    try {
      const result = await generateObject({
        model: this.languageModel("plan"),
        schema: analysisPlanSchema,
        system,
        prompt,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      return result.object;
    } catch (error) {
      throw this.mapRequestError(error, "plan");
    }
  }

  private languageModel(stage: Extract<AnalysisStage, "plan" | "explain">) {
    return createGoogleGenerativeAI({ apiKey: this.requireApiKey(stage) })(this.model);
  }

  private requireApiKey(stage: Extract<AnalysisStage, "plan" | "explain">): string {
    const apiKey = this.apiKey?.trim();
    if (!apiKey) {
      throw new AnalysisFailure({
        stage,
        message: "GEMINI_API_KEY is required for a live Gemini request.",
        details: { code: "missing_api_key" },
      });
    }
    return apiKey;
  }

  private parsePlan(raw: unknown): AnalysisPlan {
    const parsed = analysisPlanSchema.safeParse(normalizePlan(raw));
    if (!parsed.success) {
      throw new AnalysisFailure({
        stage: "plan",
        message: "Gemini returned a plan that did not match the schema.",
        details: { code: "malformed_output", raw, issues: parsed.error.issues },
      });
    }
    return parsed.data;
  }

  private mapRequestError(
    error: unknown,
    stage: Extract<AnalysisStage, "plan" | "explain">,
  ): AnalysisFailure {
    if (error instanceof AnalysisFailure) {
      return error;
    }

    if (NoObjectGeneratedError.isInstance(error)) {
      return new AnalysisFailure({
        stage: "plan",
        message: "Gemini returned a plan that did not match the schema.",
        details: { code: "malformed_output", raw: error.text, cause: error.message },
      });
    }

    if (LoadAPIKeyError.isInstance(error)) {
      return new AnalysisFailure({
        stage,
        message: "GEMINI_API_KEY is required for a live Gemini request.",
        details: { code: "missing_api_key" },
      });
    }

    if (APICallError.isInstance(error)) {
      return new AnalysisFailure({
        stage,
        message: `The Gemini request failed${error.statusCode ? ` (${error.statusCode})` : ""}.`,
        details: { code: "gemini_request_failed", statusCode: error.statusCode },
      });
    }

    return new AnalysisFailure({
      stage,
      message: error instanceof Error ? error.message : "The Gemini request failed.",
      details: { code: "gemini_request_failed" },
    });
  }
}

export function createGeminiProvider(options?: GeminiProviderOptions): GeminiLLMProvider {
  return new GeminiLLMProvider(options);
}

function normalizePlan(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  const plan: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  for (const key of OPTIONAL_PLAN_KEYS) {
    if (plan[key] === null) {
      delete plan[key];
    }
  }

  if (Array.isArray(plan.metrics)) {
    plan.metrics = plan.metrics.map((metric) => {
      if (!metric || typeof metric !== "object" || Array.isArray(metric)) {
        return metric;
      }
      const copy: Record<string, unknown> = { ...(metric as Record<string, unknown>) };
      if (copy.column === null) {
        delete copy.column;
      }
      return copy;
    });
  }

  return plan;
}
