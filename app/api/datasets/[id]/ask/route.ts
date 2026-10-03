import { createGeminiProvider } from "@/lib/ai/gemini";
import type { LLMProvider } from "@/lib/ai/provider";
import { logServerError, toPublicError } from "@/lib/api/public-error";
import { askDataset } from "@/lib/datasets/ask";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  return handleAskRequest(request, id, createGeminiProvider());
}

export async function handleAskRequest(
  request: Request,
  datasetId: string,
  llm: LLMProvider,
): Promise<Response> {
  let question = "";
  try {
    const body = (await request.json()) as { question?: unknown };
    question = typeof body.question === "string" ? body.question : "";
  } catch {
    question = "";
  }

  try {
    const response = await askDataset({ datasetId, question, llm });
    return Response.json(response);
  } catch (error) {
    logServerError(error);
    const mapped = toPublicError(error);
    return Response.json(mapped.body, { status: mapped.status });
  }
}
