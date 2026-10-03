import { AnalysisFailure } from "@/lib/analysis/errors";
import { resolveLimits, type AnalysisLimits } from "@/lib/analysis/limits";
import type { DatasetProfile } from "@/lib/analysis/types";
import { profileDataset } from "@/lib/datasets/profile";
import { csvFileName, rejectUpload } from "@/lib/datasets/file-rules";
import {
  createDatasetId,
  removeDataset,
  uploadRoot,
  writeDatasetFiles,
  writeDatasetProfile,
} from "@/lib/datasets/store";

export async function uploadDataset(input: {
  fileName: string;
  bytes: Uint8Array;
  root?: string;
  limits?: Partial<AnalysisLimits>;
}): Promise<DatasetProfile> {
  const rejection = rejectUpload({ name: input.fileName, size: input.bytes.byteLength });
  if (rejection) {
    throw new AnalysisFailure({
      stage: "profile",
      message: rejection.message,
      details: { code: rejection.code },
    });
  }

  const fileName = csvFileName(input.fileName);
  if (!fileName) {
    throw new AnalysisFailure({
      stage: "profile",
      message: "Upload a CSV file.",
      details: { code: "invalid_file" },
    });
  }

  const root = input.root ?? uploadRoot();
  const limits = resolveLimits(input.limits);
  const datasetId = createDatasetId();
  const saved = await writeDatasetFiles({
    root,
    datasetId,
    bytes: input.bytes,
  });

  try {
    const profile = await profileDataset({
      csvPath: saved.csvPath,
      datasetId,
      fileName,
      limits,
    });
    await writeDatasetProfile({ root, datasetId, profile });
    return profile;
  } catch (error) {
    await removeDataset(root, datasetId);
    throw error;
  }
}
