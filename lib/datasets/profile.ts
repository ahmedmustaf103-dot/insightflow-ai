import { stat } from "node:fs/promises";
import { AnalysisFailure } from "@/lib/analysis/errors";
import { resolveLimits, type AnalysisLimits } from "@/lib/analysis/limits";
import { analysisErrorSchema, datasetProfileSchema, type DatasetProfile } from "@/lib/analysis/types";
import { runPythonScript } from "@/lib/python/run";

export async function profileDataset(input: {
  csvPath: string;
  datasetId: string;
  fileName: string;
  limits?: Partial<AnalysisLimits>;
}): Promise<DatasetProfile> {
  const limits = resolveLimits(input.limits);
  const file = await stat(input.csvPath).catch(() => {
    throw new AnalysisFailure({
      stage: "profile",
      message: "CSV file was not found.",
      details: { code: "missing_file" },
    });
  });

  if (file.size > limits.maxUploadBytes) {
    throw new AnalysisFailure({
      stage: "profile",
      message: `CSV is ${file.size} bytes, which exceeds the maximum upload size of ${limits.maxUploadBytes} bytes.`,
      details: {
        code: "upload_limit",
        size: file.size,
        maxUploadBytes: limits.maxUploadBytes,
      },
    });
  }

  const response = await runPythonScript(
    "profile.py",
    {
      csvPath: input.csvPath,
      datasetId: input.datasetId,
      fileName: input.fileName,
      maxRows: limits.maxRows,
    },
    "profile",
  );

  return readProfile(response);
}

function readProfile(response: unknown): DatasetProfile {
  if (!response || typeof response !== "object" || !("ok" in response)) {
    throw new AnalysisFailure({
      stage: "profile",
      message: "Python returned an unreadable profile.",
      details: { code: "invalid_response" },
    });
  }

  if (response.ok === false && "error" in response) {
    const error = analysisErrorSchema.safeParse(response.error);
    if (!error.success) {
      throw new AnalysisFailure({
        stage: "profile",
        message: "Python returned an invalid error.",
        details: { code: "invalid_response" },
      });
    }
    throw new AnalysisFailure(error.data);
  }

  if (response.ok !== true || !("profile" in response)) {
    throw new AnalysisFailure({
      stage: "profile",
      message: "Python returned an unreadable profile.",
      details: { code: "invalid_response" },
    });
  }

  const profile = datasetProfileSchema.safeParse(response.profile);
  if (!profile.success) {
    throw new AnalysisFailure({
      stage: "profile",
      message: "Dataset profile did not match the contract.",
      details: { issues: profile.error.issues },
    });
  }

  return profile.data;
}
