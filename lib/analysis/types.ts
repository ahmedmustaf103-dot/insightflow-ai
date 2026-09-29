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

export const filterSchema = z.object({
  column: z.string().min(1),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "in", "between"]),
  value: z.union([scalarValueSchema, z.array(z.union([z.string(), z.number()]))]),
});

export const metricSchema = z.object({
  column: z.string().min(1).optional(),
  agg: z.enum(["sum", "mean", "count", "min", "max"]),
});

export const analysisPlanSchema = z.object({
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
