import { toPublicError, logServerError } from "@/lib/api/public-error";
import { uploadDataset } from "@/lib/datasets/upload";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request): Promise<Response> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: { title: "Unsupported file", message: "Upload a CSV file." } },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: { title: "Unsupported file", message: "Upload a CSV file." } },
      { status: 400 },
    );
  }

  try {
    const profile = await uploadDataset({
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
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
