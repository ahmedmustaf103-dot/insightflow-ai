import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DatasetProfile } from "@/lib/analysis/types";
import type { AnalysisLimits } from "@/lib/analysis/limits";
import { uploadDataset } from "@/lib/datasets/upload";

export const SAMPLE_FILE_NAME = "sales.csv";

export function sampleCsvPath(): string {
  return path.join(process.cwd(), "tests", "fixtures", "sales.csv");
}

export async function loadSampleDataset(input?: {
  root?: string;
  limits?: Partial<AnalysisLimits>;
}): Promise<DatasetProfile> {
  const bytes = new Uint8Array(await readFile(sampleCsvPath()));
  return uploadDataset({
    fileName: SAMPLE_FILE_NAME,
    bytes,
    root: input?.root,
    limits: input?.limits,
  });
}
