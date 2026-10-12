import { toPublicError, logServerError } from "@/lib/api/public-error";
import { loadSampleDataset } from "@/lib/datasets/sample";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(): Promise<Response> {
  try {
    const profile = await loadSampleDataset();
    return Response.json({
      datasetId: profile.datasetId,
      fileName: profile.fileName,
      rowCount: profile.rowCount,
      columns: profile.columns,
      warnings: profile.warnings,
    });
  } catch (error) {
    logServerError(error);
    const mapped = toPublicError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
