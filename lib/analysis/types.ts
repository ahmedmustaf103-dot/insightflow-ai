import { z } from "zod";

export const columnTypeSchema = z.enum(["number", "string", "boolean", "date", "unknown"]);

export const columnProfileSchema = z.object({
  name: z.string().min(1),
  type: columnTypeSchema,
  nullable: z.boolean(),
  nullCount: z.number().int().nonnegative(),
  distinctCount: z.number().int().nonnegative(),
  sampleValues: z.array(z.string()),
  min: z.union([z.string(), z.number()]).optional(),
  max: z.union([z.string(), z.number()]).optional(),
});

export const datasetProfileSchema = z.object({
  datasetId: z.string().min(1),
  fileName: z.string().min(1),
  rowCount: z.number().int().nonnegative(),
  columns: z.array(columnProfileSchema),
  warnings: z.array(z.string()),
});

const scalarValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const filterSchema = z
  .object({
    column: z.string().min(1),
    op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "between"]),
    value: z.union([scalarValueSchema, z.array(z.union([z.string(), z.number()]))]),
  })
  .strict();

export const metricSchema = z
  .object({
    column: z.string().min(1).optional(),
    agg: z.enum(["sum", "mean", "count", "min", "max"]),
  })
  .strict();

export const analysisPlanSchema = z
  .object({
    operation: z.enum(["aggregate", "trend", "detail"]),
    filters: z.array(filterSchema),
    groupBy: z.array(z.string().min(1)),
    metrics: z.array(metricSchema),
    timeColumn: z.string().min(1).optional(),
    grain: z.enum(["year", "quarter", "month"]).optional(),
    select: z.array(z.string().min(1)),
    sortBy: z.string().min(1).optional(),
    sortDirection: z.enum(["asc", "desc"]).optional(),
    limit: z.number().int().min(1),
    rationale: z.string(),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const issue = (path: Array<string | number>, message: string) => {
      ctx.addIssue({ code: "custom", path, message });
    };

    if (/[£$€]/.test(plan.rationale)) {
      issue(["rationale"], "Plan rationale must not include calculated amounts.");
    }

    if (new Set(plan.groupBy).size !== plan.groupBy.length) {
      issue(["groupBy"], "Group-by columns must be unique.");
    }
    if (new Set(plan.select).size !== plan.select.length) {
      issue(["select"], "Selected columns must be unique.");
    }

    const metricNames = plan.metrics.map((metric) =>
      metric.agg === "count" && !metric.column ? "count" : `${metric.agg}_${metric.column ?? ""}`,
    );
    if (new Set(metricNames).size !== metricNames.length) {
      issue(["metrics"], "Metric output names must be unique.");
    }

    for (const [index, metric] of plan.metrics.entries()) {
      if (metric.agg !== "count" && !metric.column) {
        issue(["metrics", index, "column"], `${metric.agg} requires a column.`);
      }
    }

    if (plan.operation === "aggregate") {
      if (plan.metrics.length === 0) {
        issue(["metrics"], "Aggregate requires at least one metric.");
      }
      if (plan.select.length > 0) {
        issue(["select"], "Aggregate does not select source columns.");
      }
      if (plan.timeColumn || plan.grain) {
        issue(["operation"], "Aggregate does not use a time grain.");
      }
    }

    if (plan.operation === "trend") {
      if (!plan.timeColumn) issue(["timeColumn"], "Trend requires a time column.");
      if (!plan.grain) issue(["grain"], "Trend requires a grain.");
      if (plan.metrics.length === 0) issue(["metrics"], "Trend requires at least one metric.");
      if (plan.groupBy.length > 0) issue(["groupBy"], "Trend groups by the time grain only.");
      if (plan.select.length > 0) issue(["select"], "Trend does not select source columns.");
    }

    if (plan.operation === "detail") {
      if (plan.select.length === 0) issue(["select"], "Detail requires at least one selected column.");
      if (plan.metrics.length > 0) issue(["metrics"], "Detail does not aggregate.");
      if (plan.groupBy.length > 0) issue(["groupBy"], "Detail does not group.");
      if (plan.timeColumn || plan.grain) issue(["operation"], "Detail does not use a time grain.");
    }
  });

export const cellSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const analysisResultSchema = z.object({
  columns: z.array(
    z.object({
      name: z.string().min(1),
      type: columnTypeSchema,
    }),
  ),
  rows: z.array(z.record(z.string(), cellSchema)),
  rowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
});

export const evidenceSchema = z.object({
  datasetId: z.string().min(1),
  question: z.string().min(1),
  plan: analysisPlanSchema,
  result: analysisResultSchema,
  engine: z.literal("pandas"),
});

export const chartSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("bar"),
    x: z.string().min(1),
    y: z.string().min(1),
    series: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("line"),
    x: z.string().min(1),
    y: z.string().min(1),
    series: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal("table"),
  }),
]);

export const analysisResponseSchema = z.object({
  answer: z.string(),
  evidence: evidenceSchema,
  chart: chartSpecSchema,
  warnings: z.array(z.string()),
});

export const analysisErrorSchema = z.object({
  stage: z.enum([
    "profile",
    "plan",
    "validate-plan",
    "execute",
    "validate-result",
    "explain",
    "verify-claims",
  ]),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export type ColumnType = z.infer<typeof columnTypeSchema>;
export type ColumnProfile = z.infer<typeof columnProfileSchema>;
export type DatasetProfile = z.infer<typeof datasetProfileSchema>;
export type Filter = z.infer<typeof filterSchema>;
export type Metric = z.infer<typeof metricSchema>;
export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type AnalysisResponse = z.infer<typeof analysisResponseSchema>;
export type AnalysisError = z.infer<typeof analysisErrorSchema>;
export type AnalysisStage = AnalysisError["stage"];

export function createEvidence(input: Evidence): Evidence {
  return evidenceSchema.parse(input);
}
