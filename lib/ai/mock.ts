import { AnalysisFailure } from "@/lib/analysis/errors";
import type { AnalysisPlan, AnalysisResult } from "@/lib/analysis/types";
import { analysisPlanSchema } from "@/lib/analysis/types";
import type { CreatePlanInput, ExplainInput, LLMProvider, RepairPlanInput } from "@/lib/ai/provider";

export const REVENUE_QUESTION = "Which products generated the most revenue in 2025?";
export const MONTHLY_TREND_QUESTION = "How did revenue change each month in 2025?";
export const UNKNOWN_COLUMN_QUESTION = "What is total profit by product?";
export const STRING_SUM_QUESTION = "Sum the product names.";
export const EMPTY_REGION_QUESTION = "Which orders were placed in the Central region?";

const REVENUE_PLAN: AnalysisPlan = {
  operation: "aggregate",
  filters: [{ column: "order_date", op: "between", value: ["2025-01-01", "2025-12-31"] }],
  groupBy: ["product"],
  metrics: [{ column: "revenue", agg: "sum" }],
  select: [],
  sortBy: "sum_revenue",
  sortDirection: "desc",
  limit: 10,
  rationale: "Sum revenue by product for orders placed in 2025.",
};

const MONTHLY_TREND_PLAN: AnalysisPlan = {
  operation: "trend",
  filters: [{ column: "order_date", op: "between", value: ["2025-01-01", "2025-12-31"] }],
  groupBy: [],
  metrics: [{ column: "revenue", agg: "sum" }],
  timeColumn: "order_date",
  grain: "month",
  select: [],
  limit: 24,
  rationale: "Sum revenue by month for 2025.",
};

const UNKNOWN_COLUMN_PLAN: AnalysisPlan = {
  operation: "aggregate",
  filters: [],
  groupBy: ["product"],
  metrics: [{ column: "profit", agg: "sum" }],
  select: [],
  limit: 10,
  rationale: "Sum profit by product.",
};

const STRING_SUM_PLAN: AnalysisPlan = {
  operation: "aggregate",
  filters: [],
  groupBy: [],
  metrics: [{ column: "product", agg: "sum" }],
  select: [],
  limit: 10,
  rationale: "Attempt to sum the product column.",
};

const EMPTY_REGION_PLAN: AnalysisPlan = {
  operation: "detail",
  filters: [{ column: "region", op: "eq", value: "Central" }],
  groupBy: [],
  metrics: [],
  select: ["product", "revenue", "region"],
  sortBy: "revenue",
  sortDirection: "desc",
  limit: 20,
  rationale: "List orders whose region is Central.",
};

const DEFAULT_PLANS: Record<string, AnalysisPlan> = {
  [REVENUE_QUESTION]: REVENUE_PLAN,
  [MONTHLY_TREND_QUESTION]: MONTHLY_TREND_PLAN,
  [UNKNOWN_COLUMN_QUESTION]: UNKNOWN_COLUMN_PLAN,
  [STRING_SUM_QUESTION]: STRING_SUM_PLAN,
  [EMPTY_REGION_QUESTION]: EMPTY_REGION_PLAN,
};

export type MockLLMOptions = {
  plans?: Record<string, AnalysisPlan>;
  explain?: (input: ExplainInput) => string | Promise<string>;
  repair?: (input: RepairPlanInput) => AnalysisPlan | Promise<AnalysisPlan>;
};

export class MockLLMProvider implements LLMProvider {
  readonly id = "mock";

  constructor(private readonly options: MockLLMOptions = {}) {}

  async createPlan(input: CreatePlanInput): Promise<AnalysisPlan> {
    const plan = { ...DEFAULT_PLANS, ...this.options.plans }[input.question.trim()];
    if (!plan) {
      throw new AnalysisFailure({
        stage: "plan",
        message: "The mock provider has no plan for this question.",
        details: { code: "unknown_question" },
      });
    }

    return structuredClone(plan);
  }

  async repairPlan(input: RepairPlanInput): Promise<AnalysisPlan> {
    if (this.options.repair) {
      return this.options.repair(input);
    }

    const parsed = analysisPlanSchema.safeParse(input.invalidPlan);
    if (!parsed.success) {
      throw new AnalysisFailure({
        stage: "plan",
        message: "The analysis plan did not match the required shape.",
        details: { code: "invalid_plan", issues: parsed.error.issues },
      });
    }

    return parsed.data;
  }

  async explain(input: ExplainInput): Promise<string> {
    if (this.options.explain) {
      return this.options.explain(input);
    }

    return narrateResult(input.result);
  }
}

function narrateResult(result: AnalysisResult): string {
  if (result.rowCount === 0) {
    return "No matching records were found.";
  }

  return result.rows
    .map((row) =>
      result.columns
        .map((column) => {
          const value = row[column.name];
          return `${column.name} ${value === null ? "null" : String(value)}`;
        })
        .join(", "),
    )
    .join(". ");
}
