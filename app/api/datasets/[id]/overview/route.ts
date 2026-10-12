import { logServerError, toPublicError } from "@/lib/api/public-error";
import { buildDashboardOverview } from "@/lib/datasets/overview";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  try {
    return Response.json(await buildDashboardOverview(id));
  } catch (error) {
    logServerError(error);
    const mapped = toPublicError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
